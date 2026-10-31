// browser：设备浏览器的连接目录、画面呈现与人工输入。
//
// 协议 browser/stream-v2：全程二进制。
// 包头 [u8 kind][u32 payloadLen][u64 seq][payload]：
//   kind 1 FRAME   设备→页面，payload 是 JPEG 原始字节
//   kind 2 CONTROL 设备→页面，payload 是 UTF-8 JSON
//   kind 3 INPUT   页面→设备，payload 是 UTF-8 JSON
//   kind 4 ACK     页面→设备，payload 空，seq 是画完的帧号
// 画面不走 base64：拿到字节直接 createImageBitmap。
//
// 坐标用视口归一化值 [0,1]。平台只转发字节，页面侧自己解包头。

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const KIND_FRAME = 1;
const KIND_CONTROL = 2;
const KIND_INPUT = 3;
const KIND_ACK = 4;
const HEADER_BYTES = 13;

const modifiers = event => (event.altKey ? 1 : 0) | (event.ctrlKey ? 2 : 0)
  | (event.metaKey ? 4 : 0) | (event.shiftKey ? 8 : 0);

// 设备可连：启用 + 心跳新鲜 + RTC 可用（与 browser/cua 包同口径）。
export const deviceReady = host => host.status === 'enabled'
  && (!host.last_seen || Date.now() - Date.parse(host.last_seen) < 40000)
  && !!host.caps?.transports?.rtc?.enabled
  && (!host.caps?.transports?.rtc?.protocol || host.caps.transports.rtc.protocol === 'hosts_rtc/3');

// 设备不可用的原因（侧栏右侧的备注）。
export const deviceUnavailable = host => {
  if (host.status && host.status !== 'enabled') return 'disabled';
  if (host.last_seen && Date.now() - Date.parse(host.last_seen) >= 40000) return 'offline';
  return 'unavailable';
};

// browserCall 在设备上跑一个 browser 工具：命令走设备执行通道，参数走 stdin
// （与 browser 包的 browserCall 同一形状）。
export const browserCall = async (connection, tool, args = {}) => {
  if (!/^[a-zA-Z0-9_.-]+$/.test(tool)) throw new Error('Invalid browser command');
  const out = await connection.execCall(`browser ${tool} --input - --json`, {stdin: JSON.stringify(args)});
  if (!out.content) throw new Error(out.attrs?.stderr || 'browser command returned no result');
  const result = JSON.parse(out.content);
  const code = out.attrs?.exit_code;
  const failed = result.isError || (code !== undefined && String(code) !== '0');
  const text = (result.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n');
  if (failed) throw new Error(text || out.attrs?.stderr || 'browser command failed');
  return text ? JSON.parse(text) : null;
};

// BrowserDirectory 管设备目录与工具连接：每台设备一行，附带它的页面清单。
export class BrowserDirectory {
  constructor(hosts, changed = () => {}) {
    this.hosts = hosts;
    this.changed = changed;
    this.connections = new Map();
    this.rows = [];
    this.closed = false;
  }

  async refresh({ retryFailed = false } = {}) {
    if (this.pending) return this.pending;
    this.pending = this.load({ retryFailed }).finally(() => { this.pending = null; });
    return this.pending;
  }

  async load({ retryFailed = false } = {}) {
    const query = this.hosts.query({});
    let hosts;
    try { hosts = [...await query.load()]; } finally { query.dispose(); }
    if (this.closed) return this.rows;
    const wanted = new Set(hosts.filter(h => h.status === 'enabled').map(h => h.id));
    for (const [id, connection] of this.connections) {
      if (!wanted.has(id) || connection.closed) {
        this.connections.delete(id);
        await connection.close().catch(() => {});
      }
    }
    const rows = hosts.map(host => {
      const previous = this.rows.find(r => r.id === host.id);
      if (previous) {
        previous.name = host.name || previous.name;
        return previous;
      }
      return {
        id: host.id,
        name: host.name || host.hostname || host.id,
        status: 'connecting',
        error: '',
        pages: [],
      };
    });
    this.rows = rows;
    this.changed(rows);
    let next = 0;
    // 慢设备不能拖住其它设备的发现。
    const worker = async () => {
      while (!this.closed && next < hosts.length) {
        const index = next++;
        const host = hosts[index];
        const row = rows[index];
        if (host.status !== 'enabled') { row.status = 'disabled'; this.changed(rows); continue; }
        if (host.last_seen && Date.now() - Date.parse(host.last_seen) > 40000) {
          row.status = 'offline'; this.changed(rows); continue;
        }
        if (!host.caps?.transports?.rtc?.enabled) {
          row.status = 'unavailable'; this.changed(rows); continue;
        }
        if (row.status === 'error' && !retryFailed) continue;
        row.status = 'connecting';
        this.changed(rows);
        try {
          let connection = this.connections.get(host.id);
          if (!connection) {
            connection = await this.hosts.openTools(host.id);
            this.connections.set(host.id, connection);
          }
          row.pages = await this.listPages(host.id);
          row.status = 'ready';
          row.error = '';
        } catch (error) {
          row.status = 'error';
          row.error = error.message;
          const connection = this.connections.get(host.id);
          this.connections.delete(host.id);
          await connection?.close().catch(() => {});
        }
        this.changed(rows);
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, hosts.length) }, worker));
    if (!this.closed) this.changed(rows);
    return rows;
  }

  // listPages 读设备当前的页面标签（CDP 的 Target 域）。
  async listPages(hostId) {
    const connection = this.connections.get(hostId);
    if (!connection) throw new Error('device is not connected');
    const targets = await browserCall(connection, 'targets', {});
    const infos = (targets && targets.targetInfos) || [];
    return infos
      .filter(t => t.type === 'page')
      .map(t => ({ id: t.targetId, title: t.title || '', url: t.url || '' }));
  }

  connection(hostId) { return this.connections.get(hostId); }

  async close() {
    this.closed = true;
    const connections = [...this.connections.values()];
    this.connections.clear();
    await Promise.all(connections.map(c => c.close().catch(() => {})));
  }
}

// BrowserViewer 把设备推来的帧画到画布上，并把人工输入送回设备。
export class BrowserViewer {
  constructor(canvas, keyboard, { connection, changed }) {
    this.canvas = canvas;
    this.keyboard = keyboard;
    this.changed = changed;
    this.closed = false;
    this.buffer = new Uint8Array(0);
    this.latest = null;
    this.drawing = false;
    this.keys = new Map();
    this.listeners = [];
    this.move = null;
    this.moveTimer = null;
    // 帧率与输入延迟的自测：帧率是端到端收到的帧率，输入延迟是
    // 「发出输入→设备回执」的往返毫秒数（滚动卡不卡就看它）。
    this.frameCount = 0
    this.frameWindowStart = performance.now()
    this.lastFps = -1
    this.inputSeq = 0
    this.inputSentAt = new Map()
    this.stream = connection.openStream({
      command: 'browser',
      name: 'view',
      onData: bytes => this.receive(bytes),
      onClose: error => {
        if (this.closed) return;
        this.close();
        this.changed({ error: error?.message || 'disconnected' });
      },
    });
    // 页面不活跃就放掉流：隐藏的 tab 不用让设备给它推帧（多开 tab 时这是
    // 页面卡顿的主因），页面回来时自己建新的流。
    this.onVisibility = () => {
      if (document.hidden) this.close();
    };
    document.addEventListener('visibilitychange', this.onVisibility);
    this.bind();
    this.fpsTimer = setInterval(() => this.reportFps(), 500);
  }

  // reportFps 每 500ms 算一次收到的帧率：画面是停是动、掉不掉帧，一眼可见。
  reportFps() {
    if (this.closed) return
    const now = performance.now()
    const elapsed = (now - this.frameWindowStart) / 1000
    if (elapsed < 0.25) return
    const fps = Math.round(this.frameCount / elapsed)
    this.frameCount = 0
    this.frameWindowStart = now
    if (fps === this.lastFps) return
    this.lastFps = fps
    this.changed({ fps })
  }

  async ready() {
    await this.stream.ready;
    return this;
  }

  // 包一层协议头：[u8 kind][u32 payloadLen][u64 seq][payload]。
  packet(kind, seq, payload) {
    const out = new Uint8Array(HEADER_BYTES + payload.length);
    const view = new DataView(out.buffer);
    view.setUint8(0, kind);
    view.setUint32(1, payload.length);
    view.setBigUint64(5, BigInt(seq));
    out.set(payload, HEADER_BYTES);
    return out;
  }

  send(message) {
    if (this.closed) return false;
    // 每个输入带一个事件号：设备合并连续事件后，回执不再与发送一一对应，
    // 只能按事件号算真实往返。
    const id = ++this.inputSeq;
    const body = encoder.encode(JSON.stringify({ ...message, id }));
    if (!this.stream.send(this.packet(KIND_INPUT, 0, body))) {
      this.changed({ error: 'send_failed' });
      return false;
    }
    this.inputSentAt.set(id, performance.now());
    // 被合并掉的事件不会有回执：表要有界，最老的直接丢。
    if (this.inputSentAt.size > 256) {
      this.inputSentAt.delete(this.inputSentAt.keys().next().value);
    }
    return true;
  }

  // ack 确认这一帧已经画完：设备据此 ack Chrome，Chrome 才会推下一帧。
  // 这是整条链路的背压：一帧在途，页面慢就掉帧，不会堆积。
  ack(seq) {
    if (this.closed) return;
    this.stream.send(this.packet(KIND_ACK, seq, new Uint8Array(0)));
  }

  // 设备→页面：拆包头，按 kind 分发。
  receive(bytes) {
    const joined = new Uint8Array(this.buffer.length + bytes.length);
    joined.set(this.buffer, 0);
    joined.set(bytes, this.buffer.length);
    this.buffer = joined;
    while (this.buffer.length >= HEADER_BYTES) {
      const view = new DataView(this.buffer.buffer, this.buffer.byteOffset, HEADER_BYTES);
      const kind = view.getUint8(0);
      const size = view.getUint32(1);
      const seq = view.getBigUint64(5);
      if (!size || size > 8 * 1024 * 1024) {
        this.changed({ error: 'invalid_frame' });
        this.close();
        return;
      }
      if (this.buffer.length < HEADER_BYTES + size) return;
      const payload = this.buffer.slice(HEADER_BYTES, HEADER_BYTES + size);
      this.buffer = this.buffer.slice(HEADER_BYTES + size);
      if (kind === KIND_FRAME) this.onFrame(seq, payload);
      else if (kind === KIND_CONTROL) this.onControl(payload);
    }
  }

  onFrame(seq, jpeg) {
    // 帧可能比绘制快：只保留最新的一帧，旧的直接丢，画面不滞后。
    this.latest = { seq, jpeg };
    this.pump();
  }

  onControl(payload) {
    let message;
    try {
      message = JSON.parse(decoder.decode(payload));
    } catch (error) {
      this.changed({ error: 'invalid_frame' });
      return;
    }
    if (message.type === 'input') {
      const id = message.id || 0;
      const sent = id ? this.inputSentAt.get(id) : 0;
      const inputMs = sent ? Math.round(performance.now() - sent) : 0;
      // 比它早的事件要么已回执、要么被合并掉了，都不用再留。
      if (id) {
        for (const key of this.inputSentAt.keys()) {
          if (key > id) break;
          this.inputSentAt.delete(key);
        }
      }
      this.changed({ ack: message, inputMs });
    } else if (message.type === 'error') {
      this.changed({ error: message.error || 'device_error' });
    }
  }

  async pump() {
    if (this.drawing || this.closed) return;
    this.drawing = true;
    try {
      while (this.latest && !this.closed) {
        const frame = this.latest;
        this.latest = null;
        await this.draw(frame);
      }
    } finally {
      this.drawing = false;
    }
  }

  async draw(frame) {
    if (!frame) return;
    // 拿到的是裸 JPEG 字节：直接进 Blob，不用 base64 也不用 JSON。
    let bitmap;
    try {
      bitmap = await createImageBitmap(new Blob([frame.jpeg], { type: 'image/jpeg' }));
    } catch (error) {
      // 解码失败也要确认：否则这一帧一直挂着，设备侧要等超时才放行下一帧，
      // 整条画面链路会卡成 0.2fps（2026-10-30 实测）。
      this.changed({ error: `decode_failed: ${error?.message || error}` });
      this.ack(frame.seq);
      return;
    }
    try {
      if (this.closed) return;
      // 尺寸不变就不要重设：重设 canvas.width/height 会清空并重新分配
      // 画布，每帧都做会把页面拖卡。
      if (this.canvas.width !== bitmap.width) this.canvas.width = bitmap.width;
      if (this.canvas.height !== bitmap.height) this.canvas.height = bitmap.height;
      this.canvas.getContext('2d').drawImage(bitmap, 0, 0);
      // fps 读数的数据源：只数真正画出来的帧（解码失败的不算）。
      this.frameCount++;
      // live 只报一次：每帧都报会把整页拉进响应式重渲染（渲染开销比解码还大）。
      if (!this.reportedLive) {
        this.reportedLive = true;
        this.changed({ live: true });
      }
    } finally {
      bitmap.close();
      // 画完才 ack：设备→Chrome 的节奏由页面消费速度决定。
      this.ack(frame.seq);
    }
  }

  mouse(event, eventType) {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const button = ['left', 'middle', 'right'][event.button] || 'none';
    return {
      type: 'input_mouse',
      eventType,
      x: (event.clientX - rect.left) / rect.width,
      y: (event.clientY - rect.top) / rect.height,
      button,
      buttons: event.buttons || 0,
      clickCount: eventType === 'mouseMoved' ? 0 : (event.detail || 1),
      modifiers: modifiers(event),
    };
  }

  bind() {
    const canvas = this.canvas;
    const keyboard = this.keyboard;
    const on = (node, name, fn, options) => {
      node.addEventListener(name, fn, options);
      this.listeners.push(() => node.removeEventListener(name, fn, options));
    };
    on(canvas, 'pointerdown', event => {
      event.preventDefault();
      keyboard.focus({ preventScroll: true });
      if (canvas.setPointerCapture) canvas.setPointerCapture(event.pointerId);
      const message = this.mouse(event, 'mousePressed');
      if (message) this.send(message);
    });
    on(canvas, 'pointerup', event => {
      event.preventDefault();
      const message = this.mouse(event, 'mouseReleased');
      if (message) this.send(message);
    });
    on(canvas, 'pointermove', event => {
      this.move = this.mouse(event, 'mouseMoved');
      if (this.moveTimer) return;
      this.moveTimer = setTimeout(() => {
        this.moveTimer = null;
        if (this.move) {
          this.send(this.move);
          this.move = null;
        }
      }, 30);
    });
    on(canvas, 'contextmenu', event => event.preventDefault());
    on(canvas, 'wheel', event => {
      event.preventDefault();
      const message = this.mouse(event, 'mouseWheel');
      if (!message) return;
      const step = event.deltaMode === 1 ? 16 : 1;
      this.send({ ...message, button: 'none', deltaX: event.deltaX * step, deltaY: event.deltaY * step });
    }, { passive: false });
    on(keyboard, 'keydown', event => {
      if (event.isComposing || event.key === 'Process' || event.key === 'Dead') return;
      // 可打印字符走 text 通道（insertText）：中文与粘贴不丢字。
      if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) return;
      event.preventDefault();
      const message = {
        type: 'input_keyboard',
        eventType: 'keyDown',
        key: event.key,
        code: event.code,
        modifiers: modifiers(event),
        windowsVirtualKeyCode: event.keyCode,
      };
      this.keys.set(event.code, message);
      this.send(message);
    });
    on(keyboard, 'keyup', event => {
      const message = this.keys.get(event.code);
      if (!message) return;
      event.preventDefault();
      this.keys.delete(event.code);
      this.send({ ...message, eventType: 'keyUp', modifiers: modifiers(event) });
    });
    on(keyboard, 'input', event => {
      if (event.isComposing) return;
      const value = keyboard.value;
      if (!value) return;
      keyboard.value = '';
      this.send({ type: 'text', text: value });
    });
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    if (this.moveTimer) clearTimeout(this.moveTimer);
    if (this.fpsTimer) { clearInterval(this.fpsTimer); this.fpsTimer = null; }
    if (this.onVisibility) {
      document.removeEventListener('visibilitychange', this.onVisibility);
      this.onVisibility = null;
    }
    for (const remove of this.listeners) remove();
    this.listeners = [];
    this.stream.close();
    this.keyboard.value = '';
  }
}

// BrowserSession 只有一份选中状态。所有动作按点击顺序串行，页面级调用
// 显式携带 host/target；后台列表刷新不得在动作期间抢走选择。
export class BrowserSession {
  constructor(hosts, changed = () => {}) {
    this.hosts = hosts;
    this.changed = changed;
    this.state = {
      devices: [], selectedHostId: '', selectedPageId: '', pageUrl: '',
      live: false, dialog: null, dialogText: '', busy: false, refreshing: false, status: '',
      fps: 0, inputMs: 0,
    };
    this.directory = new BrowserDirectory(hosts, rows => this.onRows(rows));
    this.pageByHost = new Map();
    this.queue = Promise.resolve();
    this.viewer = null;
    this.viewerConnection = null;
    this.closed = false;
    this.timer = null;
  }

  device(hostId = this.state.selectedHostId) {
    return this.state.devices.find(row => row.id === hostId);
  }

  page(hostId = this.state.selectedHostId, pageId = this.state.selectedPageId) {
    return this.device(hostId)?.pages.find(item => item.id === pageId);
  }

  connection(hostId = this.state.selectedHostId) {
    return this.directory.connection(hostId);
  }

  onRows(rows) {
    this.state.devices = rows.map(row => ({ ...row, pages: [...row.pages] }));
    if (!this.device()) {
      this.state.selectedHostId = this.state.devices.find(row => row.status === 'ready')?.id || '';
      this.state.selectedPageId = '';
    }
    this.ensureSelection();
    this.syncViewer();
    this.changed(this.state);
  }

  // 只有空闲列表刷新才能修复外部关闭造成的失效选择。动作期间的旧列表
  // 只更新展示，不把新建/刚选择的 target 换回第一页。
  ensureSelection() {
    if (this.closed || this.state.busy) return;
    const device = this.device();
    if (!device || device.status !== 'ready') return;
    const selected = this.page();
    if (selected) {
      this.state.pageUrl = selected.url || '';
      return;
    }
    // 已有选择突然不在列表里，可能是动作前后返回的旧快照。重新拉最新
    // targets 确认，不能直接回退到第一页。
    if (this.state.selectedPageId) {
      this.confirmSelection(device.id, this.state.selectedPageId);
      return;
    }
    const next = this.pageByHost.get(device.id);
    const page = device.pages.find(item => item.id === next) || device.pages[0];
    if (page) this.selectWindow(device.id, page.id);
  }

  confirmSelection(hostId, pageId) {
    return this.act(async () => {
      await this.refreshPages(hostId);
      if (this.state.selectedHostId !== hostId || this.state.selectedPageId !== pageId) return;
      const selected = this.page(hostId, pageId);
      if (selected) {
        this.state.pageUrl = selected.url || '';
        this.changed(this.state);
        return;
      }
      const preferred = this.pageByHost.get(hostId);
      const next = this.device(hostId)?.pages.find(item => item.id === preferred) || this.device(hostId)?.pages[0];
      if (next) {
        await this.call('attach', { target_id: next.id }, hostId);
        this.state.selectedPageId = next.id;
        this.pageByHost.set(hostId, next.id);
        this.state.pageUrl = next.url || '';
      } else {
        this.state.selectedPageId = '';
        this.state.pageUrl = '';
      }
      this.syncViewer();
      this.changed(this.state);
    });
  }

  async refresh({ retryFailed = false } = {}) {
    if (this.state.refreshing || this.closed) return;
    this.state.refreshing = true;
    this.changed(this.state);
    try {
      await this.directory.refresh({ retryFailed });
      if (this.closed) return;
      await this.updateDialog();
    } catch (error) {
      this.state.status = String(error?.message || error);
    } finally {
      this.state.refreshing = false;
      this.changed(this.state);
    }
  }

  // 等被关闭的 target 从 targets 列表消失（至多 ~2s；beforeunload 拖住时
  // 按现状继续，不阻塞后续操作）。
  async waitTargetGone(hostId, pageId) {
    for (let i = 0; i < 20; i++) {
      await this.refreshPages(hostId);
      if (!this.device(hostId)?.pages.some(p => p.id === pageId)) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  async refreshPages(hostId) {
    const pages = await this.directory.listPages(hostId);
    this.state.devices = this.state.devices.map(row => row.id === hostId ? { ...row, pages } : row);
    const selected = this.page(hostId);
    if (selected && hostId === this.state.selectedHostId) this.state.pageUrl = selected.url || '';
  }

  attachViewer(canvas, keyboard) {
    this.canvas = canvas;
    this.keyboard = keyboard;
    this.syncViewer();
    // 页面回到前台：自己建新的流（隐藏时那条已经放掉了）。
    this.onVisibility = () => {
      if (!document.hidden) this.syncViewer();
    };
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  syncViewer() {
    const connection = this.connection();
    if (!this.canvas || !keyboardReady(this) || !connection) { this.stopViewer(); return; }
    // 没有选中页（全部标签已关）不开流：设备不该对着死页面推帧。
    if (!this.state.selectedPageId) { this.stopViewer(); return; }
    if (this.viewer && !this.viewer.closed && this.viewerConnection === connection) return;
    this.stopViewer();
    this.viewerConnection = connection;
    // 流断过之后重新建流（页面活着就自己建）：上一次的错误提示先清掉。
    this.state.status = '';
    this.viewer = new BrowserViewer(this.canvas, this.keyboard, {
      connection, changed: event => this.onStream(event),
    });
  }

  stopViewer() {
    if (this.viewer) { this.viewer.close(); this.viewer = null; }
    this.viewerConnection = null;
    this.state.live = false;
    this.state.fps = 0;
    this.state.inputMs = 0;
  }

  onStream(event) {
    // 帧率与输入延迟：header 上的自测读数。
    let dirty = false;
    if (event.fps !== undefined && event.fps !== this.state.fps) {
      this.state.fps = event.fps;
      dirty = true;
    }
    if (event.inputMs !== undefined && event.inputMs !== this.state.inputMs) {
      this.state.inputMs = event.inputMs;
      dirty = true;
    }
    if (event.live) { this.state.live = true; this.changed(this.state); return; }
    if (event.error) {
      this.state.live = false;
      this.state.status = String(event.error);
      this.stopViewer();
      this.changed(this.state);
      return;
    }
    if (dirty) this.changed(this.state);
  }

  // 动作不丢弃：快速 A→B 会依次完成，最终一定是 B。异常进入统一状态，
  // 不产生未处理 rejection，也不留下半更新的选中项。
  act(fn) {
    if (this.closed) return this.queue;
    let queued;
    const run = async () => {
      if (this.closed) return;
      this.state.busy = true;
      this.state.status = '';
      this.changed(this.state);
      try {
        return await fn();
      } catch (error) {
        this.state.status = String(error?.message || error);
        this.changed(this.state);
        return undefined;
      } finally {
        if (this.queue === queued) {
          this.state.busy = false;
          this.changed(this.state);
        }
      }
    };
    queued = this.queue.then(run, run);
    this.queue = queued;
    return queued;
  }

  async call(tool, args, hostId = this.state.selectedHostId) {
    const connection = this.connection(hostId);
    if (!connection) throw new Error('device is not connected');
    return browserCall(connection, tool, args);
  }

  async cdp(method, params, targetId = '', hostId = this.state.selectedHostId) {
    const args = { method, params };
    if (targetId) args.target_id = targetId;
    return this.call('cdp', args, hostId);
  }

  async selectWindow(hostId, pageId) {
    return this.act(async () => {
      await this.call('attach', { target_id: pageId }, hostId);
      this.state.selectedHostId = hostId;
      this.state.selectedPageId = pageId;
      this.pageByHost.set(hostId, pageId);
      await this.refreshPages(hostId);
      this.state.pageUrl = this.page(hostId, pageId)?.url || '';
      this.syncViewer();
      this.changed(this.state);
    });
  }

  selectPage(pageId) {
    return this.selectWindow(this.state.selectedHostId, pageId);
  }

  selectDevice(hostId) {
    const preferred = this.pageByHost.get(hostId);
    const device = this.device(hostId);
    const page = device?.pages.find(item => item.id === preferred) || device?.pages[0];
    if (!page) {
      return this.act(async () => {
        this.state.selectedHostId = hostId;
        this.state.selectedPageId = '';
        this.state.pageUrl = '';
        this.syncViewer();
        this.changed(this.state);
      });
    }
    return this.selectWindow(hostId, page.id);
  }

  createPage(hostId = this.state.selectedHostId, url = 'about:blank') {
    return this.act(async () => {
      const result = await this.cdp('Target.createTarget', { url }, '', hostId);
      if (!result?.targetId) throw new Error('Target.createTarget returned no targetId');
      await this.call('attach', { target_id: result.targetId }, hostId);
      this.state.selectedHostId = hostId;
      this.state.selectedPageId = result.targetId;
      this.pageByHost.set(hostId, result.targetId);
      await this.refreshPages(hostId);
      this.state.pageUrl = this.page(hostId, result.targetId)?.url || '';
      this.syncViewer();
      this.changed(this.state);
    });
  }

  closePage(hostId, pageId) {
    return this.act(async () => {
      await this.cdp('Target.closeTarget', { targetId: pageId }, '', hostId);
      // closeTarget 异步生效：getTargets 可能还返回正在关闭的页面，立刻拿
      // 旧列表去 attach 会报 No target with given id found。先等它从列表消失。
      await this.waitTargetGone(hostId, pageId);
      if (hostId === this.state.selectedHostId && pageId === this.state.selectedPageId) {
        const next = this.device(hostId)?.pages[0];
        if (next) {
          await this.call('attach', { target_id: next.id }, hostId);
          this.state.selectedPageId = next.id;
          this.pageByHost.set(hostId, next.id);
        } else {
          this.state.selectedPageId = '';
        }
      }
      if (hostId === this.state.selectedHostId) {
        this.state.pageUrl = this.page(hostId)?.url || '';
      }
      this.syncViewer();
      this.changed(this.state);
    });
  }

  navigate(url) {
    const raw = String(url ?? '').trim();
    if (!raw) return this.queue;
    const target = /^[a-z][a-z\d+.-]*:/i.test(raw) ? raw : 'https://' + raw;
    const hostId = this.state.selectedHostId;
    const pageId = this.state.selectedPageId;
    return this.act(async () => {
      await this.call('navigate', { url: target, target_id: pageId }, hostId);
      await this.refreshPages(hostId);
      this.state.pageUrl = this.page(hostId, pageId)?.url || '';
      this.changed(this.state);
    });
  }

  reload() {
    const hostId = this.state.selectedHostId;
    const pageId = this.state.selectedPageId;
    return this.act(async () => {
      await this.cdp('Page.reload', {}, pageId, hostId);
      await this.refreshPages(hostId);
      this.changed(this.state);
    });
  }

  goBack() { return this.history(-1); }
  goForward() { return this.history(1); }

  history(step) {
    const hostId = this.state.selectedHostId;
    const pageId = this.state.selectedPageId;
    return this.act(async () => {
      const history = await this.cdp('Page.getNavigationHistory', {}, pageId, hostId);
      const entries = history?.entries || [];
      const index = Number(history?.currentIndex || 0) + step;
      if (index < 0 || index >= entries.length) return;
      await this.cdp('Page.navigateToHistoryEntry', { entryId: entries[index].id }, pageId, hostId);
      await this.refreshPages(hostId);
      this.state.pageUrl = this.page(hostId, pageId)?.url || '';
      this.changed(this.state);
    });
  }

  async updateDialog() {
    const connection = this.connection();
    if (!connection) return;
    try {
      const status = await browserCall(connection, 'dialog_status', {});
      if (status?.hasDialog) {
        if (!this.state.dialog || this.state.dialog.message !== status.message) {
          this.state.dialogText = status.defaultPrompt || '';
        }
        this.state.dialog = { type: status.type, message: status.message };
      } else this.state.dialog = null;
    } catch (error) {
      // 下一轮轮询重试。
    }
  }

  answerDialog(accept) {
    const hostId = this.state.selectedHostId;
    const pageId = this.state.selectedPageId;
    return this.act(async () => {
      await this.call('dialog_answer', { accept, text: this.state.dialogText, target_id: pageId }, hostId);
      this.state.dialog = null;
      this.changed(this.state);
    });
  }

  startPolling(interval = 3000) {
    const tick = async () => {
      if (this.closed) return;
      await this.refresh().catch(() => {});
      if (this.closed) return;
      this.timer = setTimeout(tick, interval);
    };
    this.timer = setTimeout(tick, interval);
  }

  dispose() {
    this.closed = true;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (this.onVisibility) {
      document.removeEventListener('visibilitychange', this.onVisibility);
      this.onVisibility = null;
    }
    this.stopViewer();
    this.directory.close();
  }
}

// keyboardReady 画布与键盘输入框都在才挂画面。
const keyboardReady = session => !!(session.canvas && session.keyboard);
