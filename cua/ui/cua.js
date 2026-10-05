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

async function cuaCommand(connection, command, options) {
  const out = await connection.execCall(command, options);
  const content = typeof out.content === 'string' ? out.content : '';
  let bytes;
  const outputBytes = () => bytes ??= new TextEncoder().encode(content).byteLength;
  const match = command.match(/^mcp (call|describe) cua ([a-zA-Z0-9_]+)/);
  const label = match ? `mcp ${match[1]} cua ${match[2]}` : 'CUA command';
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

export async function cuaCall(connection, name, args = {}, options = {}) {
  if (!/^[a-zA-Z0-9_]+$/.test(name)) throw new Error('Invalid CUA command');
  const {imagePreview = false, ...execOptions} = options;
  const preview = imagePreview === true ? ' --image-preview 1280x720' : '';
  return cuaCommand(connection, `mcp call cua ${name} --input - --json${preview}`, {
    ...execOptions, stdin: JSON.stringify(args),
  });
}

function validTarget(target) {
  if (target?.kind === 'desktop' && (!target.display_id || target.display_id === 'primary')) return desktop();
  if (target?.kind === 'window' && Number.isInteger(target.pid) && target.pid > 0
      && Number.isInteger(target.window_id) && target.window_id >= 0) {
    return {kind: 'window', pid: target.pid, window_id: target.window_id};
  }
  throw new Error('Invalid CUA target');
}

function unavailableWindow(window) {
  if (window.minimized === true) return 'minimized';
  if (window.is_on_screen === false) return 'not_visible';
  if (['width', 'height'].some(key => Number.isFinite(window.bounds?.[key]) && window.bounds[key] <= 0)) return 'no_image';
  return '';
}

function unavailableCapture(error) {
  if (error.code === 'target_unavailable') return error.reason;
  if (error.code === 'window_minimized' || /(?:cannot capture minimized window|window[^\n]*is minimized|iconic window)/i.test(error.message)) return 'minimized';
  if (/no rendered content|no drawable content/i.test(error.message)) return 'no_image';
  return '';
}

// A controller owns a labelled CUA session and one persistent device connection.
// Mutations are never replayed. Observation IDs bind queued input to a shown frame.
export class CuaSession {
  constructor({hosts, changed = () => {}, frame = () => {}, error = () => {},
    intervalMS = 1000, maxDimension = 1280,
    createSessionId = () => `ui-${globalThis.crypto.randomUUID()}`} = {}) {
    this.hosts = hosts;
    this.changed = changed;
    this.onFrame = frame;
    this.onError = error;
    this.intervalMS = Math.max(100, intervalMS);
    this.maxDimension = maxDimension;
    this.createSessionId = createSessionId;
    this.state = {hostId: '', phase: 'idle', connected: false, windows: [], target: desktop(), targetWindow: null, unavailableReason: '', control: false,
      busy: false, capturing: false, acting: false, error: '', permissions: null, epoch: 0};
    this.active = false;
    this.interacting = false;
    this.paused = false;
    this.closed = false;
    this.hostEpoch = 0;
    this.frameSequence = 0;
    this.failureRevision = 0;
    this.actions = [];
    this.completed = [];
    this.requests = new Set();
  }

  _publish(patch = {}) {
    Object.assign(this.state, patch);
    this.state.connected = !!this.connection && !this.connection.closed;
    this.state.busy = this.state.capturing || this.state.acting || this.state.phase === 'connecting'
      || this.actions.length > 0 || this.completed.length > 0;
    this.changed({...this.state});
  }

  _current(epoch) { return !this.closed && epoch === this.state.epoch; }
  _clearTimer() { clearTimeout(this.timer); this.timer = null; }

  _invalidate() {
    this._clearTimer();
    this.state.epoch++;
    this.lastFrame = null;
    this.coordinateFrameConsumed = false;
    this.interacting = false;
    this.captureController?.abort();
    if (this.captureJob) this.captureJob.resolve(null);
    this.captureJob = null;
    for (const job of this.actions.splice(0)) job.reject(failure('stale_context', 'CUA target or observation changed'));
    for (const item of this.completed.splice(0)) item.job.resolve(null);
    this._publish({control: false, capturing: false, acting: false});
  }

  _schedule() {
    this._clearTimer();
    if (!this.active || this.closed || this.paused || this.interacting || !this.connection
        || this.running || this.captureJob || this.actions.length) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this._requestCapture().catch(() => {});
    }, this.intervalMS);
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
        return await cuaCommand(connection, `mcp describe cua ${name} --json`, {...options, signal: controller.signal});
      }
      return await cuaCall(connection, name, {...args, session}, {...options, signal: controller.signal});
    }
    finally { this.requests.delete(controller); signal?.removeEventListener('abort', abort); }
  }

  async _desktopArguments(signal) {
    const generation = this.hostEpoch;
    if (this.desktopSchema?.generation !== generation) {
      const tool = await this._call('get_desktop_state', {}, {describe: true, signal});
      if (this.closed || generation !== this.hostEpoch || signal.aborted) {
        throw failure('stale_context', 'CUA device or target changed');
      }
      const properties = tool.inputSchema?.properties;
      if (!properties || typeof properties !== 'object' || Array.isArray(properties)) {
        throw new Error('CUA returned an invalid desktop capture schema');
      }
      this.desktopSchema = {generation, properties};
    }
    return Object.hasOwn(this.desktopSchema.properties, 'max_image_dimension')
      ? {max_image_dimension: this.maxDimension} : {};
  }

  async _disconnect() {
    const connection = this.connection, session = this.sessionId;
    this.connection = null;
    this.sessionId = null;
    this.desktopSchema = null;
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

  async connect(hostId) {
    if (this.closed) throw failure('closed', 'CUA view is closed');
    const hostEpoch = ++this.hostEpoch;
    this._invalidate();
    this.paused = false;
    this.lastFailure = null;
    this._publish({hostId, phase: hostId ? 'connecting' : 'idle', windows: [],
      target: desktop(), targetWindow: null, unavailableReason: '', error: '', permissions: null});
    await this._disconnect();
    if (this.closed || hostEpoch !== this.hostEpoch || !hostId) return;
    try {
      const connection = await this.hosts.openTools(hostId);
      if (this.closed || hostEpoch !== this.hostEpoch) { await connection.close(); return; }
      this.connection = connection;
      this.sessionId = this.createSessionId();
      await this.checkPermissions();
      if (this.closed || hostEpoch !== this.hostEpoch) return;
      await this.listWindows();
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
        const result = await this._call('check_permissions', {prompt: false});
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

  listWindows() {
    const generation = this.hostEpoch, epoch = this.state.epoch, failureRevision = this.failureRevision;
    if (this.windowJob?.generation === generation) return this.windowJob.promise;
    const job = {generation};
    this.windowJob = job;
    job.promise = (async () => {
      try {
        const data = resultData(await this._call('list_windows', {on_screen_only: true}));
        const rows = Array.isArray(data) ? data : data.windows;
        if (!Array.isArray(rows)) throw new Error('CUA returned an invalid window list');
        const windows = rows.filter(window => !unavailableWindow(window));
        if (!this.closed && generation === this.hostEpoch && failureRevision === this.failureRevision) {
          this._publish({windows});
          const target = this.state.target;
          if (epoch === this.state.epoch && target.kind === 'window') {
            const current = rows.find(window => window.pid === target.pid && window.window_id === target.window_id);
            if (current) this._publish({targetWindow: current});
            const reason = current ? unavailableWindow(current) : 'not_visible';
            if (reason) this._fail(Object.assign(failure('target_unavailable', 'The selected window has no visible content'), {reason}));
          }
        }
        return windows;
      } catch (error) {
        if (!this.closed && generation === this.hostEpoch) this._fail(error);
        throw error;
      } finally {
        if (this.windowJob === job) this.windowJob = null;
      }
    })();
    return job.promise;
  }

  selectTarget(target) {
    target = validTarget(target);
    this._invalidate();
    this.paused = false;
    this.lastFailure = null;
    this._publish({target, targetWindow: target.kind === 'window'
      ? this.state.windows.find(window => window.pid === target.pid && window.window_id === target.window_id) || null : null,
      unavailableReason: '', error: '', phase: this.connection ? 'ready' : 'idle'});
    if (this.active && this.connection) this.capture().catch(() => {});
  }

  setActive(active) {
    active = !!active;
    if (this.active === active || this.closed) return;
    this.active = active;
    if (!active) this._invalidate();
    else if (this.connection && !this.paused) this._requestCapture().catch(() => {});
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
    if (this.interacting) this._clearTimer();
    else this._schedule();
  }

  capture() {
    if (this.closed) return Promise.reject(failure('closed', 'CUA view is closed'));
    this.paused = false;
    this.lastFailure = null;
    this._publish({error: '', phase: this.connection ? 'ready' : 'idle'});
    return this._requestCapture(true);
  }

  _requestCapture(explicit = false) {
    if (!this.active || this.closed || !this.connection || (!explicit && (this.paused || this.interacting))) return Promise.resolve(null);
    if (!this.captureJob) this.captureJob = {...deferred(), epoch: this.state.epoch};
    const promise = this.captureJob.promise;
    this._clearTimer();
    this._pump();
    return promise;
  }

  _fail(error, sourceCapture = null) {
    const reason = this.state.target.kind === 'window' ? unavailableCapture(error) : '';
    if (reason) Object.assign(error, {code: 'target_unavailable', reason});
    if (this.lastFailure === error) return !!reason;
    this.lastFailure = error;
    this.failureRevision++;
    this.paused = true;
    this.captureController?.abort();
    // Metadata failures can happen while a screenshot is in flight. Detach that
    // observation so a manual retry gets a new job, even if transport ignores abort.
    if (this.captureJob && this.captureJob !== sourceCapture) {
      this.captureJob.resolve(null);
      this.captureJob = null;
    }
    this.lastFrame = null;
    this.coordinateFrameConsumed = true;
    this._clearTimer();
    const missing = ['target_closed', 'window_not_found', 'window_id_not_found', 'window_owner_pid_mismatch'].includes(error.code)
      || /window[^\n]*(?:not found|no longer|does not exist|closed|belongs to pid)/i.test(error.message)
      || /no window with window_id[^\n]*exists/i.test(error.message);
    const target = this.state.target;
    this._publish({phase: reason ? 'target_unavailable' : missing ? 'target_closed' : 'error',
      error: reason ? '' : error.message, unavailableReason: reason, control: false,
      ...(reason ? {windows: this.state.windows.filter(window => window.pid !== target.pid || window.window_id !== target.window_id)} : {})});
    for (const job of this.actions.splice(0)) job.reject(error);
    if (!reason) this.onError(error);
    return !!reason;
  }

  _checkAction(job) {
    if (!this._current(job.epoch) || !this.active) throw failure('stale_context', 'CUA target changed');
    if (!this.state.control || this.paused) throw failure('control_disabled', 'CUA control is disabled');
    // Text and named keys are bound to the target epoch, not screenshot geometry.
    // They have not been dispatched yet and may survive a newer observation.
    const coordinates = COORDINATE_ACTIONS.has(job.name);
    if (!this.lastFrame || !Number.isInteger(job.frameId) || job.frameId <= 0 || job.frameId > this.lastFrame.frameId
        || (coordinates && (job.frameId !== this.lastFrame.frameId || job.captureId !== this.lastFrame.captureId
          || this.coordinateFrameConsumed))) {
      throw failure('stale_capture', 'CUA observation changed; use the latest screenshot');
    }
  }

  action(name, args = {}, {captureId = this.lastFrame?.captureId, frameId, epoch = this.state.epoch} = {}) {
    try {
      if (!ACTIONS.has(name)) throw new Error('Unsupported CUA action');
      if (['target', 'session', 'pid', 'window_id', 'scope', 'capture_id'].some(key => key in args)) {
        throw new Error('CUA target and session are owned by the view');
      }
      const job = {...deferred(), name, args: {...args}, captureId, frameId, epoch};
      this._checkAction(job);
      if (this.actions.length >= MAX_ACTIONS) throw failure('input_queue_full', 'CUA input queue is full');
      this.actions.push(job);
      this._clearTimer();
      this._pump();
      return job.promise;
    } catch (error) {
      if (error.code === 'stale_capture') this._requestCapture(true).catch(() => {});
      return Promise.reject(error);
    }
  }

  async _capture(job) {
    const epoch = job.epoch, target = {...this.state.target}, failureRevision = this.failureRevision;
    const controller = new AbortController();
    this.captureController = controller;
    this._publish({capturing: true});
    try {
      const args = target.kind === 'desktop' ? await this._desktopArguments(controller.signal)
        : {pid: target.pid, window_id: target.window_id,
          include_accessibility_tree: false, include_screenshot: true, max_dimension: this.maxDimension};
      if (!this._current(epoch) || !this.active || controller.signal.aborted) {job.resolve(null); return;}
      const result = await this._call(target.kind === 'desktop' ? 'get_desktop_state' : 'get_window_state', args, {signal: controller.signal, imagePreview: true});
      if (!this._current(epoch) || !this.active || failureRevision !== this.failureRevision) {
        job.resolve(null); return;
      }
      const data = resultData(result);
      const image = result.content?.find(item => item.type === 'image' && item.data && item.mimeType?.startsWith('image/'));
      if (!image) {
        if (target.kind === 'window' && !data.screenshot_error) {
          throw Object.assign(failure('target_unavailable', 'CUA returned no screenshot image'), {reason: 'no_image'});
        }
        throw new Error(data.screenshot_error || 'CUA returned no screenshot image');
      }
      const preview = image._meta?.['aic.dev/image-preview'];
      if (preview && !['source_width', 'source_height', 'width', 'height']
        .every(key => Number.isSafeInteger(preview[key]) && preview[key] > 0)) {
        throw failure('invalid_response', 'CUA image preview has invalid coordinate dimensions');
      }
      const captureId = data.capture_id;
      const frame = {image: {data: image.data, mimeType: image.mimeType}, captureId,
        sourceWidth: preview?.source_width, sourceHeight: preview?.source_height,
        previewWidth: preview?.width, previewHeight: preview?.height,
        frameId: ++this.frameSequence, width: data.screenshot_width, height: data.screenshot_height,
        target, epoch};
      this.lastFrame = frame;
      this.coordinateFrameConsumed = false;
      this._publish({phase: 'ready', error: '', unavailableReason: ''});
      this.onFrame(frame);
      job.resolve(frame);
    } catch (error) {
      if (!this._current(epoch) || !this.active || failureRevision !== this.failureRevision) job.resolve(null);
      else if (this._fail(error, job)) job.resolve(null);
      else job.reject(error);
    } finally {
      if (this.captureController === controller) this.captureController = null;
      if (this.captureJob === job) this.captureJob = null;
      if (this._current(epoch)) this._publish({capturing: false});
    }
  }

  async _act(job) {
    let started = false;
    try {
      this._checkAction(job);
      const target = {...this.state.target};
      const args = {...job.args, target};
      if (target.kind === 'window' && !args.delivery_mode) args.delivery_mode = 'background';
      if (job.name === 'click' && job.captureId) args.capture_id = job.captureId;
      // Text and keys may also change layout. They may continue in order, but
      // pointer actions need a screenshot captured after any preceding mutation.
      this.coordinateFrameConsumed = true;
      this._publish({acting: true});
      started = true;
      const result = await this._call(job.name, args);
      if (!this._current(job.epoch) || !this.active) { job.resolve(null); return; }
      this._publish({acting: false});
      this.completed.push({job, result});
    } catch (error) {
      if (this._current(job.epoch) && this.active && started) this._fail(error);
      if (error.code === 'stale_capture') this._requestCapture(true).catch(() => {});
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
        if (action) await this._act(action);
        else if (this.captureJob) {
          await this._capture(this.captureJob);
          for (const item of this.completed.splice(0)) item.job.resolve(this._current(item.job.epoch) ? item.result : null);
        }
        else if (this.completed.length) {
          if (this.active && !this.paused) {
            this.captureJob = {...deferred(), epoch: this.state.epoch};
            this.captureJob.promise.catch(() => {});
          } else {
            for (const item of this.completed.splice(0)) item.job.resolve(this._current(item.job.epoch) ? item.result : null);
          }
        }
        else break;
      }
    } finally { this.running = false; if (!this.closed) this._publish(); this._schedule(); }
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
