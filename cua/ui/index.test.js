import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createContext, runInContext} from 'node:vm';
import {CuaSession} from './cua.js';

// The real page setup and controller run against an in-memory tool transport.
// No connection to a device, desktop capture, or real input is used by this suite.
const page = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const setup = page.match(/<script setup>([\s\S]*?)<\/script>/)[1].replace(/^\s*import[^\n]+$/gm, '');
const tick = () => new Promise(resolve => setImmediate(resolve));
const enabledHost = (id, os = 'darwin') => ({id, name: id, status: 'enabled', device_info: {os},
  caps: {transports: {rtc: {enabled: true, protocol: 'hosts_rtc/3'}}}});
const windows = [{pid: 12, window_id: 24, app_name: 'Editor', title: 'Notes'},
  {pid: 18, window_id: 36, app_name: 'Browser', title: 'Documentation'}];

function fixture(t, {hosts = [enabledHost('desktop')], load, onCall, beforeFrame, mobile = false} = {}) {
  const calls = [], connections = [], viewers = [], listeners = new Map();
  let queryDisposed = false, snapshots = 0;
  const query = {load: load || (async () => hosts), dispose() {queryDisposed = true;}};
  const document = {hidden: false, fullscreenElement: null,
    addEventListener(name, fn) {listeners.set(name, fn);}, removeEventListener(name, fn) {if (listeners.get(name) === fn) listeners.delete(name);},
    async exitFullscreen() {document.fullscreenElement = null; listeners.get('fullscreenchange')?.();},
  };
  const screenPanel = {async requestFullscreen() {document.fullscreenElement = screenPanel; listeners.get('fullscreenchange')?.();}};
  const state = createContext({
    CuaSession: class extends CuaSession {
      constructor(options) {super({...options, intervalMS: 60000, createSessionId: () => `page-${connections.length}`});}
    },
    CuaViewer: class {
      constructor(_canvas, _keyboard, callbacks) {this.callbacks = callbacks; this.generation = 0; viewers.push(this);}
      setPlatform(platform) {this.platform = platform;}
      setControl(control) {this.control = control;}
      setDeliveryMode(mode) {this.deliveryMode = mode;}
      async showFrame(frame) {
        const generation = ++this.generation;
        await beforeFrame?.(frame);
        if (this.closed || generation !== this.generation) return null;
        this.frame = frame; return frame;
      }
      clear() {this.generation++; this.frame = null; this.cleared = (this.cleared || 0) + 1;}
      close() {this.closed = true; this.clear();}
      typeText(text) {return this.callbacks.action('type_text', {text, delivery_mode: this.deliveryMode}, this.frame);}
      pressKey(key) {return this.callbacks.action('press_key', {key, delivery_mode: this.deliveryMode}, this.frame);}
      hotkey(keys) {return this.callbacks.action('hotkey', {keys, delivery_mode: this.deliveryMode}, this.frame);}
    },
    $hosts: {query: () => query, async openTools(hostId) {
      const connection = {hostId, closed: false, async close() {connection.closed = true;},
        async execCall(command, options) {
          if (command === 'mcp describe cua get_desktop_state --json') {
            return {content: JSON.stringify({name: 'get_desktop_state', inputSchema: {properties: {session: {}, max_image_dimension: {}}}}), attrs: {exit_code: '0'}};
          }
          const tool = command.split(' ')[3], args = JSON.parse(options.stdin);
          calls.push({hostId, tool, args});
          const override = await onCall?.({hostId, tool, args});
          if (override) return {content: JSON.stringify(override), attrs: {exit_code: '0'}};
          let data = {}, content = [];
          if (tool === 'check_permissions') data = {accessibility: true, screen_recording: true};
          if (tool === 'list_windows') data = {windows};
          if (tool.startsWith('get_')) {
            data = {screenshot_width: 800, screenshot_height: 600, sequence: ++snapshots};
            // Windows CuaDriver may omit capture_id. Internal frameId must still be forwarded.
            content = [{type: 'image', mimeType: 'image/png', data: 'fixture'}];
          }
          return {content: JSON.stringify({structuredContent: data, content}), attrs: {exit_code: '0'}};
        },
      };
      connections.push(connection); return connection;
    }},
    $refs: {canvas: {}, keyboard: {}, screenPanel}, $t: key => key, document,
    matchMedia: () => ({matches: mobile}), console,
  });
  runInContext(setup, state, {filename: 'cua/index.html setup'});
  t.after(() => state.disposeCua());
  return {state, calls, connections, viewers, document, listeners, hosts,
    get queryDisposed() {return queryDisposed;},
    async ready() {state.activateCua(); await tick(); await tick();},
    async hidden(value) {document.hidden = value; listeners.get('visibilitychange')?.(); await tick();},
  };
}

test('page keeps unavailable devices visible, chooses a usable device, and starts read-only', async t => {
  const f = fixture(t, {hosts: [
    {...enabledHost('offline'), last_seen: '2000-01-01T00:00:00Z'},
    {...enabledHost('disabled'), status: 'disabled'},
    {...enabledHost('legacy'), caps: {}}, enabledHost('linux', 'linux'),
  ]});
  await f.ready();
  assert.equal(f.state.devices.length, 4);
  assert.equal(f.state.selectedHostId, 'linux', 'Linux is permitted rather than silently hard-disabled');
  assert.equal(f.connections.length, 1);
  assert.equal(f.connections[0].hostId, 'linux');
  assert.equal(f.state.hasFrame, true);
  assert.equal(f.state.sessionState.control, false);
  assert.equal(f.viewers[0].platform, 'linux');
  assert.match(f.state.devices[0].unavailable, /offline/);
  f.state.windowSearch = 'notes';
  assert.equal(f.state.filteredWindows().length, 1);
  f.state.windowSearch = 'browser';
  assert.equal(f.state.filteredWindows().length, 1);
});

test('real controller accepts page input observation IDs; read-only toggle preserves the displayed frame', async t => {
  const f = fixture(t);
  await f.ready();
  f.state.setControl(true);
  f.state.inputText = 'Fixture text';
  await f.state.sendText();
  assert.equal(f.calls.find(call => call.tool === 'type_text').args.text, 'Fixture text');
  assert.equal(f.state.inputText, '');
  assert.equal(f.state.errorText(), '');
  f.state.selectedKey = 'selectAll';
  await f.state.sendKey();
  assert.deepEqual(f.calls.find(call => call.tool === 'hotkey').args.keys, ['cmd', 'a']);
  const captures = f.calls.filter(call => call.tool.startsWith('get_')).length;
  const frame = f.viewers[0].frame;
  f.state.inputText = 'unsent';
  f.state.setControl(false);
  assert.equal(f.state.hasFrame, true);
  assert.equal(f.viewers[0].frame, frame);
  assert.equal(f.state.inputText, '');
  assert.equal(f.calls.filter(call => call.tool.startsWith('get_')).length, captures);
});

test('selecting a window clears pending input and restores background delivery and view mode', async t => {
  const f = fixture(t, {mobile: true});
  await f.ready();
  f.state.setControl(true);
  f.state.inputText = 'unsent';
  f.state.deliveryMode = 'foreground';
  f.state.changeDeliveryMode();
  f.state.sidebarOpen = true;
  await f.state.selectWindow(windows[0]);
  await tick();
  assert.equal(f.state.sessionState.target.window_id, 24);
  assert.equal(f.state.inputText, '');
  assert.equal(f.state.sessionState.control, false);
  assert.equal(f.state.deliveryMode, 'background');
  assert.equal(f.state.sidebarOpen, false);
  assert.equal(f.state.targetTitle(), 'Editor · Notes');
  assert.equal(f.state.hasFrame, true);
  f.state.setControl(true);
  f.state.deliveryMode = 'foreground';
  f.state.changeDeliveryMode();
  f.state.inputText = 'example';
  await f.state.sendText();
  const action = f.calls.find(call => call.tool === 'type_text');
  assert.equal(action.args.delivery_mode, 'foreground');
  assert.equal(action.args.target.window_id, 24);
});

test('page and document visibility disable control, discard displayed observation, and resume safely', async t => {
  const f = fixture(t);
  await f.ready();
  f.state.setControl(true);
  await f.hidden(true);
  assert.equal(f.state.hasFrame, false);
  assert.equal(f.state.sessionState.control, false);
  const captures = f.calls.filter(call => call.tool.startsWith('get_')).length;
  await f.state.refreshFrame();
  assert.equal(f.calls.filter(call => call.tool.startsWith('get_')).length, captures);
  await f.hidden(false);
  assert.equal(f.state.hasFrame, true);
  assert.equal(f.state.sessionState.control, false);
  f.state.deactivateCua();
  await f.hidden(false);
  assert.equal(f.state.hasFrame, false, 'document visibility cannot reactivate a hidden route');
  f.state.activateCua();
  await tick();
  assert.equal(f.state.hasFrame, true);
});

test('capture errors retry the selected window on its existing connection and preserve permissions', async t => {
  let failCapture = false;
  const f = fixture(t, {onCall: ({tool}) => failCapture && tool === 'get_window_state'
    ? {isError: true, content: [{type: 'text', text: 'Permission denied'}]} : null});
  await f.ready();
  await f.state.selectWindow(windows[0]);
  await tick();
  failCapture = true;
  await f.state.refreshFrame();
  assert.equal(f.state.sessionState.phase, 'error');
  assert.match(f.state.errorText(), /Permission denied/);
  failCapture = false;
  await f.state.retry();
  assert.equal(f.state.errorText(), '');
  assert.equal(f.connections.length, 1);
  assert.equal(f.state.sessionState.target.window_id, 24);
  f.state.togglePermissions();
  await tick();
  assert.match(f.state.permissionReport(), /screen_recording/);
  assert.ok(f.calls.filter(call => call.tool === 'check_permissions').every(call => call.args.prompt === false));
});

test('page clears device selection without permanently closing its reusable controller', async t => {
  const hosts = [enabledHost('desktop')];
  const f = fixture(t, {hosts});
  await f.ready();
  hosts[0].status = 'disabled';
  await f.state.refreshDevices();
  assert.equal(f.state.selectedHostId, '');
  assert.equal(f.state.hasFrame, false);
  hosts[0].status = 'enabled';
  await f.state.refreshDevices();
  await tick();
  assert.equal(f.state.selectedHostId, 'desktop');
  assert.equal(f.state.hasFrame, true);
});

test('dispose removes DOM listeners, releases the query, and ignores pending discovery', async t => {
  let resolve;
  const f = fixture(t, {load: () => new Promise(done => {resolve = done;})});
  f.state.activateCua();
  await tick();
  f.state.disposeCua();
  resolve([enabledHost('late')]);
  await tick();
  assert.equal(f.queryDisposed, true);
  assert.equal(f.listeners.size, 0);
  assert.equal(f.viewers[0].closed, true);
  assert.equal(f.connections.length, 0);
  assert.equal(f.state.devices.length, 0);
});

test('fullscreen state and mobile permissions stay reachable; all translation keys exist', async t => {
  const f = fixture(t, {mobile: true});
  await f.ready();
  await f.state.toggleFullscreen();
  assert.equal(f.state.fullscreen, true);
  await f.state.toggleFullscreen();
  assert.equal(f.state.fullscreen, false);
  f.state.sidebarOpen = true;
  f.state.togglePermissions();
  assert.equal(f.state.sidebarOpen, false);
  const langs = JSON.parse(readFileSync(new URL('./langs.json', import.meta.url), 'utf8'));
  for (const [, key] of page.matchAll(/\$t\('([^']+)'\)/g)) {
    assert.ok(langs.en[key], `English translation: ${key}`);
    assert.ok(langs['zh-CN'][key], `Chinese translation: ${key}`);
  }
});

test('a selected window becoming minimized disappears from the list and clears its screen without changing target', async t => {
  let minimized = false;
  const f = fixture(t, {onCall: ({tool}) => tool === 'list_windows'
    ? {structuredContent: {windows: windows.map(window => window.window_id === 24 ? {...window, minimized, is_on_screen: !minimized} : window)}} : null});
  await f.ready();
  await f.state.selectWindow(windows[0]);
  await tick();
  f.state.setControl(true);
  f.state.inputText = 'unsent';
  minimized = true;
  const captureCount = f.calls.filter(call => call.tool.startsWith('get_')).length;
  await f.state.refreshWindows();
  assert.equal(f.state.sessionState.phase, 'target_unavailable');
  assert.equal(f.state.sessionState.unavailableReason, 'minimized');
  assert.equal(f.state.sessionState.target.window_id, 24);
  assert.equal(f.state.sessionState.control, false);
  assert.equal(f.state.hasFrame, false);
  assert.equal(f.viewers[0].frame, null);
  assert.equal(f.state.inputText, '');
  assert.equal(f.state.filteredWindows().some(window => window.window_id === 24), false);
  assert.equal(f.state.targetTitle(), 'Editor · Notes', 'selection title survives removal of its list row');
  assert.equal(f.state.emptyText(), 'cua.window_minimized_hint');
  assert.equal(f.state.phaseText(), 'cua.target_unavailable');
  assert.equal(f.state.errorText(), '');
  await tick();
  assert.equal(f.calls.filter(call => call.tool.startsWith('get_')).length, captureCount);
  assert.ok(f.calls.every(call => ['check_permissions', 'list_windows', 'get_desktop_state', 'get_window_state'].includes(call.tool)),
    'unavailability never causes restore, focus, foreground input, or another target action');
  f.state.setControl(true);
  assert.equal(f.state.sessionState.control, false);
});

test('expected no-image capture shows a localized hint and only explicit retry restores the screen', async t => {
  let noImage = false;
  const f = fixture(t, {onCall: ({tool}) => noImage && tool === 'get_window_state'
    ? {structuredContent: {screenshot_error: 'Cannot capture minimized window: it has no rendered content'}, content: []} : null});
  await f.ready();
  await f.state.selectWindow(windows[0]);
  await tick();
  noImage = true;
  await f.state.refreshFrame();
  assert.equal(f.state.sessionState.phase, 'target_unavailable');
  assert.equal(f.state.hasFrame, false);
  assert.equal(f.state.errorText(), '', 'expected driver text is not displayed as an English error banner');
  assert.equal(f.state.emptyText(), 'cua.window_minimized_hint');
  f.viewers[0].callbacks.error(Object.assign(new Error('Target has no rendered content'), {code: 'target_unavailable'}));
  assert.equal(f.state.errorText(), '', 'queued input uses the same expected unavailable classification');
  f.viewers[0].callbacks.error(new Error('A real viewer failure'));
  assert.equal(f.state.errorText(), 'A real viewer failure', 'unrelated errors remain visible');
  noImage = false;
  await f.state.retry();
  await tick();
  assert.equal(f.state.hasFrame, true);
  assert.equal(f.state.sessionState.control, false);
  assert.equal(f.state.sessionState.target.window_id, 24);
  assert.equal(f.state.errorText(), '');
});

test('a screenshot already decoding cannot reappear after its target becomes unavailable', async t => {
  let delayed = false, minimized = false, finishDecode;
  const f = fixture(t, {
    beforeFrame: () => delayed ? new Promise(resolve => {finishDecode = resolve;}) : undefined,
    onCall: ({tool}) => tool === 'list_windows'
      ? {structuredContent: {windows: windows.map(window => window.window_id === 24 ? {...window, minimized} : window)}} : null,
  });
  await f.ready();
  await f.state.selectWindow(windows[0]);
  await tick();
  assert.equal(f.state.hasFrame, true);
  delayed = true;
  await f.state.refreshFrame();
  await tick();
  assert.equal(typeof finishDecode, 'function');
  minimized = true;
  await f.state.refreshWindows();
  assert.equal(f.state.hasFrame, false);
  finishDecode();
  await tick();
  assert.equal(f.state.hasFrame, false);
  assert.equal(f.viewers[0].frame, null);
  assert.equal(f.state.emptyText(), 'cua.window_minimized_hint');
});

test('unavailable reasons have distinct localized recovery instructions', async t => {
  const f = fixture(t);
  await f.ready();
  f.state.sessionState = {...f.state.sessionState, phase: 'target_unavailable', unavailableReason: 'not_visible'};
  assert.equal(f.state.emptyText(), 'cua.window_not_visible_hint');
  f.state.sessionState = {...f.state.sessionState, unavailableReason: 'no_image'};
  assert.equal(f.state.emptyText(), 'cua.window_no_image_hint');
});
