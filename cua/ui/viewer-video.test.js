import test from 'node:test';
import assert from 'node:assert/strict';
import {CuaViewer} from './viewer.js';

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

const videoFrame = () => ({displayWidth: 800, displayHeight: 600, close() {}});
const frame = frameId => ({video: true, videoFrame: videoFrame(), frameId, epoch: 1,
  previewWidth: 800, previewHeight: 600, sourceWidth: 800, sourceHeight: 600});

test('continuous video frames do not cancel input or add fixed latency', t => {
  const canvas = new Node(), keyboard = new Node(), actions = [];
  const viewer = new CuaViewer(canvas, keyboard, {
    action: (name, args, bound) => {actions.push({name, args, bound}); return Promise.resolve({});},
  });
  t.after(() => viewer.close());
  viewer.setControl(true);
  viewer.showVideoFrame(frame(1));

  canvas.emit('pointerdown', {clientX: 20, clientY: 30, button: 2, pointerId: 1, isPrimary: true});
  viewer.showVideoFrame(frame(2));
  canvas.emit('pointerup', {clientX: 20, clientY: 30, button: 2, pointerId: 1});
  assert.equal(actions.length, 1, 'the pointer down survives an intermediate video frame');
  assert.equal(actions[0].name, 'click');
  assert.equal(actions[0].bound.frameId, 2, 'the action uses the latest shown frame');

  canvas.emit('wheel', {clientX: 20, clientY: 30, deltaY: 100, deltaX: 0, deltaMode: 0});
  viewer.showVideoFrame(frame(3));
  canvas.emit('wheel', {clientX: 20, clientY: 30, deltaY: 100, deltaX: 0, deltaMode: 0});
  assert.equal(actions.length, 3, 'wheel events dispatch immediately across video frames');
  assert.equal(actions[1].name, 'scroll');
  assert.equal(actions[1].args.amount, 1);
  assert.equal(actions[1].bound.frameId, 2);
  assert.equal(actions[2].name, 'scroll');
  assert.equal(actions[2].args.amount, 1);
  assert.equal(actions[2].bound.frameId, 3);

  canvas.emit('pointerdown', {clientX: 20, clientY: 30, button: 0, pointerId: 2, isPrimary: true});
  canvas.emit('pointerup', {clientX: 20, clientY: 30, button: 0, pointerId: 2});
  canvas.emit('click', {clientX: 20, clientY: 30, button: 0, detail: 1});
  assert.equal(actions.length, 4, 'left click does not wait 250ms for double-click detection');
  assert.equal(actions[3].name, 'click');
  assert.equal(actions[3].args.count, 1);
});
