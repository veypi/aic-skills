import test from 'node:test';
import assert from 'node:assert/strict';
import {CuaSession} from './cua.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
  let resolve;
  const promise = new Promise(done => {resolve = done;});
  return {promise, resolve};
};
const observation = frame => ({frameId: frame.frameId, epoch: frame.epoch});
const result = data => ({structuredContent: data, content: []});
const encode = data => ({content: JSON.stringify(data), attrs: {exit_code: '0'}});

function fixture(t, options = {}) {
  const calls = [], frames = [], errors = [], casts = [];
  let sessionSequence = 0;
  const connection = {
    closed: false,
    openStream: () => {throw new Error('the fake CuaCast owns streams');},
    execCall: async (command, execOptions) => {
      if (command === 'commands info cua --schema') {
        return encode([
          {name: 'check_permissions', inputSchema: {properties: {session: {}, prompt: {}}}},
        ]);
      }
      const match = command.match(/^cua ([a-z_]+) --input - --json$/);
      assert.ok(match, command);
      const name = match[1], args = JSON.parse(execOptions.stdin);
      calls.push({name, args});
      if (name === 'click' && options.holdClick) await options.holdClick.promise;
      return encode(result(name === 'check_permissions'
        ? {accessibility: true, screen_recording: true} : {effect: 'confirmed'}));
    },
    close: async () => {connection.closed = true;},
  };
  const session = new CuaSession({
    hosts: {openTools: async () => connection},
    castSupported: options.castSupported || (() => true),
    createSessionId: () => `view-${++sessionSequence}`,
    createCast: castOptions => {
      const cast = {options: castOptions, closed: false,
        ready: async () => {}, close: () => {cast.closed = true;},
        stats: () => ({received: 0, decoded: 0, skipped: 0})};
      casts.push(cast);
      return cast;
    },
    changed: () => {},
    frame: frame => frames.push(frame),
    error: error => errors.push(error),
  });
  t.after(() => session.close());
  return {session, calls, frames, errors, casts, connection};
}

function pushVideo(cast, fields = {}) {
  const videoFrame = {displayWidth: 800, displayHeight: 600, close() {}};
  return cast.options.frame({videoFrame, width: 800, height: 600,
    sourceWidth: 800, sourceHeight: 600, codec: 'avc1.640028', ...fields});
}

function assertNoStateCapture(calls) {
  assert.equal(calls.some(call => call.name === 'get_desktop_state' || call.name === 'get_window_state'), false);
}

test('connect starts only primary desktop video after read-only permission diagnostics', async t => {
  const {session, calls, casts} = fixture(t);
  session.setActive(true);
  await session.connect('device-a');
  assert.equal(casts.length, 1);
  assert.deepEqual(session.state.target, {kind: 'desktop', display_id: 'primary'});
  assert.deepEqual(calls.map(call => call.name), ['check_permissions']);
  assert.deepEqual(calls[0].args, {prompt: false, session: 'view-1'});
  assert.equal(session.state.streamState, 'connecting');
  assert.equal(session.listWindows, undefined);
  assert.equal(session.selectTarget, undefined);
  assert.equal('windows' in session.state, false);
  assert.equal('desktopCapture' in session, false);
  assertNoStateCapture(calls);
});

test('video clicks send coordinates directly and newer frames do not stale queued input', async t => {
  const holdClick = deferred();
  const {session, calls, frames, casts} = fixture(t, {holdClick});
  session.setActive(true);
  await session.connect('device-a');
  await pushVideo(casts[0]);
  session.setControl(true);
  const firstFrame = frames.at(-1);
  const first = session.action('click', {x: 20, y: 30}, observation(firstFrame));
  await tick();
  assert.equal(calls.filter(call => call.name === 'click').length, 1);

  await pushVideo(casts[0]);
  const secondFrame = frames.at(-1);
  const second = session.action('click', {x: 40, y: 50}, observation(secondFrame));
  await pushVideo(casts[0]);
  holdClick.resolve();
  await Promise.all([first, second]);

  const clicks = calls.filter(call => call.name === 'click');
  assert.equal(clicks.length, 2);
  for (const click of clicks) {
    assert.deepEqual(click.args.target, {kind: 'desktop', display_id: 'primary'});
    assert.equal(click.args.delivery_mode, 'foreground');
    assert.equal(Object.hasOwn(click.args, 'capture_id'), false);
  }
  assert.equal(secondFrame.video, true);
  assert.equal(Object.hasOwn(secondFrame, 'captureId'), false);
  assertNoStateCapture(calls);
  assert.equal(session.state.streamState, 'live');

  await assert.rejects(session.action('click', {x: 20, y: 30}, observation(secondFrame)),
    error => error.code === 'stale_capture');
  assert.equal(calls.filter(call => call.name === 'click').length, 2,
    'an explicitly replayed old video observation is rejected');
});

test('a stream session error has no state-capture fallback and capture manually retries video', async t => {
  const {session, calls, frames, errors, casts} = fixture(t);
  session.setActive(true);
  await session.connect('device-a');
  casts[0].options.error(Object.assign(new Error('ffmpeg is unavailable'), {code: 'cua_cast_session'}));
  await tick();
  assert.equal(casts[0].closed, true);
  assert.equal(session.state.streamState, 'error');
  assert.equal(session.state.phase, 'error');
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /ffmpeg/);
  assert.equal(frames.length, 0);
  assertNoStateCapture(calls);

  await session.capture();
  assert.equal(casts.length, 2);
  assert.equal(session.state.streamState, 'connecting');
  assertNoStateCapture(calls);
});

test('missing video capability fails directly without any state capture', async t => {
  const {session, calls, errors, casts} = fixture(t, {castSupported: () => false});
  session.setActive(true);
  await assert.rejects(session.connect('device-a'), /WebCodecs H264/);
  assert.equal(casts.length, 0);
  assert.equal(session.state.streamState, 'error');
  assert.equal(session.state.phase, 'error');
  assert.equal(errors.length, 1);
  assert.deepEqual(calls.map(call => call.name), ['check_permissions']);
  assertNoStateCapture(calls);
});

test('video frame arrivals drive the reported frame rate', async t => {
  const {session, casts} = fixture(t);
  session.setActive(true);
  await session.connect('device-a');
  let now = 1_000_000;
  const realNow = Date.now;
  Date.now = () => now;
  t.after(() => {Date.now = realNow;});
  await pushVideo(casts[0]);
  now += 200;
  await pushVideo(casts[0]);
  now += 200;
  await pushVideo(casts[0]);
  now += 200;
  await pushVideo(casts[0]);
  assert.ok(session.state.fps > 4 && session.state.fps < 6);
});
