import test from 'node:test';
import assert from 'node:assert/strict';
import { ACK_WATCHDOG_MS, BrowserSession, BrowserViewer } from './browser.js';

function makeWorld(hostIds = ['mbp']) {
  const devices = new Map();
  let next = 0;
  const page = title => ({ id: `target-${++next}`, title, url: `https://${title}.test/`, type: 'page' });
  const makeDevice = id => {
    const first = page(`${id}-a`);
    const device = {
      id, pages: [first], current: first.id, attachCalls: 0,
      connection: null, onCall: null,
      async call(tool, args) {
        this.onCall?.(tool, args);
        if (tool === 'targets') return { targetInfos: this.pages.map(p => ({ targetId: p.id, title: p.title, url: p.url, type: 'page' })) };
        if (tool === 'attach') {
          if (!this.pages.some(p => p.id === args.target_id)) throw new Error('missing target');
          this.current = args.target_id;
          this.attachCalls++;
          return { targetId: args.target_id, sessionId: `session-${args.target_id}` };
        }
        if (tool === 'navigate') {
          const target = this.pages.find(p => p.id === args.target_id);
          if (!target) throw new Error('missing navigate target');
          target.url = args.url;
          target.title = args.url;
          this.current = args.target_id;
          return {};
        }
        if (tool === 'dialog_status') return { hasDialog: false };
        if (tool === 'dialog_answer') return { answered: true };
        if (tool === 'cdp') {
          if (args.method === 'Target.createTarget') {
            const created = page(`${this.id}-${this.pages.length + 1}-${Date.now()}`);
            created.url = args.params.url;
            created.title = args.params.url;
            this.pages.push(created);
            return { targetId: created.id };
          }
          if (args.method === 'Target.closeTarget') {
            this.pages = this.pages.filter(p => p.id !== args.params.targetId);
            return {};
          }
          return {};
        }
        throw new Error(`unexpected tool ${tool}`);
      },
    };
    device.connection = {
      closed: false,
      async execCall(script, { stdin }) {
        const tool = script.split(' ')[1];
        try {
          const result = await device.call(tool, JSON.parse(stdin || '{}'));
          return { content: JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(result) }] }), attrs: { exit_code: '0' } };
        } catch (error) {
          return { content: JSON.stringify({ isError: true, content: [{ type: 'text', text: error.message }] }), attrs: { exit_code: '1' } };
        }
      },
      async close() { this.closed = true; },
    };
    return device;
  };
  for (const id of hostIds) devices.set(id, makeDevice(id));
  const hosts = {
    query() {
      return {
        async load() {
          return hostIds.map(id => ({ id, name: id, status: 'enabled', caps: { transports: { rtc: { enabled: true, protocol: 'hosts_rtc/3' } } } }));
        },
        dispose() {},
      };
    },
    async openTools(id) { return devices.get(id).connection; },
  };
  return { hosts, devices };
}

async function ready(session, hostId = 'mbp') {
  const connection = await session.hosts.openTools(hostId);
  await session.connectDevice({ id: hostId, name: hostId }, connection);
  await session.queue;
}

test('new target is not replaced by a stale polling list', async () => {
  const { hosts, devices } = makeWorld();
  const session = new BrowserSession(hosts);
  await ready(session);
  const stale = session.state.devices.map(row => ({ ...row, pages: [...row.pages] }));
  devices.get('mbp').onCall = (tool, args) => {
    if (tool === 'cdp' && args.method === 'Target.createTarget') session.onRows(stale);
  };
  await session.createPage('mbp');
  assert.equal(session.state.selectedPageId, devices.get('mbp').current);
  assert.equal(session.page()?.url, 'about:blank', JSON.stringify(session.state));
  // 动作完成后才到达的旧轮询也不能抢选；确认请求会看到新 target。
  session.onRows(stale);
  await session.queue;
  assert.equal(session.state.selectedPageId, devices.get('mbp').current);
  assert.equal(session.page()?.url, 'about:blank');
  session.dispose();
});

test('rapid A to B selection is serialized and ends on B', async () => {
  const { hosts, devices } = makeWorld();
  const session = new BrowserSession(hosts);
  await ready(session);
  const a = session.state.selectedPageId;
  await session.createPage('mbp');
  const b = session.state.selectedPageId;
  const first = session.selectWindow('mbp', a);
  const second = session.selectWindow('mbp', b);
  await Promise.all([first, second]);
  assert.equal(session.state.selectedPageId, b);
  assert.equal(devices.get('mbp').current, b);
  session.dispose();
});

test('closing the selected page attaches the fallback before URL navigation', async () => {
  const { hosts, devices } = makeWorld();
  const session = new BrowserSession(hosts);
  await ready(session);
  const a = session.state.selectedPageId;
  await session.createPage('mbp');
  const b = session.state.selectedPageId;
  await session.closePage('mbp', b);
  assert.equal(session.state.selectedPageId, a);
  assert.equal(devices.get('mbp').current, a);
  await session.navigate('https://after-close.test/');
  assert.equal(devices.get('mbp').pages[0].url, 'https://after-close.test/');
  assert.equal(session.state.pageUrl, 'https://after-close.test/', JSON.stringify(session.state));
  session.dispose();
});

// closeTarget 异步生效：旧快照里还含正在关闭的页面时，不能拿它去 attach
// （线上报错 No target with given id found 的来源）。
test('closePage waits for the closing target to disappear before attaching next', async () => {
  const { hosts, devices } = makeWorld();
  const session = new BrowserSession(hosts);
  await ready(session);
  const first = session.state.selectedPageId;
  await session.createPage('mbp');
  await session.selectWindow('mbp', first);
  const device = devices.get('mbp');
  const original = device.call.bind(device);
  // 模拟异步关闭：150ms 后 target 才从列表消失（第一次刷新仍看得到它）。
  device.call = async (tool, args) => {
    if (tool === 'cdp' && args.method === 'Target.closeTarget') {
      const id = args.params.targetId;
      setTimeout(() => { device.pages = device.pages.filter(p => p.id !== id); }, 150);
      return {};
    }
    return original(tool, args);
  };
  const attaches = [];
  device.onCall = (tool, args) => { if (tool === 'attach') attaches.push(args.target_id); };
  await session.closePage('mbp', first);
  assert.ok(!attaches.includes(first), `must not attach the closing target: ${JSON.stringify(attaches)}`);
  assert.notEqual(session.state.selectedPageId, first);
  assert.ok(session.state.selectedPageId, 'fallback page must be selected');
  session.dispose();
});

test('switching devices replaces the sidebar with only the selected device tabs', async () => {
  const { hosts, devices } = makeWorld(['mbp', 'linux']);
  const session = new BrowserSession(hosts);
  let opens = 0;
  const openTools = hosts.openTools;
  hosts.openTools = async id => { opens++; return openTools(id); };
  await ready(session);
  const mbpConnection = devices.get('mbp').connection;
  await session.connectDevice({ id: 'linux', name: 'linux' }, devices.get('linux').connection);
  await session.queue;
  assert.equal(opens, 1, 'the session reuses the connector connection instead of opening another');
  assert.equal(session.state.selectedHostId, 'linux');
  assert.equal(session.state.devices.length, 1);
  assert.equal(session.state.devices[0].id, 'linux');
  assert.ok(session.state.devices[0].pages.every(page => page.title.startsWith('linux-')));
  assert.equal(mbpConnection.closed, true);
  assert.ok(session.page()?.url.includes('linux-'));
  session.dispose();
});

test('navigating with no window creates a tab directly at the requested URL', async () => {
  const { hosts, devices } = makeWorld();
  const session = new BrowserSession(hosts);
  await ready(session);
  const first = session.state.selectedPageId;
  await session.closePage('mbp', first);
  assert.equal(session.state.selectedPageId, '');
  assert.equal(session.device().pages.length, 0);
  await session.navigate('example.test');
  assert.equal(session.device().pages.length, 1);
  assert.equal(session.page()?.url, 'https://example.test');
  assert.equal(session.state.pageUrl, 'https://example.test');
  assert.equal(devices.get('mbp').current, session.state.selectedPageId);
  session.dispose();
});

// fps 读数：收到帧并成功绘制后必须自增（曾经只有初始化与清零，fps 恒 0）。
test('viewer counts drawn frames for fps', async () => {
  const oldDocument = globalThis.document;
  const oldBitmap = globalThis.createImageBitmap;
  globalThis.document = { hidden: false, addEventListener() {}, removeEventListener() {} };
  globalThis.createImageBitmap = async () => ({ width: 8, height: 8, close() {} });
  const events = [];
  const canvas = {
    width: 0, height: 0,
    getContext: () => ({ drawImage() {} }),
    addEventListener() {}, removeEventListener() {},
  };
  const keyboard = { value: '', addEventListener() {}, removeEventListener() {}, focus() {} };
  const connection = {
    openStream: () => ({ ready: Promise.resolve(), send: () => true, close: async () => {} }),
  };
  try {
    const viewer = new BrowserViewer(canvas, keyboard, { connection, changed: e => events.push(e) });
    // kind 1 = FRAME（协议头见 browser.js 顶部）；payload 被 mock 的解码器忽略。
    viewer.receive(viewer.packet(1, 7, new Uint8Array([1, 2, 3])));
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(viewer.frameCount, 1, 'drawn frame must increment frameCount');
    viewer.frameWindowStart = performance.now() - 1000;
    viewer.reportFps();
    assert.ok(events.some(e => e.fps > 0), `fps must be reported: ${JSON.stringify(events)}`);
    viewer.close();
  } finally {
    globalThis.document = oldDocument;
    globalThis.createImageBitmap = oldBitmap;
  }
});

// 坐标必须钳在 [0,1]：按下鼠标后指针被捕获，拖出画布时事件仍然发到画布上，
// 越界坐标会被设备端拒绝（并打断整条画面链路）。
test('mouse coordinates are clamped to the viewport', () => {
  const oldDocument = globalThis.document;
  globalThis.document = { hidden: false, addEventListener() {}, removeEventListener() {} };
  try {
    const canvas = {
      width: 0, height: 0,
      getContext: () => ({ drawImage() {} }),
      getBoundingClientRect: () => ({ left: 100, top: 50, width: 400, height: 200 }),
      addEventListener() {}, removeEventListener() {},
    };
    const keyboard = { value: '', addEventListener() {}, removeEventListener() {}, focus() {} };
    const connection = { openStream: () => ({ ready: Promise.resolve(), send: () => true, close: () => {} }) };
    const viewer = new BrowserViewer(canvas, keyboard, { connection, changed: () => {} });
    const inside = viewer.mouse({ clientX: 300, clientY: 150, button: 0, buttons: 1, detail: 1 }, 'mousePressed');
    assert.equal(inside.x, 0.5);
    assert.equal(inside.y, 0.5);
    const outside = viewer.mouse({ clientX: -50, clientY: 999, button: 0, buttons: 1, detail: 1 }, 'mouseMoved');
    assert.equal(outside.x, 0);
    assert.equal(outside.y, 1);
    viewer.close();
  } finally {
    globalThis.document = oldDocument;
  }
});

// 确认看门狗：帧画不完（窗口不可见、解码卡住）也必须在窗口期内确认，
// 否则设备端 30 秒后把订阅者当僵尸断流（Byte stream disconnected）。
test('frame is confirmed even when the draw stalls', async () => {
  const oldDocument = globalThis.document;
  const oldBitmap = globalThis.createImageBitmap;
  globalThis.document = { hidden: false, addEventListener() {}, removeEventListener() {} };
  globalThis.createImageBitmap = () => new Promise(() => {}); // 永远不 resolve
  const sent = [];
  const canvas = {
    width: 0, height: 0,
    getContext: () => ({ drawImage() {} }),
    addEventListener() {}, removeEventListener() {},
  };
  const keyboard = { value: '', addEventListener() {}, removeEventListener() {}, focus() {} };
  const connection = {
    openStream: () => ({ ready: Promise.resolve(), send: bytes => { sent.push(bytes); return true; }, close: () => {} }),
  };
  try {
    const viewer = new BrowserViewer(canvas, keyboard, { connection, changed: () => {} });
    viewer.receive(viewer.packet(1, 7, new Uint8Array([1, 2, 3])));
    await new Promise(resolve => setTimeout(resolve, ACK_WATCHDOG_MS + 100));
    const acks = sent.filter(bytes => bytes[0] === 4);
    assert.equal(acks.length, 1, '画不完的帧也必须确认');
    viewer.close();
  } finally {
    globalThis.document = oldDocument;
    globalThis.createImageBitmap = oldBitmap;
  }
});

// 会话级故障处理：输入类错误只提示，拆流的是流本身且自己接回来。
test('input errors keep the stream, a dropped stream reconnects quietly', async () => {
  const { hosts, devices } = makeWorld();
  const device = devices.get('mbp');
  const streams = [];
  device.connection.openStream = () => {
    const stream = { ready: Promise.resolve(), send: () => true, close: () => {} };
    streams.push(stream);
    return stream;
  };
  const oldDocument = globalThis.document;
  globalThis.document = { hidden: false, addEventListener() {}, removeEventListener() {} };
  try {
    const canvas = {
      width: 0, height: 0,
      getContext: () => ({ drawImage() {} }),
      addEventListener() {}, removeEventListener() {},
    };
    const keyboard = { value: '', addEventListener() {}, removeEventListener() {}, focus() {} };
    const session = new BrowserSession(hosts);
    await ready(session);
    session.attachViewer(canvas, keyboard);
    assert.ok(session.viewer, '画面流应当已建立');

    session.onStream({ hint: 'mouse coordinates must be normalized to [0,1]' });
    assert.ok(session.viewer, '输入类错误不得拆掉画面流');
    assert.equal(session.state.status, '', '输入类错误不得当致命错误');
    assert.equal(session.state.hint, 'mouse coordinates must be normalized to [0,1]');

    session.onStream({ closed: true, reason: 'Byte stream disconnected' });
    assert.equal(session.state.status, '', '断流不是错误：自己接回来就行');
    assert.equal(session.viewer, null);
    await new Promise(resolve => setTimeout(resolve, 1200));
    assert.ok(session.viewer, '断流后应当自己接回来');
    assert.ok(streams.length >= 2, '应当重新开过一条流');
    session.dispose();
  } finally {
    globalThis.document = oldDocument;
  }
});

// 看不见平台窗口时不占着设备的画面流：恢复可见后自己接回来。
test('hidden view releases the device stream and takes it back', async () => {
  const { hosts, devices } = makeWorld();
  const device = devices.get('mbp');
  device.connection.openStream = () => ({ ready: Promise.resolve(), send: () => true, close: () => {} });
  const oldDocument = globalThis.document;
  const listeners = {};
  globalThis.document = {
    hidden: false,
    addEventListener(name, fn) { (listeners[name] ||= []).push(fn); },
    removeEventListener() {},
  };
  try {
    const canvas = {
      width: 0, height: 0,
      getContext: () => ({ drawImage() {} }),
      addEventListener() {}, removeEventListener() {},
    };
    const keyboard = { value: '', addEventListener() {}, removeEventListener() {}, focus() {} };
    const session = new BrowserSession(hosts);
    await ready(session);
    session.attachViewer(canvas, keyboard);
    assert.ok(session.viewer, '画面流应当已建立');

    globalThis.document.hidden = true;
    (listeners.visibilitychange || []).forEach(fn => fn());
    assert.equal(session.viewer, null, '看不见时不得占着设备的流');

    globalThis.document.hidden = false;
    (listeners.visibilitychange || []).forEach(fn => fn());
    assert.ok(session.viewer, '恢复可见后应当自己接回来');
    session.dispose();
  } finally {
    globalThis.document = oldDocument;
  }
});
