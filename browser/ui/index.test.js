import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createContext, runInContext} from 'node:vm';
import {BrowserDirectory, browserCall} from './browser.js';

// Execute the page's real setup, including its discovery callback and selection
// logic. Only module imports and the canvas transport are supplied by the fixture.
const page = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const setup = page.match(/<script setup>([\s\S]*?)<\/script>/)[1]
  .replace(/^\s*import[^\n]+$/gm, '');
const tick = () => new Promise(resolve => setImmediate(resolve));
const host = id => ({id, status:'enabled', caps:{transports:{rtc:{enabled:true, protocol:'hosts_rtc/3'}}}});
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((done, fail) => {resolve = done; reject = fail;});
  return {promise, resolve, reject};
};

function fixture(t, connections, query = {}) {
  const viewers = [], calls = [], errors = [], timers = new Map();
  let nextTimer = 0;
  const connection = (id, url = 'about:blank') => ({
    id,
    execCall: async (script, options) => {
      const tool = script.split(' ')[3];
      calls.push({id, tool, input:JSON.parse(options.stdin)});
      const data = tool === 'agent_browser_tab_list'
        ? {tabs:[{tabId:`tab-${id}`, active:true, url}]} : {hasDialog:false};
      return {content:JSON.stringify({structuredContent:{response:{data}}}), attrs:{exit_code:'0'}};
    },
    close: async () => {},
  });
  const state = createContext({
    BrowserDirectory, browserCall,
    BrowserViewer: class {
      constructor(_canvas, _keyboard, {connection}) {viewers.push(connection.id);}
      close() {this.closed = true;}
    },
    $hosts: {
      query: () => ({load:async () => Object.keys(connections).map(host), dispose(){}}),
      openTools: async id => typeof connections[id] === 'function' ? connections[id](connection) : connection(id, connections[id]),
    },
    $refs:{canvas:{}, keyboard:{}},
    $router:{current:{query}},
    $message:{error:message => errors.push(message)}, $t:key => key,
    setTimeout: (callback, delay) => {timers.set(++nextTimer, {callback, delay}); return nextTimer;},
    clearTimeout: id => timers.delete(id), URL, console,
  });
  runInContext(setup, state, {filename:'browser/index.html setup'});
  t.after(() => state.disposeBrowser());
  return {state, viewers, calls, errors, poll:async () => {
    assert.equal(timers.size, 1, 'the active page schedules one poll');
    const [id, timer] = timers.entries().next().value;
    assert.equal(timer.delay, 3000);
    timers.delete(id);
    await timer.callback();
  }};
}

const tab = (tabId, active = false) => ({tabId, active, url:`https://${tabId}.test`});
const commandError = message => ({
  content:JSON.stringify({isError:true, content:[{type:'text', text:message}]}), attrs:{exit_code:'1'},
});
const missingTab = id => `Tab ${id} not found; run \`agent-browser tab\` to list open tabs`;
function sharedBrowser(pages, before = () => {}) {
  const browser = {
    id:'mbp', tabs:pages, calls:[],
    async execCall(script, options) {
      const tool = script.split(' ')[3], input = JSON.parse(options.stdin);
      browser.calls.push({tool, input});
      const override = await before(tool, input, browser);
      if (override) return override;
      let data = {};
      if (tool === 'agent_browser_tab_list') data = {tabs:browser.tabs};
      if (tool === 'agent_browser_tab_new') {
        browser.tabs = [...browser.tabs.map(page => ({...page, active:false})), {...tab('new', true), url:input.url}];
      }
      if (tool === 'agent_browser_tab_close') {
        if (!browser.tabs.some(page => page.tabId === input.tab)) return commandError(missingTab(input.tab));
        browser.tabs = browser.tabs.filter(page => page.tabId !== input.tab);
        if (!browser.tabs.some(page => page.active) && browser.tabs[0]) browser.tabs[0].active = true;
      }
      return {content:JSON.stringify({structuredContent:{response:{data}}}), attrs:{exit_code:'0'}};
    },
    close:async () => {},
  };
  return browser;
}

test('closing a stale row synchronizes tabs without closing again or creating a blank page', async t => {
  const browser = sharedBrowser([tab('t4', true), tab('t5')]);
  const {state, errors} = fixture(t, {mbp:() => browser});
  await state.activateBrowser();
  browser.tabs = [tab('t5', true)]; // Another viewer already closed t4.
  await state.closeWindow('mbp', 't4');
  assert.deepEqual(Array.from(state.devices[0].pages, page => page.tabId), ['t5']);
  assert.equal(state.selected().tabId, 't5');
  assert.equal(browser.calls.filter(call => /tab_(close|new)$/.test(call.tool)).length, 0);
  assert.deepEqual(errors, []);
});

test('a tab closed between the list and close commands is accepted only after confirming its absence', async t => {
  const browser = sharedBrowser([tab('t4', true), tab('t5')], (tool, _input, remote) => {
    if (tool === 'agent_browser_tab_close') remote.tabs = [tab('t5', true)];
  });
  const {state, errors} = fixture(t, {mbp:() => browser});
  await state.activateBrowser();
  await state.closeWindow('mbp', 't4');
  assert.deepEqual(Array.from(state.devices[0].pages, page => page.tabId), ['t5']);
  assert.equal(browser.calls.filter(call => call.tool === 'agent_browser_tab_close').length, 1);
  assert.equal(browser.calls.filter(call => call.tool === 'agent_browser_tab_list').length, 3);
  assert.deepEqual(errors, []);
});

test('close errors remain visible when the tab still exists or the error is unrelated', async t => {
  for (const message of [missingTab('t4'), 'Permission denied']) {
    const browser = sharedBrowser([tab('t4', true), tab('t5')], tool =>
      tool === 'agent_browser_tab_close' ? commandError(message) : null);
    const {state, errors} = fixture(t, {mbp:() => browser});
    await state.activateBrowser();
    await state.closeWindow('mbp', 't4');
    assert.deepEqual(errors, [message]);
    assert.deepEqual(Array.from(state.devices[0].pages, page => page.tabId), ['t4', 't5']);
  }
});

test('closing the last tab creates one blank replacement and closes the original ID', async t => {
  const browser = sharedBrowser([tab('t4', true)]);
  const {state, errors} = fixture(t, {mbp:() => browser});
  await state.activateBrowser();
  await state.closeWindow('mbp', 't4');
  assert.deepEqual(browser.calls.filter(call => /tab_(close|new)$/.test(call.tool)), [
    {tool:'agent_browser_tab_new', input:{url:'about:blank'}},
    {tool:'agent_browser_tab_close', input:{tab:'t4'}},
  ]);
  assert.equal(state.selected().tabId, 'new');
  assert.equal(state.isBlankPage(), true);
  assert.deepEqual(errors, []);
});

test('closing a ready device updates it immediately while another device is still being discovered', async t => {
  const slow = deferred(), browser = sharedBrowser([tab('t4', true), tab('t5')]);
  let finish;
  const {state, errors} = fixture(t, {
    mbp:() => browser,
    slow:connection => {finish = () => slow.resolve(connection('slow')); return slow.promise;},
  });
  const activated = state.activateBrowser();
  await tick();
  assert.equal(state.refreshing, true);
  await state.closeWindow('mbp', 't4');
  assert.equal(state.refreshing, true, 'closing does not wait for the slow device');
  assert.deepEqual(Array.from(state.devices.find(host => host.id === 'mbp').pages, page => page.tabId), ['t5']);
  finish();
  await activated;
  assert.deepEqual(Array.from(state.devices.find(host => host.id === 'mbp').pages, page => page.tabId), ['t5'],
    'a later full-directory publication cannot resurrect the closed tab');
  assert.deepEqual(errors, []);
});

test('the page starts a ready device while another RTC connection is pending', async t => {
  const slow = deferred();
  const {state, viewers} = fixture(t, {win:() => slow.promise, mbp:'https://example.test'});
  const activated = state.activateBrowser();
  await tick();
  assert.equal(state.devices.find(row => row.id === 'win').status, 'connecting');
  assert.equal(state.devices.find(row => row.id === 'mbp').status, 'ready');
  assert.equal(state.refreshing, true, 'the slow device is still pending');
  assert.equal(state.selectedHostId, 'mbp');
  assert.deepEqual(viewers, ['mbp'], 'the actual page callback starts the viewer immediately');
  slow.reject(new Error('设备直连超时'));
  await activated;
  assert.equal(state.devices.find(row => row.id === 'win').error, '设备直连超时');
  assert.deepEqual(viewers, ['mbp'], 'late failures do not restart the healthy viewer');
  assert.match(page, /<p[^>]+class="device-error"[^>]*>\{\{host\.error\}\}<br>\{\{\$t\('browser\.retry_hint'\)\}\}<\/p>/,
    'the failure reason is visible text, not only a hover title');
});

test('late discovery preserves a ready device explicitly selected by the user', async t => {
  const slow = deferred();
  let finish;
  const {state, viewers} = fixture(t, {
    first:'https://first.test', chosen:'https://chosen.test',
    later:connection => {finish = () => slow.resolve(connection('later')); return slow.promise;},
  });
  const activated = state.activateBrowser();
  await tick();
  state.selectDevice('chosen');
  assert.equal(state.selectedHostId, 'chosen');
  finish();
  await activated;
  assert.equal(state.selectedHostId, 'chosen');
  assert.deepEqual(viewers, ['first', 'chosen']);
});

test('failed devices wait for manual refresh across polling and page reactivation', async t => {
  const connected = deferred(), listed = deferred();
  let attempts = 0, readyConnection;
  const {state, calls, poll} = fixture(t, {mbp:connection => {
    if (attempts++ === 0) throw new Error('设备直连超时');
    readyConnection = {...connection('mbp'), execCall:() => listed.promise};
    return connected.promise;
  }, healthy:'https://healthy.test'});
  await state.activateBrowser();
  const row = state.devices[0];
  assert.equal(row.error, '设备直连超时');
  await poll();
  await poll();
  state.deactivateBrowser();
  await state.activateBrowser();
  assert.equal(attempts, 1, 'automatic polling and resume do not reopen a failed device');
  assert.equal(calls.filter(call => call.id === 'healthy' && call.tool === 'agent_browser_tab_list').length, 4,
    'healthy devices continue polling');
  assert.equal(row.status, 'error');
  assert.equal(row.error, '设备直连超时');
  assert.match(page, /@click="retryDevices" :disabled="refreshing"/,
    'manual retries are disabled while a discovery round is pending');
  const refreshed = state.retryDevices();
  await tick();
  await state.retryDevices();
  assert.equal(attempts, 2, 'a pending manual refresh cannot duplicate device startup');
  assert.equal(state.devices[0], row, 'the visible row retains its identity');
  assert.equal(row.status, 'connecting');
  assert.equal(row.error, '');
  connected.resolve(readyConnection);
  await tick();
  assert.equal(row.status, 'starting');
  assert.equal(row.error, '');
  listed.resolve({content:JSON.stringify({structuredContent:{response:{data:{tabs:[]}}}}), attrs:{exit_code:'0'}});
  await refreshed;
  assert.equal(row.status, 'ready');
  assert.equal(row.error, '');
  await poll();
  assert.equal(attempts, 2, 'a successful retry resumes polling on the existing connection');
});

test('a query URL still reuses its existing tab when that device arrives later', async t => {
  const slow = deferred(), url = 'https://existing.test/';
  let finish;
  const {state, viewers, calls} = fixture(t, {
    first:'https://first.test',
    later:connection => {finish = () => slow.resolve(connection('later', url)); return slow.promise;},
  }, {url});
  const activated = state.activateBrowser();
  await tick();
  assert.deepEqual(viewers, ['first'], 'the first usable device is shown during URL lookup');
  finish();
  await activated;
  assert.equal(state.selectedHostId, 'later');
  assert.equal(calls.filter(call => call.tool === 'agent_browser_tab_new').length, 0);
  const switches = calls.filter(call => call.tool === 'agent_browser_tab_switch');
  assert.equal(switches.length, 1);
  assert.deepEqual(switches[0], {id:'later', tool:'agent_browser_tab_switch', input:{tab:'tab-later'}});
});
