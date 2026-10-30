import test from 'node:test';
import assert from 'node:assert/strict';
import { BrowserSession } from './browser.js';

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

async function ready(session) {
  await session.refresh();
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

test('non-selected cross-device close keeps the current host and target', async () => {
  const { hosts, devices } = makeWorld(['mbp', 'linux']);
  const session = new BrowserSession(hosts);
  await ready(session);
  const selected = session.state.selectedPageId;
  await session.createPage('linux');
  const linuxTarget = session.state.selectedPageId;
  await session.selectWindow('mbp', selected);
  await session.closePage('linux', linuxTarget);
  assert.equal(session.state.selectedHostId, 'mbp', JSON.stringify(session.state));
  assert.equal(session.state.selectedPageId, selected);
  assert.equal(devices.get('mbp').current, selected);
  assert.equal(devices.get('linux').pages.some(p => p.id === linuxTarget), false);
  session.dispose();
});
