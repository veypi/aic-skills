import test from 'node:test';
import assert from 'node:assert/strict';
import {CuaSession} from './cua.js';
import {CuaViewer} from './viewer.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
  let resolve;
  const promise = new Promise(done => {resolve = done;});
  return {promise, resolve};
};
const bitmap = () => ({width: 800, height: 600, close() {}});

class Node extends EventTarget {
  value = ''; width = 800; height = 600;
  getBoundingClientRect() {return {left: 0, top: 0, width: 800, height: 600};}
  getContext() {return {drawImage() {}, clearRect() {}};}
  focus() {}
  emit(type, properties = {}) {
    const event = new Event(type, {cancelable: true});
    for (const [key, value] of Object.entries(properties)) Object.defineProperty(event, key, {value});
    this.dispatchEvent(event);
  }
}

async function fixture(t) {
  t.mock.timers.enable({apis: ['setTimeout']});
  const canvas = new Node(), keyboard = new Node(), calls = [], errors = [];
  const captures = [], decodes = [];
  const originalDecode = globalThis.createImageBitmap;
  globalThis.createImageBitmap = () => decodes.shift()?.promise || Promise.resolve(bitmap());
  let sequence = 0, epoch = 0, session;
  const screenshot = () => ({
    structuredContent: {capture_id: `image-${++sequence}`, screenshot_width: 800, screenshot_height: 600},
    content: [{type: 'image', mimeType: 'image/png', data: 'AAAA'}],
  });
  const viewer = new CuaViewer(canvas, keyboard, {
    action: (name, args, frame) => session.action(name, args, frame),
    gesture: active => session?.setInteracting(active), error: error => errors.push(error),
  });
  session = new CuaSession({
    hosts: {openTools: async hostId => ({
      close: async () => {},
      execCall: async (command, options) => {
        if (command === 'mcp describe cua get_desktop_state --json') {
          return {content: JSON.stringify({name: 'get_desktop_state', inputSchema: {properties: {session: {}, max_image_dimension: {}}}}), attrs: {exit_code: '0'}};
        }
        const name = command.split(' ')[3], args = JSON.parse(options.stdin);
        calls.push({hostId, name, args});
        let result;
        if (name.startsWith('get_')) result = await (captures.shift()?.promise || screenshot());
        else result = {structuredContent: name === 'list_windows'
          ? {windows: [{pid: 41, window_id: 7, title: 'Editor'}]} : {}, content: []};
        return {content: JSON.stringify(result), attrs: {exit_code: '0'}};
      },
    })},
    changed: state => {
      if (state.epoch !== epoch) viewer.clear();
      epoch = state.epoch;
      viewer.setControl(state.control);
    },
    frame: frame => viewer.showFrame(frame).catch(error => errors.push(error)),
    error: error => errors.push(error),
  });
  t.after(async () => {
    viewer.close();
    await session.close();
    if (originalDecode) globalThis.createImageBitmap = originalDecode;
    else delete globalThis.createImageBitmap;
  });
  session.setActive(true);
  await session.connect('first');
  await tick();
  session.setControl(true);
  return {
    viewer, session, keyboard, calls, errors,
    input: text => {keyboard.value = text; keyboard.emit('input');},
    holdCapture: () => {
      const hold = deferred(); captures.push(hold);
      return () => hold.resolve(screenshot());
    },
    holdDecode: () => {
      const hold = deferred(); decodes.push(hold);
      return () => hold.resolve(bitmap());
    },
    inputs: () => calls.filter(call => ['type_text', 'press_key', 'hotkey'].includes(call.name)),
  };
}

test('input queued during capture survives the new frame while old pointer coordinates are rejected', async t => {
  const f = await fixture(t), release = f.holdCapture();
  const capture = f.session.capture();
  f.input('abc');
  f.keyboard.emit('keydown', {key: 'Enter'});
  const pointer = assert.rejects(f.viewer.run('click', {x: 10, y: 10}), error => error.code === 'stale_capture');
  release();
  await capture;
  await pointer;
  await tick();
  assert.deepEqual(f.inputs().map(call => [call.name, call.args.text || call.args.key]),
    [['type_text', 'abc'], ['press_key', 'return']]);
  assert.equal(f.calls.filter(call => call.name === 'click').length, 0);
  assert.equal(f.keyboard.value, '');
  assert.deepEqual(f.errors, []);
});

test('typing through the previous action post-capture does not drop or replay characters', async t => {
  const f = await fixture(t), release = f.holdCapture();
  f.input('a');
  await tick();
  assert.equal(f.session.state.capturing, true);
  f.input('b');
  f.input('c');
  f.keyboard.emit('keydown', {key: 'ArrowLeft'});
  release();
  await tick();
  assert.deepEqual(f.inputs().map(call => [call.name, call.args.text || call.args.key]),
    [['type_text', 'a'], ['type_text', 'b'], ['type_text', 'c'], ['press_key', 'left']]);
  assert.deepEqual(f.errors, []);
});

test('same-epoch decode preserves IME and buffers committed text and keys in order', async t => {
  const f = await fixture(t), release = f.holdDecode();
  f.keyboard.emit('compositionstart');
  f.keyboard.value = '中文';
  f.keyboard.emit('input', {isComposing: true});
  await f.session.capture();
  assert.equal(f.viewer.decoding, true);
  assert.equal(f.viewer.composing, true);
  assert.equal(f.keyboard.value, '中文');
  f.keyboard.emit('compositionend');
  f.keyboard.emit('input');
  f.input('🙂');
  f.keyboard.emit('keydown', {key: 'Delete'});
  assert.equal(f.inputs().length, 0, 'text waits for the pending decode');
  release();
  await tick();
  assert.deepEqual(f.inputs().map(call => [call.name, call.args.text || call.args.key]),
    [['type_text', '中文🙂'], ['press_key', 'del']]);
  assert.equal(f.viewer.pendingInput.length, 0);
  assert.deepEqual(f.errors, []);
});

for (const change of ['target', 'host', 'disable', 'close']) {
  test(`${change} discards input buffered during decode, including after a late bitmap arrives`, async t => {
    const f = await fixture(t), release = f.holdDecode();
    await f.session.capture();
    f.input('must not reach another context');
    f.keyboard.emit('keydown', {key: 'Enter'});
    assert.equal(f.viewer.pendingInput.length, 2);
    if (change === 'target') f.session.selectTarget({kind: 'window', pid: 41, window_id: 7});
    if (change === 'host') await f.session.connect('second');
    if (change === 'disable') f.session.setControl(false);
    if (change === 'close') {f.viewer.close(); await f.session.close();}
    release();
    await tick();
    assert.equal(f.inputs().length, 0);
    assert.equal(f.viewer.pendingInput.length, 0);
    assert.deepEqual(f.errors, []);
  });
}
