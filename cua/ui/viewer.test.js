import test from 'node:test';
import assert from 'node:assert/strict';
import {CuaViewer} from './viewer.js';

class Node extends EventTarget {
  value = ''; width = 1280; height = 720; captured = new Set();
  getBoundingClientRect() {return {left:10, top:20, width:640, height:360};}
  focus() {}
  setPointerCapture(id) {this.captured.add(id);}
  hasPointerCapture(id) {return this.captured.has(id);}
  releasePointerCapture(id) {this.captured.delete(id);}
  getContext() {return {drawImage:() => this.drawn = true, clearRect:() => this.cleared = true};}
  emit(type, properties = {}) {
    const event = new Event(type, {cancelable:true});
    for (const [key, value] of Object.entries(properties)) Object.defineProperty(event, key, {value});
    this.dispatchEvent(event);
    return event;
  }
}
function setup(t) {
  const canvas = new Node(), keyboard = new Node(), sent = [], errors = [], gestures = [];
  const viewer = new CuaViewer(canvas, keyboard, {
    action:(name, args, frame) => {sent.push({name, args, frame}); return Promise.resolve();},
    error:error => errors.push(error), gesture:value => gestures.push(value),
  });
  const frame = viewer.frame = {frameId:1, captureId:'one', epoch:4};
  t.after(() => viewer.close());
  return {canvas, keyboard, viewer, frame, sent, errors, gestures};
}
const point = {clientX:330, clientY:200, button:0, pointerId:1, detail:1};
function mockDecode(t, decode) {
  const previous = globalThis.createImageBitmap;
  globalThis.createImageBitmap = decode;
  t.after(() => {if (previous) globalThis.createImageBitmap = previous; else delete globalThis.createImageBitmap;});
}

test('read-only does not forward input; scaled coordinates exclude letterbox margins', t => {
  const s = setup(t);
  s.canvas.emit('click', point);
  s.keyboard.emit('keydown', {key:'Enter'});
  assert.equal(s.sent.length, 0);
  assert.deepEqual(s.viewer.point(point), {x:640, y:360});
  s.canvas.getBoundingClientRect = () => ({left:10, top:20, width:640, height:640});
  assert.equal(s.viewer.point({clientX:30, clientY:30}), null);
  assert.deepEqual(s.viewer.point({clientX:330, clientY:340}), {x:640, y:360});
});

test('double click is one count:2 command, and disabling control cancels delayed clicks', t => {
  t.mock.timers.enable({apis:['setTimeout']});
  const s = setup(t); s.viewer.setControl(true);
  s.canvas.emit('click', point);
  s.canvas.emit('click', {...point, detail:2});
  t.mock.timers.tick(300);
  assert.equal(s.sent.length, 1);
  assert.deepEqual(s.sent[0].args, {x:640, y:360, button:'left', count:2, modifier:[], delivery_mode:'background'});
  s.canvas.emit('click', point);
  s.viewer.setControl(false);
  t.mock.timers.tick(300);
  assert.equal(s.sent.length, 1);
});

test('right click and drag use screenshot coordinates and complete gestures', t => {
  const s = setup(t); s.viewer.setControl(true); s.viewer.setPlatform('darwin');
  s.canvas.emit('pointerdown', {...point, button:2, metaKey:true});
  s.canvas.emit('pointerup', {...point, button:2});
  assert.deepEqual(s.sent[0].args, {x:640, y:360, button:'right', count:1, modifier:['cmd'], delivery_mode:'background'});
  s.viewer.setDeliveryMode('foreground');
  s.canvas.emit('pointerdown', point);
  // Reapplying unchanged mode must not cancel a gesture during a state update.
  s.viewer.setDeliveryMode('foreground');
  s.canvas.emit('pointermove', {...point, clientX:430, clientY:250});
  s.canvas.emit('pointerup', {...point, clientX:430, clientY:250});
  s.canvas.emit('click', point);
  assert.equal(s.sent.length, 2);
  const drag = s.sent[1];
  assert.equal(drag.name, 'drag');
  assert.equal(drag.args.from_x, 640); assert.equal(drag.args.to_x, 840);
  assert.equal(drag.args.to_y, 460); assert.equal(drag.args.delivery_mode, 'foreground');
  assert.equal(s.canvas.captured.size, 0);
});

test('wheel batches bounded scroll notches at the pointer, without unsupported modifier', t => {
  t.mock.timers.enable({apis:['setTimeout']});
  const s = setup(t); s.viewer.setControl(true);
  for (let i = 0; i < 3; i++) s.canvas.emit('wheel', {...point, deltaX:0, deltaY:120, deltaMode:0});
  t.mock.timers.tick(100);
  assert.equal(s.sent.length, 1);
  assert.deepEqual(s.sent[0].args, {x:640, y:360, direction:'down', amount:6, by:'line', delivery_mode:'background'});
});

test('committed IME and paste stay literal; shortcuts use the remote platform', t => {
  const s = setup(t); s.viewer.setControl(true); s.viewer.setPlatform('windows');
  s.keyboard.emit('compositionstart'); s.keyboard.value = '中文🙂';
  s.keyboard.emit('input', {isComposing:true});
  assert.equal(s.sent.length, 0);
  s.keyboard.emit('compositionend'); s.keyboard.emit('input');
  s.keyboard.value = '$HOME; `literal`\nnext'; s.keyboard.emit('input');
  assert.deepEqual(s.sent.map(item => item.args.text), ['中文🙂', '$HOME; `literal`\nnext']);
  s.keyboard.emit('keydown', {key:'ArrowLeft', ctrlKey:true});
  assert.deepEqual(s.sent.at(-1).args.keys, ['ctrl', 'left']);
  s.keyboard.emit('keydown', {key:'e', metaKey:true});
  assert.deepEqual(s.sent.at(-1).args.keys, ['win', 'e']);
  const paste = s.keyboard.emit('keydown', {key:'v', ctrlKey:true});
  assert.equal(paste.defaultPrevented, false);
});

test('clear and close cancel all local pending input and reject old frame actions', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  const s = setup(t); s.viewer.setControl(true);
  s.canvas.emit('click', point);
  s.canvas.emit('wheel', {...point, deltaX:0, deltaY:200, deltaMode:0});
  s.viewer.clear(); t.mock.timers.tick(500);
  assert.equal(s.sent.length, 0);
  await assert.rejects(s.viewer.run('click', {}, s.frame), /current screenshot/);
  s.viewer.close(); s.viewer.frame = s.frame;
  s.keyboard.value = 'ignored'; s.keyboard.emit('input');
  assert.equal(s.sent.length, 0);
  assert.equal(s.gestures.at(-1), false);
});

test('a late image decode cannot replace a newer target and releases its bitmap', async t => {
  const s = setup(t), decodes = [];
  mockDecode(t, () => new Promise(resolve => decodes.push(resolve)));
  const pending = s.viewer.showFrame({image:{data:'AAAA', mimeType:'image/png'}, frameId:1});
  s.viewer.clear();
  let closed = false;
  decodes[0]({width:1920, height:1080, close() {closed = true;}});
  assert.equal(await pending, null);
  assert.equal(closed, true);
  assert.equal(s.canvas.drawn, undefined);
});

test('decoded image dimensions define pointer coordinates, independent of DPI metadata', async t => {
  const s = setup(t);
  mockDecode(t, async () => ({width:1280, height:720, close() {}}));
  const frame = await s.viewer.showFrame({image:{data:'AAAA', mimeType:'image/png'}, frameId:2, width:2560, height:1440});
  assert.equal(frame.width, 1280); assert.equal(s.canvas.width, 1280);
  assert.deepEqual(s.viewer.point(point), {x:640, y:360});
});

test('forward delete and named keys use explicit mappings; unsupported keys are ignored', async t => {
  const s = setup(t); s.viewer.setControl(true); s.viewer.setPlatform('darwin');
  for (const key of ['Delete', 'Backspace', 'F1', 'F12', 'F13', 'Insert', 'CapsLock', 'AudioVolumeUp', 'Unidentified'])
    s.keyboard.emit('keydown', {key});
  assert.deepEqual(s.sent.map(item => item.args.key), ['del', 'backspace', 'f1', 'f12']);
  await s.viewer.pressKey('Delete');
  await s.viewer.pressKey('UnknownNamedKey');
  await s.viewer.hotkey(['cmd', 'UnknownNamedKey']);
  await s.viewer.hotkey(['cmd']);
  assert.equal(s.sent.length, 5);
  assert.equal(s.sent.at(-1).args.key, 'del');
});

test('720p preview maps click, drag and scroll back to upstream 4K screenshot pixels', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  const s = setup(t);
  mockDecode(t, async () => ({width:1280, height:720, close() {}}));
  const frame = await s.viewer.showFrame({image:{data:'AAAA', mimeType:'image/jpeg'}, frameId:8, captureId:'upstream', epoch:4,
    sourceWidth:3840, sourceHeight:2160, previewWidth:1280, previewHeight:720});
  assert.equal(frame.width, 1280);
  assert.equal(frame.sourceWidth, 3840);
  assert.deepEqual(s.viewer.point(point), {x:1920, y:1080});
  s.viewer.setControl(true);
  s.canvas.emit('pointerdown', {...point, button:2});
  s.canvas.emit('pointerup', {...point, button:2});
  assert.equal(s.sent[0].name, 'click');
  assert.equal(s.sent[0].args.x, 1920);
  assert.equal(s.sent[0].args.y, 1080);
  for (const drift of [1, 2, 3]) {
    const release = {...point, clientX:point.clientX + drift, clientY:point.clientY + drift};
    s.canvas.emit('pointerdown', point);
    s.canvas.emit('pointermove', release);
    s.canvas.emit('pointerup', release);
    s.canvas.emit('click', release);
    t.mock.timers.tick(300);
    assert.equal(s.sent.at(-1).name, 'click', `${drift} CSS pixels of pointer noise must remain a click`);
  }
  assert.equal(s.sent.some(action => action.name === 'drag'), false);
  s.canvas.emit('pointerdown', point);
  s.canvas.emit('pointermove', {...point, clientX:490, clientY:290});
  s.canvas.emit('pointerup', {...point, clientX:490, clientY:290});
  const drag = s.sent.at(-1);
  assert.equal(drag.name, 'drag');
  assert.deepEqual([drag.args.from_x, drag.args.from_y, drag.args.to_x, drag.args.to_y], [1920, 1080, 2880, 1620]);
  s.canvas.emit('wheel', {...point, deltaX:0, deltaY:100, deltaMode:0});
  t.mock.timers.tick(100);
  const scroll = s.sent.at(-1);
  assert.equal(scroll.name, 'scroll');
  assert.equal(scroll.args.x, 1920);
  assert.equal(scroll.args.y, 1080);
  assert.equal(scroll.frame.captureId, 'upstream');
  assert.deepEqual(s.errors, []);
});

test('portrait previews exclude side margins and use their own scale rather than display DPI', async t => {
  const s = setup(t);
  s.canvas.getBoundingClientRect = () => ({left:10, top:20, width:640, height:640});
  mockDecode(t, async () => ({width:405, height:720, close() {}}));
  await s.viewer.showFrame({image:{data:'AAAA', mimeType:'image/jpeg'}, frameId:2,
    sourceWidth:1080, sourceHeight:1920, previewWidth:405, previewHeight:720,
    width:2160, height:3840, scale_factor:2});
  assert.deepEqual(s.viewer.point({clientX:330, clientY:340}), {x:540, y:960});
  assert.equal(s.viewer.point({clientX:100, clientY:340}), null);
  assert.deepEqual(s.viewer.point({clientX:509.9, clientY:659.9}), {x:1079, y:1919});
});

test('window previews reverse only Pod resizing even when the driver already scaled its screenshot', async t => {
  const s = setup(t);
  mockDecode(t, async () => ({width:1152, height:720, close() {}}));
  await s.viewer.showFrame({image:{data:'AAAA', mimeType:'image/jpeg'}, frameId:2,
    sourceWidth:1600, sourceHeight:1000, previewWidth:1152, previewHeight:720,
    width:3200, height:2000, screenshot_scale:0.5});
  assert.deepEqual(s.viewer.point(point), {x:800, y:500});
  assert.equal(s.viewer.point({clientX:20, clientY:200}), null);
});

test('a mismatched preview decode refuses coordinate dispatch and releases its bitmap', async t => {
  const s = setup(t);
  let closed = false;
  mockDecode(t, async () => ({width:800, height:600, close() {closed = true;}}));
  await assert.rejects(s.viewer.showFrame({image:{data:'AAAA', mimeType:'image/jpeg'}, frameId:2,
    sourceWidth:3840, sourceHeight:2160, previewWidth:1280, previewHeight:720}), /preview coordinate dimensions/);
  assert.equal(s.viewer.frame, null);
  assert.equal(s.viewer.point(point), null);
  assert.equal(closed, true);
});
