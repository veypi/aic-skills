import test from 'node:test';
import assert from 'node:assert/strict';
import {CuaSession, cuaCall, resultData} from './cua.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((done, fail) => {resolve = done; reject = fail;});
  return {promise, resolve, reject};
};
const result = data => ({structuredContent: data, content: []});
const screenshot = (id, extra = {}) => ({
  structuredContent: {capture_id: id, screenshot_width: 800, screenshot_height: 600, ...extra},
  content: [{type: 'image', mimeType: 'image/png', data: 'aW1hZ2U='}],
});
const encode = data => ({content: JSON.stringify(data), attrs: {exit_code: '0'}});
const observation = frame => ({captureId: frame.captureId, frameId: frame.frameId, epoch: frame.epoch});

function fixture(t, handle, options = {}) {
  const calls = [], describes = [], frames = [], errors = [], states = [], connections = [];
  const model = {windows: [{pid: 41, window_id: 7, app_name: 'Editor', title: 'Document'}], captures: 0};
  const fallback = call => {
    if (call.name === 'check_permissions') return result({accessibility: true, screen_recording: true});
    if (call.name === 'list_windows') return result({windows: model.windows});
    if (call.name.startsWith('get_')) return screenshot(`capture-${++model.captures}`);
    return result({effect: 'confirmed'});
  };
  const makeConnection = hostId => {
    const connection = {
      closed: false,
      execCall: async (command, options) => {
        if (command === 'mcp describe cua get_desktop_state --json') {
          describes.push({hostId, options});
          return encode(await (optionsForSchema?.(hostId, options) ||
            {name: 'get_desktop_state', inputSchema: {type: 'object', properties: {session: {}, max_image_dimension: {}}}}));
        }
        const match = command.match(/^mcp call cua ([a-z_]+) --input - --json( --image-preview 1280x720)?$/);
        assert.ok(match, 'CUA uses the fixed exec command and JSON stdin');
        const call = {hostId, name: match[1], args: JSON.parse(options.stdin), options, preview: !!match[2]};
        calls.push(call);
        return encode(await (handle ? handle(call, fallback, model) : fallback(call)));
      },
      close: async () => {connection.closed = true;},
    };
    connections.push(connection);
    return connection;
  };
  const {describe: optionsForSchema, ...sessionOptions} = options;
  let sequence = 0;
  const session = new CuaSession({
    hosts: {openTools: async id => makeConnection(id)},
    createSessionId: () => `view-${++sequence}`,
    changed: state => states.push(state), frame: frame => frames.push(frame), error: error => errors.push(error),
    ...sessionOptions,
  });
  t.after(() => session.close());
  return {session, calls, describes, frames, errors, states, connections, model, makeConnection};
}

async function ready(session) {
  session.setActive(true);
  await session.connect('device-a');
  session.setControl(true);
}

test('command parsing preserves MCP image and structured data and rejects command injection', async () => {
  const raw = screenshot('capture-1');
  const connection = {execCall: async (_command, options) => {
    assert.equal(options.stdin, JSON.stringify({text: '$(not-a-command) " quoted'}));
    return encode(raw);
  }};
  assert.deepEqual(await cuaCall(connection, 'type_text', {text: '$(not-a-command) " quoted'}), raw);
  assert.deepEqual(resultData({content: [{type: 'text', text: '{"windows":[]}'}]}), {windows: []});
  await assert.rejects(cuaCall(connection, 'click;echo'), /Invalid CUA command/);
  await assert.rejects(cuaCall({execCall: async () => encode({isError: true,
    structuredContent: {code: 'window_id_not_found'}, content: [{type: 'text', text: 'Window disappeared'}]})}, 'get_window_state'),
  error => error.code === 'window_id_not_found' && error.message === 'Window disappeared');
});

test('a view uses one independent session and persistent connection, with read-only permissions', async t => {
  const {session, calls, frames, connections} = fixture(t);
  await ready(session);
  assert.equal(connections.length, 1);
  assert.equal(session.state.phase, 'ready');
  assert.deepEqual(calls.find(call => call.name === 'check_permissions').args, {prompt: false, session: 'view-1'});
  assert.deepEqual(calls.find(call => call.name === 'get_desktop_state').args, {max_image_dimension: 1280, session: 'view-1'});
  assert.equal(session.state.connected, true);
  assert.equal(frames[0].width, 800);
  assert.equal(frames[0].height, 600);
  assert.deepEqual(frames[0].target, {kind: 'desktop', display_id: 'primary'});
  assert.deepEqual(frames[0].image, {data: 'aW1hZ2U=', mimeType: 'image/png'});
  await session.checkPermissions();
  await session.listWindows();
  assert.ok(calls.every(call => call.args.session === 'view-1'));
  await session.connect('device-b');
  assert.equal(connections.length, 2);
  assert.equal(connections[0].closed, true);
  assert.equal(calls.find(call => call.name === 'end_session').args.session, 'view-1');
  assert.ok(calls.filter(call => call.hostId === 'device-b').every(call => call.args.session === 'view-2'));
  await session.close();
  assert.equal(calls.filter(call => call.name === 'end_session').length, 2);
  assert.equal(session.state.phase, 'closed');
  assert.equal(session.state.connected, false);
});

test('window actions use image-bound click once, explicit delivery and a fresh post-action screenshot', async t => {
  const {session, calls, frames} = fixture(t);
  await ready(session);
  session.selectTarget({kind: 'window', pid: 41, window_id: 7});
  await tick();
  assert.equal(session.state.control, false, 'changing target returns to view-only mode');
  session.setControl(true);
  const before = frames.at(-1);
  await session.action('click', {x: 20, y: 30, button: 'left', count: 1}, observation(before));
  const click = calls.find(call => call.name === 'click');
  assert.deepEqual(click.args, {x: 20, y: 30, button: 'left', count: 1,
    target: {kind: 'window', pid: 41, window_id: 7}, delivery_mode: 'background',
    capture_id: before.captureId, session: 'view-1'});
  assert.ok(frames.at(-1).frameId > before.frameId);
  assert.equal(calls.at(-1).name, 'get_window_state');
  assert.equal(calls.at(-1).args.max_dimension, 1280);
  await session.action('scroll', {direction: 'down', amount: 3, delivery_mode: 'foreground'}, observation(frames.at(-1)));
  const scroll = calls.find(call => call.name === 'scroll');
  assert.equal(scroll.args.capture_id, undefined);
  assert.equal(scroll.args.delivery_mode, 'foreground');
  await assert.rejects(session.action('click', {x: 1, y: 1}, observation(before)), error => error.code === 'stale_capture');
  await tick();
  assert.equal(calls.filter(call => call.name === 'click').length, 1, 'an old observation cannot replay a click');
  await assert.rejects(session.action('click', {x: 1, y: 1}), error => error.code === 'stale_capture');
});

test('older drivers without capture_id still require a fresh local frameId', async t => {
  const {session, calls, frames} = fixture(t, (call, fallback) => call.name.startsWith('get_')
    ? screenshot(undefined) : fallback(call));
  await ready(session);
  const before = frames.at(-1);
  assert.equal(before.captureId, undefined);
  await session.action('click', {x: 2, y: 3}, observation(before));
  assert.equal(calls.find(call => call.name === 'click').args.capture_id, undefined);
  assert.ok(frames.at(-1).frameId > before.frameId);
  await assert.rejects(session.action('click', {x: 2, y: 3}, observation(before)), error => error.code === 'stale_capture');
});

test('captures are single-flight; gestures and hidden views pause automatic polling', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  let pending;
  const {session, calls, frames} = fixture(t, (call, fallback) => pending && call.name.startsWith('get_') ? pending.promise : fallback(call));
  await ready(session);
  pending = deferred();
  const first = session.capture(), second = session.capture();
  assert.equal(first, second);
  assert.equal(session.state.capturing, true);
  await tick();
  assert.equal(calls.filter(call => call.name.startsWith('get_')).length, 2);
  session.setInteracting(true);
  pending.resolve(screenshot('gesture-start'));
  await first;
  pending = null;
  assert.equal(frames.at(-1).captureId, 'gesture-start', 'an already running capture may finish during a gesture');
  t.mock.timers.tick(10000);
  await tick();
  assert.equal(calls.filter(call => call.name.startsWith('get_')).length, 2);
  session.setInteracting(false);
  t.mock.timers.tick(1000);
  await tick();
  assert.equal(calls.filter(call => call.name.startsWith('get_')).length, 3);
  session.setActive(false);
  t.mock.timers.tick(10000);
  await tick();
  assert.equal(calls.filter(call => call.name.startsWith('get_')).length, 3);
  assert.equal(session.state.control, false);
  session.setActive(true);
  await tick();
  assert.equal(calls.filter(call => call.name.startsWith('get_')).length, 4);
});

test('target changes discard a late frame and queued input instead of using old coordinates', async t => {
  const pending = deferred();
  let wait = false;
  const {session, calls, frames} = fixture(t, (call, fallback) => wait && call.name === 'get_desktop_state' ? pending.promise : fallback(call));
  await ready(session);
  const before = frames.at(-1);
  wait = true;
  const capture = session.capture();
  const action = session.action('click', {x: 10, y: 10}, observation(before));
  const rejected = assert.rejects(action, error => error.code === 'stale_context');
  session.selectTarget({kind: 'window', pid: 41, window_id: 7});
  await rejected;
  assert.equal(await capture, null);
  pending.resolve(screenshot('old-desktop'));
  await tick();
  assert.ok(!frames.some(frame => frame.captureId === 'old-desktop'));
  assert.equal(frames.at(-1).target.kind, 'window');
  assert.ok(frames.at(-1).epoch > before.epoch);
  assert.equal(calls.filter(call => call.name === 'click').length, 0);
});

test('a late device connection is closed and cannot replace the new host', async t => {
  const pending = deferred();
  const {session, connections, makeConnection} = fixture(t);
  session.hosts.openTools = id => id === 'slow' ? pending.promise : Promise.resolve(makeConnection(id));
  session.setActive(true);
  const slow = session.connect('slow');
  await tick();
  await session.connect('new');
  const late = makeConnection('slow');
  pending.resolve(late);
  await slow;
  assert.equal(late.closed, true);
  assert.equal(session.state.hostId, 'new');
  assert.equal(session.connection, connections[0]);
});

test('failed screenshots pause polling and resume only on explicit capture', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  let fail = false;
  const {session, calls, errors} = fixture(t, (call, fallback) => {
    if (fail && call.name.startsWith('get_')) return result({screenshot_error: 'Screen recording denied'});
    return fallback(call);
  });
  await ready(session);
  fail = true;
  await assert.rejects(session.capture(), /Screen recording denied/);
  assert.equal(session.state.phase, 'error');
  assert.equal(errors.length, 1);
  assert.ok(errors[0] instanceof Error);
  const count = calls.length;
  session.setActive(false);
  session.setActive(true);
  t.mock.timers.tick(10000);
  await tick();
  assert.equal(calls.length, count, 'visibility changes do not retry a failed capture');
  fail = false;
  await session.capture();
  assert.equal(session.state.phase, 'ready');
  await tick();
  t.mock.timers.tick(1000);
  await tick();
  assert.ok(calls.length > count + 1);
});

test('closed or replaced windows retain their explicit target and stop control', async t => {
  const {session, model} = fixture(t);
  await ready(session);
  session.selectTarget({kind: 'window', pid: 41, window_id: 7});
  await tick();
  session.setControl(true);
  model.windows = [{pid: 42, window_id: 8, title: 'Another window'}];
  await session.listWindows();
  assert.equal(session.state.phase, 'target_unavailable');
  assert.equal(session.state.unavailableReason, 'not_visible');
  assert.deepEqual(session.state.target, {kind: 'window', pid: 41, window_id: 7});
  assert.equal(session.state.control, false);
});

test('continuous text drains a bounded queue before capture while consumed clicks cannot replay', async t => {
  const pending = deferred();
  const {session, calls, frames} = fixture(t, (call, fallback) => call.name === 'click' ? pending.promise : fallback(call));
  await ready(session);
  const before = observation(frames.at(-1));
  const first = session.action('click', {x: 1, y: 1}, before);
  const queued = Array.from({length: 16}, (_, i) => session.action('type_text', {text: String(i)}, before));
  await assert.rejects(session.action('type_text', {text: 'overflow'}, before), error => error.code === 'input_queue_full');
  await assert.rejects(session.action('click', {x: 3, y: 3}, before), error => error.code === 'stale_capture');
  pending.resolve(result({effect: 'confirmed'}));
  await first;
  await Promise.all(queued);
  assert.equal(calls.filter(call => call.name === 'click').length, 1);
  assert.deepEqual(calls.filter(call => call.name === 'type_text').map(call => call.args.text),
    Array.from({length: 16}, (_, i) => String(i)));
  const start = calls.findIndex(call => call.name === 'click');
  assert.ok(calls.slice(start + 1, start + 17).every(call => call.name === 'type_text'));
  assert.equal(calls[start + 17].name, 'get_desktop_state');
});

test('uncertain action failures are surfaced and never automatically replayed', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const {session, calls, frames, errors} = fixture(t, (call, fallback) => {
    if (call.name === 'type_text') throw new Error('Device timed out; effects may have occurred');
    return fallback(call);
  });
  await ready(session);
  await assert.rejects(session.action('type_text', {text: 'hello'}, observation(frames.at(-1))), /effects may have occurred/);
  assert.equal(session.state.phase, 'error');
  assert.equal(session.state.control, false);
  t.mock.timers.tick(10000);
  await tick();
  assert.equal(calls.filter(call => call.name === 'type_text').length, 1);
  assert.equal(errors.length, 1);
});

test('independent views never share a CUA session label', async t => {
  const first = fixture(t, null, {createSessionId: undefined});
  const second = fixture(t, null, {createSessionId: undefined});
  await Promise.all([ready(first.session), ready(second.session)]);
  assert.notEqual(first.calls[0].args.session, second.calls[0].args.session);
});

test('closing aborts observation and a late response cannot publish another frame', async t => {
  const pending = deferred();
  let wait = false;
  const {session, calls, frames, states} = fixture(t, (call, fallback) =>
    wait && call.name.startsWith('get_') ? pending.promise : fallback(call));
  await ready(session);
  wait = true;
  const capture = session.capture();
  await tick();
  const request = calls.at(-1);
  await session.close();
  assert.equal(request.options.signal.aborted, true);
  assert.equal(await capture, null);
  const frameCount = frames.length, stateCount = states.length;
  pending.resolve(screenshot('late-after-close'));
  await tick();
  assert.equal(frames.length, frameCount);
  assert.equal(states.length, stateCount);
});

test('a closed-window report invalidates an in-flight screenshot even when transport ignores abort', async t => {
  const late = deferred();
  let delayed = false;
  const {session, frames, calls, model} = fixture(t, (call, fallback) =>
    delayed && call.name === 'get_window_state' ? late.promise : fallback(call));
  await ready(session);
  session.selectTarget({kind: 'window', pid: 41, window_id: 7});
  await tick();
  const frameCount = frames.length;
  delayed = true;
  const capture = session.capture();
  await tick();
  model.windows = [];
  await session.listWindows();
  assert.equal(session.state.phase, 'target_unavailable');
  assert.equal(await capture, null, 'the invalid observation releases its caller immediately');
  assert.equal(calls.filter(call => call.name === 'get_window_state').at(-1).options.signal.aborted, true);
  delayed = false;
  late.resolve(screenshot('obsolete'));
  await tick();
  assert.equal(frames.length, frameCount, 'a late frame cannot resurrect the closed target');
  assert.equal(session.lastFrame, null);
  assert.equal(session.state.phase, 'target_unavailable');
  assert.equal(session.state.error, '');
  assert.equal(session.state.unavailableReason, 'not_visible');
  assert.equal(session.timer, null, 'target-closed polling remains stopped');
  await session.capture();
  assert.equal(frames.length, frameCount + 1, 'only an explicit retry starts a new observation');
  assert.equal(session.state.target.window_id, 7, 'retry preserves the chosen target');
});

test('a metadata failure cannot be cleared by an older screenshot, and retry does not reuse its job', async t => {
  const late = deferred();
  let delayed = false, failPermissions = false;
  const {session, frames} = fixture(t, (call, fallback) => {
    if (failPermissions && call.name === 'check_permissions') throw new Error('Permission denied');
    if (delayed && call.name === 'get_desktop_state') return late.promise;
    return fallback(call);
  });
  await ready(session);
  const frameCount = frames.length;
  delayed = true;
  const oldCapture = session.capture();
  await tick();
  failPermissions = true;
  await assert.rejects(session.checkPermissions(), /Permission denied/);
  assert.equal(await oldCapture, null);
  delayed = false;
  failPermissions = false;
  const retry = session.capture();
  late.resolve(screenshot('old-permission-context'));
  await retry;
  assert.equal(frames.length, frameCount + 1);
  assert.notEqual(frames.at(-1).captureId, 'old-permission-context');
  assert.equal(session.state.error, '');
});

test('duplicate metadata reads share a host-scoped request; old host results never enter its replacement', async t => {
  const permissions = deferred(), listing = deferred();
  let holdPermissions = false, holdWindows = false;
  const {session, calls} = fixture(t, (call, fallback) => {
    if (call.hostId === 'device-a' && holdPermissions && call.name === 'check_permissions') return permissions.promise;
    if (call.hostId === 'device-a' && holdWindows && call.name === 'list_windows') return listing.promise;
    return fallback(call);
  });
  await ready(session);
  holdPermissions = holdWindows = true;
  const permissionRead = session.checkPermissions(), windowRead = session.listWindows();
  assert.equal(session.checkPermissions(), permissionRead);
  assert.equal(session.listWindows(), windowRead);
  await session.connect('device-b');
  const replacementWindows = session.state.windows, replacementPermissions = session.state.permissions;
  permissions.resolve(result({old: true}));
  listing.resolve(result({windows: []}));
  await Promise.all([permissionRead, windowRead]);
  assert.equal(session.state.hostId, 'device-b');
  assert.equal(session.state.windows, replacementWindows);
  assert.equal(session.state.permissions, replacementPermissions);
  assert.equal(session.state.phase, 'ready');
  assert.equal(calls.filter(call => call.hostId === 'device-a' && call.name === 'check_permissions').length, 2);
  assert.equal(calls.filter(call => call.hostId === 'device-a' && call.name === 'list_windows').length, 2);
  assert.ok(calls.filter(call => call.hostId === 'device-a').every(call => call.args.session === 'view-1'));
  assert.ok(calls.filter(call => call.hostId === 'device-b').every(call => call.args.session === 'view-2'));
});

test('switching host during the connect permission check cannot list old windows on the new connection', async t => {
  const permissionRead = deferred();
  const {session, calls} = fixture(t, (call, fallback) =>
    call.hostId === 'device-a' && call.name === 'check_permissions' ? permissionRead.promise : fallback(call));
  session.setActive(true);
  const oldConnect = session.connect('device-a');
  await tick();
  await session.connect('device-b');
  permissionRead.resolve(result({old: true}));
  await oldConnect;
  assert.equal(calls.filter(call => call.hostId === 'device-a' && call.name === 'list_windows').length, 0);
  assert.equal(calls.filter(call => call.hostId === 'device-b' && call.name === 'list_windows').length, 1);
  assert.equal(session.state.hostId, 'device-b');
  assert.equal(session.state.permissions.old, undefined);
  assert.equal(session.state.phase, 'ready');
});

test('text mutations consume old screenshot coordinates without dropping queued text', async t => {
  const pending = deferred();
  let textCount = 0;
  const {session, calls, frames} = fixture(t, (call, fallback) =>
    call.name === 'type_text' && ++textCount === 1 ? pending.promise : fallback(call));
  await ready(session);
  const before = observation(frames.at(-1));
  const first = session.action('type_text', {text: 'open a menu'}, before);
  const second = session.action('type_text', {text: 'continued typing'}, before);
  await assert.rejects(session.action('click', {x: 40, y: 40}, before), error => error.code === 'stale_capture');
  pending.resolve(result({effect: 'confirmed'}));
  await Promise.all([first, second]);
  assert.deepEqual(calls.filter(call => call.name === 'type_text').map(call => call.args.text), ['open a menu', 'continued typing']);
  assert.equal(calls.filter(call => call.name === 'click').length, 0);
  await session.action('click', {x: 40, y: 40}, observation(frames.at(-1)));
  assert.equal(calls.filter(call => call.name === 'click').length, 1, 'freshly observed coordinates are accepted');
});

test('desktop capture follows the current device schema and caches it only for that connection', async t => {
  const {session, calls, describes} = fixture(t, null, {describe: hostId => ({
    name: 'get_desktop_state', inputSchema: {type: 'object', additionalProperties: false,
      properties: hostId === 'device-a' ? {session: {}, screenshot_out_file: {}}
        : {session: {}, max_image_dimension: {type: 'integer'}}},
  })});
  await ready(session);
  await session.capture();
  assert.equal(describes.length, 1);
  const first = calls.filter(call => call.name === 'get_desktop_state');
  assert.equal(first.length, 2);
  assert.ok(first.every(call => Object.keys(call.args).join(',') === 'session'));
  await session.connect('device-b');
  assert.equal(describes.length, 2);
  assert.equal(calls.at(-1).args.max_image_dimension, 1280);
  await session.connect('device-a');
  assert.equal(describes.length, 3, 'a new connection re-reads its current driver contract');
  assert.equal(calls.at(-1).args.max_image_dimension, undefined);
});

test('a delayed desktop schema cannot issue an old capture on a replacement host', async t => {
  const pending = deferred();
  const {session, calls, frames} = fixture(t, null, {describe: hostId => hostId === 'device-a' ? pending.promise
    : {inputSchema: {properties: {session: {}}}}});
  session.setActive(true);
  const oldConnect = session.connect('device-a');
  await tick();
  const nextConnect = session.connect('device-b');
  await tick();
  pending.resolve({inputSchema: {properties: {session: {}, max_image_dimension: {}}}});
  await Promise.all([oldConnect, nextConnect]);
  assert.equal(calls.filter(call => call.hostId === 'device-a' && call.name === 'get_desktop_state').length, 0);
  const captures = calls.filter(call => call.name === 'get_desktop_state');
  assert.equal(captures.length, 1);
  assert.equal(captures[0].hostId, 'device-b');
  assert.equal(captures[0].args.max_image_dimension, undefined);
  assert.equal(frames.length, 1);
});

test('window discovery excludes minimized, off-screen and empty windows while retaining negative monitor coordinates', async t => {
  const {session, calls, model} = fixture(t);
  model.windows = [
    {pid: 1, window_id: 1, minimized: false, is_on_screen: true, bounds: {x: -1400, y: -200, width: 1200, height: 800}},
    {pid: 2, window_id: 2, minimized: true, is_on_screen: true, bounds: {width: 160, height: 28}},
    {pid: 3, window_id: 3, is_on_screen: false},
    {pid: 4, window_id: 4, bounds: {width: 0, height: 10}},
    {pid: 5, window_id: 5, bounds: {width: 10, height: -1}},
    {pid: 6, window_id: 6, title: 'Metadata absent'},
  ];
  await ready(session);
  assert.equal(calls.find(call => call.name === 'list_windows').args.on_screen_only, true);
  assert.deepEqual(session.state.windows.map(window => window.window_id), [1, 6]);
  assert.equal(calls.filter(call => call.name === 'get_window_state').length, 0, 'discovery does not probe every window with a screenshot');
});

test('a minimized capture disappears from the list, stops input and polling without restoring a window', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const {session, calls, model, errors} = fixture(t, (call, fallback) => call.name === 'get_window_state'
    ? {isError: true, content: [{type: 'text', text: 'cannot capture minimized window 0x303b6: it has no rendered content. Call bring_to_front with this window_id to restore it first.'}]}
    : fallback(call));
  await ready(session);
  const chosen = model.windows[0];
  session.selectTarget({kind: 'window', pid: chosen.pid, window_id: chosen.window_id});
  await tick();
  assert.equal(session.state.phase, 'target_unavailable');
  assert.equal(session.state.unavailableReason, 'minimized');
  assert.equal(session.state.error, '');
  assert.equal(session.state.windows.length, 0);
  assert.equal(session.state.targetWindow.title, 'Document');
  assert.equal(session.lastFrame, null);
  assert.equal(session.state.control, false);
  const count = calls.length;
  t.mock.timers.tick(10000); await tick();
  assert.equal(calls.length, count);
  assert.deepEqual(errors, []);
  assert.equal(calls.some(call => /front|restore|focus/.test(call.name)), false);
  assert.equal(session.state.target.kind, 'window');
});

test('no-image window responses are hidden, but screen-recording permission failures remain visible errors', async t => {
  let denied = false;
  const {session, errors, model} = fixture(t, (call, fallback) => call.name === 'get_window_state'
    ? result(denied ? {screenshot_error: 'Screen recording permission denied'} : {}) : fallback(call));
  await ready(session);
  session.selectTarget({kind: 'window', pid: 41, window_id: 7});
  await tick();
  assert.equal(session.state.phase, 'target_unavailable');
  assert.equal(session.state.unavailableReason, 'no_image');
  assert.equal(session.state.windows.length, 0);
  denied = true;
  await session.listWindows();
  assert.equal(session.state.windows.length, model.windows.length);
  await assert.rejects(session.capture(), /permission denied/);
  assert.equal(session.state.phase, 'error');
  assert.equal(session.state.windows.length, 1);
  assert.equal(errors.length, 1);
});

test('a stale list cannot reinsert a window after its capture proves it has no image', async t => {
  const listing = deferred();
  let holdList = false, unavailable = false;
  const {session, model} = fixture(t, (call, fallback) => {
    if (holdList && call.name === 'list_windows') return listing.promise;
    if (unavailable && call.name === 'get_window_state') return result({screenshot_error: 'cannot capture minimized window 0x303b6: it has no rendered content'});
    return fallback(call);
  });
  await ready(session);
  session.selectTarget({kind: 'window', pid: 41, window_id: 7});
  await tick();
  holdList = unavailable = true;
  const oldList = session.listWindows();
  await session.capture();
  assert.equal(session.state.windows.length, 0);
  listing.resolve(result({windows: model.windows}));
  await oldList;
  assert.equal(session.state.windows.length, 0);
  assert.equal(session.state.phase, 'target_unavailable');
});

test('explicitly truncated command output reports bounded metadata and is never retried', async () => {
  const image = 'PRIVATE_SCREENSHOT_BASE64_'.repeat(400);
  const content = JSON.stringify({content: [{type: 'image', data: image, mimeType: 'image/png'}]});
  for (const truncated of [true, 1, 'true', '1']) {
    let executions = 0;
    const connection = {execCall: async () => {
      executions++;
      return {content, attrs: {exit_code: '0', truncated}};
    }};
    await assert.rejects(cuaCall(connection, 'get_desktop_state'), error => {
      assert.equal(error.code, 'output_truncated');
      assert.match(error.message, /mcp call cua get_desktop_state/);
      assert.match(error.message, new RegExp(`stdout ${new TextEncoder().encode(content).byteLength} bytes, exit 0`));
      assert.match(error.message, /reported truncated/);
      assert.equal(error.message.includes('PRIVATE_SCREENSHOT'), false);
      assert.equal(error.message.includes('image/png'), false);
      assert.ok(error.message.length < 400);
      return true;
    });
    assert.equal(executions, 1);
  }
});

test('invalid JSON at the old 8 MiB boundary identifies a possible limit without exposing image data', async () => {
  const prefix = '{"content":[{"type":"image","data":"';
  const content = prefix + 'A'.repeat(8 * 1024 * 1024 - prefix.length);
  let executions = 0;
  await assert.rejects(cuaCall({execCall: async () => {
    executions++;
    return {content, attrs: {exit_code: '0'}};
  }}, 'get_desktop_state'), error => {
    assert.equal(error.code, 'invalid_response');
    assert.match(error.message, /stdout 8388608 bytes, exit 0/);
    assert.match(error.message, /exactly 8 MiB.*may have hit an older Pod output limit/);
    assert.equal(error.message.includes('AAAAAAAA'), false);
    assert.equal(error.message.includes(prefix), false);
    assert.ok(error.message.length < 400);
    return true;
  });
  assert.equal(executions, 1);
});

test('other invalid responses disclose only UTF-8 size and status and never replay a mutation', async () => {
  const content = '不是JSON: private screen text';
  let executions = 0;
  await assert.rejects(cuaCall({execCall: async () => {
    executions++;
    return {content, attrs: {exit_code: '0', truncated: 'false'}};
  }}, 'type_text', {text: 'may already have been typed'}), error => {
    assert.equal(error.code, 'invalid_response');
    assert.match(error.message, /mcp call cua type_text/);
    assert.match(error.message, new RegExp(`stdout ${new TextEncoder().encode(content).byteLength} bytes, exit 0`));
    assert.match(error.message, /may be incomplete or truncated/);
    assert.equal(error.message.includes('8 MiB'), false);
    assert.equal(error.message.includes('private screen text'), false);
    assert.equal(error.message.includes('may already have been typed'), false);
    return true;
  });
  assert.equal(executions, 1);
});

test('ordinary command failures prefer useful bounded stderr without copying embedded image output', async () => {
  const image = 'PRIVATE_SCREENSHOT_BASE64'.repeat(500);
  const response = {isError: true, structuredContent: {code: 'permission_denied'},
    content: [{type: 'text', text: 'Less useful fallback'}, {type: 'image', data: image}]};
  let executions = 0;
  await assert.rejects(cuaCall({execCall: async () => {
    executions++;
    return {content: JSON.stringify(response), attrs: {exit_code: '1',
      stderr: '[error] Screen access denied\n' + JSON.stringify({type: 'image', data: image})}};
  }}, 'click'), error => {
    assert.equal(error.code, 'permission_denied');
    assert.match(error.message, /\[error\] Screen access denied/);
    assert.equal(error.message.includes('Less useful fallback'), false);
    assert.equal(error.message.includes('PRIVATE_SCREENSHOT'), false);
    assert.ok(error.message.length < 700);
    return true;
  });
  assert.equal(executions, 1);
  const large = 'Permission denied. '.repeat(3000);
  await assert.rejects(cuaCall({execCall: async () => ({content: JSON.stringify(response),
    attrs: {exit_code: '1', stderr: large}})}, 'get_window_state'), error => {
    assert.match(error.message, /Permission denied/);
    assert.match(error.message, /diagnostic shortened/);
    assert.ok(error.message.length < 700);
    return true;
  });
});

test('invalid JSON failures retain useful stderr and stable status instead of echoing stdout', async () => {
  let executions = 0;
  await assert.rejects(cuaCall({execCall: async () => {
    executions++;
    return {content: 'PRIVATE RAW OUTPUT', attrs: {exit_code: '127', stderr: 'cua-driver is unavailable'}};
  }}, 'press_key', {key: 'return'}), error => {
    assert.equal(error.code, 'invalid_response');
    assert.match(error.message, /mcp call cua press_key/);
    assert.match(error.message, /exit 127/);
    assert.match(error.message, /cua-driver is unavailable/);
    assert.equal(error.message.includes('PRIVATE RAW OUTPUT'), false);
    return true;
  });
  assert.equal(executions, 1);
  await assert.rejects(cuaCall({execCall: async () => ({content: '{"content":{}}', attrs: {exit_code: '0'}})}, 'check_permissions'),
    error => error.code === 'invalid_response');
});

test('only screenshot calls opt into a device-side 720p preview and forwarding options remain clean', async t => {
  const {session, calls, describes} = fixture(t);
  await ready(session);
  session.selectTarget({kind: 'window', pid: 41, window_id: 7});
  await tick();
  session.setControl(true);
  await session.action('type_text', {text: 'fixture'}, observation(session.lastFrame));
  await session.checkPermissions();
  await session.listWindows();
  await session.close();
  assert.ok(calls.some(call => call.name === 'get_desktop_state'));
  assert.ok(calls.some(call => call.name === 'get_window_state'));
  for (const call of calls) {
    assert.equal(call.preview, ['get_desktop_state', 'get_window_state'].includes(call.name), call.name);
    assert.equal(Object.hasOwn(call.options, 'imagePreview'), false);
    assert.equal(Object.hasOwn(call.args, 'imagePreview'), false);
  }
  assert.equal(describes.length, 1);
  assert.equal(Object.hasOwn(describes[0].options, 'imagePreview'), false);
  const commands = [];
  await cuaCall({execCall: async (command, options) => {
    commands.push({command, options}); return encode({});
  }}, 'get_desktop_state');
  assert.equal(commands[0].command, 'mcp call cua get_desktop_state --input - --json', 'ordinary callers retain unmodified output');
});

test('preview frame keeps original driver capture identity and separate pre-preview image dimensions', async t => {
  const {session, frames} = fixture(t, (call, fallback) => {
    if (!call.name.startsWith('get_')) return fallback(call);
    return {structuredContent: {capture_id: 'upstream-capture', screenshot_width: 3840, screenshot_height: 2160,
      screenshot_original_width: 7680, screenshot_original_height: 4320, screenshot_scale: 0.5},
    content: [{type: 'image', mimeType: 'image/jpeg', data: 'preview', _meta: {
      'aic.dev/image-preview': {source_width: 3840, source_height: 2160, width: 1280, height: 720},
    }}]};
  });
  await ready(session);
  const frame = frames.at(-1);
  assert.equal(frame.captureId, 'upstream-capture');
  assert.equal(frame.image.mimeType, 'image/jpeg');
  assert.equal(frame.sourceWidth, 3840);
  assert.equal(frame.sourceHeight, 2160);
  assert.equal(frame.previewWidth, 1280);
  assert.equal(frame.previewHeight, 720);
  assert.notEqual(frame.sourceWidth, 7680, 'source means the upstream image, not screen/DPI metadata');
  assert.equal(frame.width, 3840, 'upstream response dimensions remain separate until image decode');
});

test('invalid preview coordinate metadata fails without dispatching input', async t => {
  const {session, calls} = fixture(t, (call, fallback) => {
    if (!call.name.startsWith('get_')) return fallback(call);
    return {content: [{type: 'image', data: 'preview', mimeType: 'image/jpeg', _meta: {
      'aic.dev/image-preview': {source_width: 0, source_height: 2160, width: 1280, height: 720},
    }}]};
  });
  await assert.rejects(ready(session), error => error.code === 'invalid_response' && /coordinate dimensions/.test(error.message));
  assert.equal(session.lastFrame, null);
  assert.equal(session.state.control, false);
  assert.equal(calls.some(call => ['click', 'drag', 'scroll'].includes(call.name)), false);
});
