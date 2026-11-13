import {CuaCast} from './cast.js';

const ACTIONS = new Set(['click', 'drag', 'scroll', 'type_text', 'press_key', 'hotkey']);
const COORDINATE_ACTIONS = new Set(['click', 'drag', 'scroll']);
const MAX_ACTIONS = 16;
const desktop = () => ({kind: 'desktop', display_id: 'primary'});
const failure = (code, message) => Object.assign(new Error(message), {code});
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return {promise, resolve, reject};
};

export function resultData(result) {
  if (result.structuredContent != null) return result.structuredContent;
  for (const item of result.content || []) {
    if (item.type !== 'text') continue;
    try { return JSON.parse(item.text); } catch {}
  }
  return {};
}

// Diagnostic messages may be displayed directly in the UI. Never include an
// execution response or an image payload, and bound even human-readable stderr.
function diagnosticText(value, depth = 0) {
  if (typeof value !== 'string' || depth > 2) return '';
  const text = value.trim();
  if (!text) return '';
  if (text.startsWith('{') || /^\[\s*(?:[\[{"\d-]|true\b|false\b|null\b|\])/.test(text)) {
    if (text.length > 4096) return '';
    try {
      const data = JSON.parse(text);
      return diagnosticText(data?.error?.message || data?.message || data?.screenshot_error
        || (typeof data?.error === 'string' ? data.error : ''), depth + 1);
    } catch { return ''; }
  }
  const safe = text.slice(0, 4096).split('\n')
    .filter(line => !/"(?:data|image|screenshot|base64)"\s*:|data:image\//i.test(line))
    .map(line => line.replace(/\b(?:base64|image|screenshot)\s*[:=]\s*\S+/gi, '[image data omitted]')
      .replace(/[A-Za-z0-9+/_=-]{64,}/g, '[encoded data omitted]'))
    .filter(line => !/^[A-Za-z0-9+/]{16,}={0,2}$/.test(line.trim()))
    .join('\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
  if (!safe || /^\[(?:encoded|image) data omitted\]$/.test(safe)) return '';
  return safe.slice(0, 640) + (safe.length > 640 || text.length > 4096 ? '… (diagnostic shortened)' : '');
}

// cuaLabel 命令标签（诊断用）：服务命令 `cua <tool>` 与工具目录命令
// `commands info cua --schema` 各给一个可读名。
function cuaLabel(command) {
  const match = command.match(/^((?:mcp (?:call|describe) )?)cua ([a-zA-Z0-9_]+)/);
  if (match) return `${match[1]}cua ${match[2]}`;
  if (/^commands info cua\b/.test(command)) return 'commands info cua';
  return 'CUA command';
}

// cuaExecRaw 执行设备命令并做传输层校验（截断 / 空输出 / 非法 JSON）；返回解析后
// 的 JSON 值与诊断上下文。MCP 工具结果（对象）与工具目录（数组）共用这段。
async function cuaExecRaw(connection, command, options) {
  const out = await connection.execCall(command, options);
  const content = typeof out.content === 'string' ? out.content : '';
  let bytes;
  const outputBytes = () => bytes ??= new TextEncoder().encode(content).byteLength;
  const label = cuaLabel(command);
  const rawExit = String(out.attrs?.exit_code ?? 'unknown');
  const exitCode = /^-?\d{1,10}$/.test(rawExit) ? rawExit : 'unknown';
  const context = () => `${label} (stdout ${outputBytes()} bytes, exit ${exitCode})`;
  const stderr = diagnosticText(out.attrs?.stderr);
  const details = stderr ? `: ${stderr}` : '';
  if ([true, 1, 'true', '1'].includes(out.attrs?.truncated)) {
    throw failure('output_truncated', `${context()}: device reported truncated command output; the response is incomplete${details}`);
  }
  if (!content) {
    if (exitCode !== '0' && stderr) throw failure('cua_error', `${context()}: ${stderr}`);
    throw failure('invalid_response', `${context()}: command returned no JSON response${details}`);
  }
  let result;
  try { result = JSON.parse(content); }
  catch {
    const hint = outputBytes() === 8 * 1024 * 1024
      ? ' The response is exactly 8 MiB and may have hit an older Pod output limit.'
      : ' The response may be incomplete or truncated.';
    throw failure('invalid_response', `${context()}: command returned invalid JSON${details}.${hint}`);
  }
  return {result, context, details, exitCode, stderr};
}

async function cuaCommand(connection, command, options) {
  const {result, context, details, exitCode, stderr} = await cuaExecRaw(connection, command, options);
  if (!result || typeof result !== 'object' || Array.isArray(result)
      || (result.content != null && !Array.isArray(result.content))) {
    throw failure('invalid_response', `${context()}: expected a valid MCP JSON object${details}`);
  }
  if (result.isError || exitCode !== '0') {
    const data = resultData(result);
    const rawCode = data?.code || data?.error?.code;
    const code = typeof rawCode === 'string' && /^[a-zA-Z0-9_.-]{1,80}$/.test(rawCode) ? rawCode : 'cua_error';
    const message = stderr || diagnosticText(data?.error?.message || data?.message || data?.screenshot_error)
      || (Array.isArray(result.content) ? result.content.filter(item => item.type === 'text')
        .map(item => diagnosticText(item.text)).find(Boolean) : '')
      || `${context()}: command failed`;
    throw failure(code, message);
  }
  return result;
}

// cuaToolSchema 取单个工具的 inputSchema。设备命令面：`commands info cua --schema`
// 返回该服务全部工具的原始描述（数组），按名挑出目标工具。
async function cuaToolSchema(connection, name, options) {
  const {result, context, details, exitCode} = await cuaExecRaw(connection, 'commands info cua --schema', options);
  if (!Array.isArray(result)) {
    throw failure('invalid_response', `${context()}: expected a tool list${details}`);
  }
  if (exitCode !== '0') {
    throw failure('cua_error', `${context()}: command failed${details}`);
  }
  const tool = result.find(item => item && item.name === name);
  if (!tool) throw failure('invalid_response', `${context()}: unknown tool "${name}"${details}`);
  return tool;
}

export async function cuaCall(connection, name, args = {}, options = {}) {
  if (!/^[a-zA-Z0-9_]+$/.test(name)) throw new Error('Invalid CUA command');
  return cuaCommand(connection, `cua ${name} --input - --json`, {
    ...options, stdin: JSON.stringify(args),
  });
}

// A controller owns one independent CUA session, one persistent device connection
// and the primary desktop H264 stream. There is no state-screenshot fallback.
export class CuaSession {
  constructor({hosts, changed = () => {}, frame = () => {}, error = () => {},
    createCast = options => new CuaCast(options), castSupported = () => CuaCast.supported(),
    createSessionId = () => `ui-${globalThis.crypto.randomUUID()}`} = {}) {
    this.hosts = hosts;
    this.changed = changed;
    this.onFrame = frame;
    this.onError = error;
    this.createSessionId = createSessionId;
    this.createCast = createCast;
    this.castSupported = castSupported;
    this.state = {hostId: '', phase: 'idle', connected: false, target: desktop(), control: false,
      busy: false, capturing: false, acting: false, error: '', permissions: null, epoch: 0,
      streamState: 'idle', streamError: '', fps: 0};
    this.active = false;
    this.interacting = false;
    this.paused = false;
    this.closed = false;
    this.hostEpoch = 0;
    this.frameSequence = 0;
    this.actions = [];
    this.requests = new Set();
    this.frameTimes = [];
    this.cast = null;
    this.castGeneration = 0;
    this.castStartTimer = null;
    this.lastCastError = null;
    this.lastCastPublish = 0;
    this.lastFrame = null;
    this.coordinateFrameConsumed = false;
  }

  // frameRate 返回近窗口内的实际到达帧率（每帧到达时的时间戳滑窗）。
  // 用相邻帧间隔的中位数而不是首尾跨度：连着两帧落在同一毫秒时跨度会算成 0。
  frameRate() {
    const times = this.frameTimes;
    if (times.length < 2) return 0;
    const gaps = [];
    for (let i = 1; i < times.length; i++) {
      const gap = times[i] - times[i - 1];
      if (gap > 0) gaps.push(gap);
    }
    if (!gaps.length) return 0;
    gaps.sort((a, b) => a - b);
    const median = gaps[Math.floor(gaps.length / 2)];
    return median > 0 ? 1000 / median : 0;
  }

  _recordFrame() {
    const now = Date.now();
    this.frameTimes.push(now);
    if (this.frameTimes.length > 12) this.frameTimes.shift();
  }

  _publish(patch = {}) {
    Object.assign(this.state, patch);
    this.state.connected = !!this.connection && !this.connection.closed;
    this.state.busy = this.state.capturing || this.state.acting || this.state.phase === 'connecting'
      || this.actions.length > 0;
    this.state.fps = this.frameRate();
    this.changed({...this.state});
  }

  _current(epoch) { return !this.closed && epoch === this.state.epoch; }

  _stopCast() {
    this.castGeneration++;
    clearTimeout(this.castStartTimer);
    this.castStartTimer = null;
    const cast = this.cast;
    this.cast = null;
    cast?.close();
    this.state.streamState = 'idle';
  }

  _rejectCaptureJob(error) {
    if (!this.captureJob) return;
    this.captureJob.reject(error);
    this.captureJob = null;
  }

  _castFailure(error, epoch, generation) {
    if (!this._current(epoch) || generation !== this.castGeneration) return;
    this._stopCast();
    this._rejectCaptureJob(error);
    this.state.streamState = 'error';
    this._fail(error);
  }

  _castClosed(error, epoch, generation) {
    this._castFailure(error || new Error('CUA video stream closed'), epoch, generation);
  }

  async _startCast(job) {
    const epoch = job.epoch;
    const capabilityError = typeof this.connection?.openStream !== 'function'
      ? new Error('CUA video streams require a current Pod')
      : !this.castSupported() ? new Error('CUA video requires browser WebCodecs H264 support') : null;
    if (capabilityError) {
      this._castFailure(capabilityError, epoch, this.castGeneration);
      throw capabilityError;
    }
    this._stopCast();
    const generation = this.castGeneration;
    this._publish({capturing: true, streamState: 'connecting', streamError: ''});
    try {
      this.cast = this.createCast({
        connection: this.connection,
        frame: frame => this._castFrame(frame, epoch, generation),
        closed: error => this._castClosed(error, epoch, generation),
        error: error => {
          this.lastCastError = error;
          if (error.code === 'cua_cast_session') this._castFailure(error, epoch, generation);
          else if (this._current(epoch) && generation === this.castGeneration) this._publish({streamError: error.message});
        },
      });
      await this.cast.ready();
      if (!this._current(epoch) || generation !== this.castGeneration || !this.active) return null;
      this.castStartTimer = setTimeout(() => {
        if (this.state.streamState !== 'live') {
          const stats = this.cast?.stats?.() || {};
          const detail = `received=${stats.received || 0}, decoded=${stats.decoded || 0}, skipped=${stats.skipped || 0}`;
          const last = this.lastCastError ? `; last error: ${this.lastCastError.message}` : '';
          this._castFailure(new Error(`CUA video stream produced no frames within 8 seconds (${detail})${last}`), epoch, generation);
        }
      }, 8000);
      this._publish({capturing: false, error: ''});
      return this.lastFrame;
    } catch (error) {
      if (this._current(epoch) && generation === this.castGeneration) this._castFailure(error, epoch, generation);
      throw error;
    } finally {
      if (this._current(epoch)) this._publish({capturing: false});
    }
  }

  _castFrame(data, epoch, generation) {
    if (!this._current(epoch) || generation !== this.castGeneration || !this.active) return null;
    const sourceWidth = data.sourceWidth || data.width;
    const sourceHeight = data.sourceHeight || data.height;
    const frame = {video: true, videoFrame: data.videoFrame,
      sourceWidth, sourceHeight, previewWidth: data.width, previewHeight: data.height,
      frameId: ++this.frameSequence, width: sourceWidth, height: sourceHeight,
      target: desktop(), epoch};
    this.lastFrame = frame;
    clearTimeout(this.castStartTimer);
    this.castStartTimer = null;
    this.coordinateFrameConsumed = false;
    this._recordFrame();
    const now = Date.now();
    if (this.state.streamState !== 'live' || now - this.lastCastPublish >= 500) {
      const starting = this.state.streamState !== 'live';
      this.lastCastPublish = now;
      this._publish({...(starting ? {phase: 'ready', error: ''} : {}),
        streamState: 'live', streamError: '', capturing: false});
    }
    return this.onFrame(frame);
  }

  _invalidate() {
    this._stopCast();
    this.state.epoch++;
    this.lastFrame = null;
    this.coordinateFrameConsumed = false;
    this.interacting = false;
    this.frameTimes = [];
    if (this.captureJob) this.captureJob.resolve(null);
    this.captureJob = null;
    for (const job of this.actions.splice(0)) job.reject(failure('stale_context', 'CUA device or observation changed'));
    this._publish({control: false, capturing: false, acting: false});
  }

  async _call(name, args = {}, {signal, describe = false, ...options} = {}) {
    const connection = this.connection, session = this.sessionId;
    if (!connection || connection.closed) throw failure('disconnected', 'CUA device is not connected');
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, {once: true});
    if (signal?.aborted) controller.abort();
    this.requests.add(controller);
    try {
      if (describe) {
        if (!/^[a-zA-Z0-9_]+$/.test(name)) throw new Error('Invalid CUA command');
        return await cuaToolSchema(connection, name, {...options, signal: controller.signal});
      }
      return await cuaCall(connection, name, {...args, session}, {...options, signal: controller.signal});
    }
    finally { this.requests.delete(controller); signal?.removeEventListener('abort', abort); }
  }

  async _permissionArguments() {
    const generation = this.hostEpoch;
    if (this.permissionSchema?.generation !== generation) {
      const tool = await this._call('check_permissions', {}, {describe: true});
      if (this.closed || generation !== this.hostEpoch) {
        throw failure('stale_context', 'CUA device changed');
      }
      const properties = tool.inputSchema?.properties;
      if (!properties || typeof properties !== 'object' || Array.isArray(properties)) {
        throw new Error('CUA returned an invalid permissions schema');
      }
      this.permissionSchema = {generation, properties};
    }
    return Object.hasOwn(this.permissionSchema.properties, 'prompt') ? {prompt: false} : {};
  }

  async _disconnect() {
    this._stopCast();
    const connection = this.connection, session = this.sessionId;
    this.connection = null;
    this.sessionId = null;
    this.permissionSchema = null;
    this._publish();
    for (const request of this.requests) request.abort();
    if (!connection) return;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    try {
      if (!connection.closed && session) {
        await cuaCall(connection, 'end_session', {session}, {signal: controller.signal, waitMS: 1000});
      }
    } catch {} finally { clearTimeout(timer); await connection.close().catch(() => {}); }
  }

  async connect(hostId, {connection: providedConnection = null} = {}) {
    if (this.closed) throw failure('closed', 'CUA view is closed');
    const hostEpoch = ++this.hostEpoch;
    this._invalidate();
    this.lastCastError = null;
    this.paused = false;
    this.lastFailure = null;
    this._publish({hostId, phase: hostId ? 'connecting' : 'idle', target: desktop(),
      error: '', permissions: null, streamError: ''});
    await this._disconnect();
    if (this.closed || hostEpoch !== this.hostEpoch || !hostId) return;
    try {
      const connection = providedConnection || await this.hosts.openTools(hostId);
      if (this.closed || hostEpoch !== this.hostEpoch) { await connection.close(); return; }
      this.connection = connection;
      this.sessionId = this.createSessionId();
      await this.checkPermissions();
      if (this.closed || hostEpoch !== this.hostEpoch) return;
      this._publish({phase: 'ready', error: ''});
      if (this.active) await this.capture();
    } catch (error) {
      if (this.closed || hostEpoch !== this.hostEpoch) return;
      this._fail(error);
      throw error;
    }
  }

  checkPermissions() {
    const generation = this.hostEpoch;
    if (this.permissionJob?.generation === generation) return this.permissionJob.promise;
    const job = {generation};
    this.permissionJob = job;
    job.promise = (async () => {
      try {
        const args = await this._permissionArguments();
        const result = await this._call('check_permissions', args);
        const permissions = resultData(result);
        if (!this.closed && generation === this.hostEpoch) this._publish({permissions});
        return permissions;
      } catch (error) {
        if (!this.closed && generation === this.hostEpoch) this._fail(error);
        throw error;
      } finally {
        if (this.permissionJob === job) this.permissionJob = null;
      }
    })();
    return job.promise;
  }

  setActive(active) {
    active = !!active;
    if (this.active === active || this.closed) return;
    this.active = active;
    if (!active) this._invalidate();
    else if (this.connection && !this.paused) this.capture().catch(() => {});
  }

  setControl(control) {
    const enabled = !!control && this.active && !!this.lastFrame && !this.paused && !this.closed;
    this._publish({control: enabled});
    if (!enabled) {
      for (const job of this.actions.splice(0)) job.reject(failure('control_disabled', 'CUA control is disabled'));
    }
  }

  setInteracting(interacting) {
    this.interacting = !!interacting;
  }

  // capture 是手动重试视频的唯一入口；不会请求任何 CUA 状态或图像。
  capture() {
    if (this.closed) return Promise.reject(failure('closed', 'CUA view is closed'));
    this.paused = false;
    this.lastFailure = null;
    this.lastCastError = null;
    this._publish({error: '', phase: this.connection ? 'ready' : 'idle', streamError: ''});
    if (!this.active || !this.connection) return Promise.resolve(null);
    if (this.captureJob) return this.captureJob.promise;
    if (this.cast) return Promise.resolve(this.lastFrame);
    const job = {...deferred(), epoch: this.state.epoch};
    this.captureJob = job;
    this._startCast(job).then(job.resolve, job.reject).finally(() => {
      if (this.captureJob === job) this.captureJob = null;
    });
    return job.promise;
  }

  _fail(error) {
    if (this.lastFailure === error) return;
    this.lastFailure = error;
    this.paused = true;
    this.lastFrame = null;
    this.coordinateFrameConsumed = true;
    this._publish({phase: 'error', error: error.message, control: false, capturing: false, acting: false});
    for (const job of this.actions.splice(0)) job.reject(error);
    this.onError(error);
  }

  _checkAction(job, dispatch = false) {
    if (!this._current(job.epoch) || !this.active) throw failure('stale_context', 'CUA device or observation changed');
    if (!this.state.control || this.paused) throw failure('control_disabled', 'CUA control is disabled');
    const coordinates = COORDINATE_ACTIONS.has(job.name);
    // 已排队的坐标输入不被后续视频帧作废；新输入必须基于当前展示帧。
    const staleCoordinates = (!dispatch && job.frameId !== this.lastFrame?.frameId)
      || this.coordinateFrameConsumed;
    if (!this.lastFrame || !Number.isInteger(job.frameId) || job.frameId <= 0 || job.frameId > this.lastFrame.frameId
        || (coordinates && staleCoordinates)) {
      throw failure('stale_capture', 'CUA observation changed; use the latest video frame');
    }
  }

  action(name, args = {}, {frameId, epoch = this.state.epoch} = {}) {
    try {
      if (!ACTIONS.has(name)) throw new Error('Unsupported CUA action');
      if (['target', 'session', 'scope', 'capture_id'].some(key => key in args)) {
        throw new Error('CUA target and session are owned by the view');
      }
      const job = {...deferred(), name, args: {...args}, frameId, epoch};
      this._checkAction(job);
      if (this.actions.length >= MAX_ACTIONS) throw failure('input_queue_full', 'CUA input queue is full');
      this.actions.push(job);
      this._pump();
      return job.promise;
    } catch (error) {
      return Promise.reject(error);
    }
  }

  async _act(job) {
    let started = false;
    try {
      this._checkAction(job, true);
      const args = {...job.args, target: desktop()};
      // 用户在实时桌面中主动控制即同意交出真实指针；CuaDriver 对落在非前台
      // 窗口上的后台桌面点击会拒绝执行，因此坐标输入显式走 foreground。
      if (COORDINATE_ACTIONS.has(job.name) && !args.delivery_mode) args.delivery_mode = 'foreground';
      this.coordinateFrameConsumed = true;
      this._publish({acting: true});
      started = true;
      const result = await this._call(job.name, args);
      if (!this._current(job.epoch) || !this.active) { job.resolve(null); return; }
      job.resolve(result);
    } catch (error) {
      if (this._current(job.epoch) && this.active && started) this._fail(error);
      job.reject(error);
    } finally {
      if (this._current(job.epoch)) this._publish({acting: false});
    }
  }

  async _pump() {
    if (this.running || this.closed) return;
    this.running = true;
    try {
      while (!this.closed) {
        const action = this.actions.shift();
        if (!action) break;
        await this._act(action);
      }
    } finally {
      this.running = false;
      if (!this.closed) this._publish();
    }
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    this.hostEpoch++;
    this.active = false;
    this._invalidate();
    this._publish({phase: 'closed'});
    await this._disconnect();
  }
}
