// Render decoded H.264 frames and translate local gestures into MCP actions.
// The desktop has exactly one observation path: cua_cast. No screenshots.
const TEXT_ACTIONS = new Set(['type_text', 'press_key', 'hotkey']);
const sameVideoContext = (a, b) => a?.video === true && b?.video === true && a.epoch === b.epoch;

export class CuaViewer {
  constructor(canvas, keyboard, {action, gesture = () => {}, error = () => {}}) {
    this.canvas = canvas;
    this.keyboard = keyboard;
    this.action = action;
    this.gesture = gesture;
    this.error = error;
    this.platform = '';
    this.control = false;
    this.closed = false;
    this.listeners = [];
    const on = (node, name, fn, options) => {
      node.addEventListener(name, fn, options);
      this.listeners.push(() => node.removeEventListener(name, fn, options));
    };
    on(canvas, 'pointerdown', event => {
      if (!this.control || !this.frame || event.isPrimary === false) return;
      const point = this.point(event);
      if (!point) return;
      event.preventDefault();
      this.keyboard.focus({preventScroll:true});
      this.cancelPointer();
      this.pointer = {point, clientX:event.clientX, clientY:event.clientY, frame:this.frame, id:event.pointerId, button:event.button,
        started:Date.now(), modifier:this.modifiers(event), moved:false};
      this.gesture(true);
      canvas.setPointerCapture?.(event.pointerId);
    });
    on(canvas, 'pointermove', event => {
      if (!this.pointer || event.pointerId !== this.pointer.id) return;
      const point = this.point(event);
      if (point && Math.hypot(event.clientX - this.pointer.clientX, event.clientY - this.pointer.clientY) >= 5)
        this.pointer.moved = true;
    });
    on(canvas, 'pointerup', event => {
      const pointer = this.pointer;
      if (!pointer || pointer.id !== event.pointerId) return;
      event.preventDefault();
      const point = this.point(event);
      this.pointer = null;
      if (point && (pointer.frame === this.frame || sameVideoContext(pointer.frame, this.frame))) {
        const frame = sameVideoContext(pointer.frame, this.frame) ? this.frame : pointer.frame;
        const button = ['left', 'middle', 'right'][pointer.button];
        if (pointer.moved) {
          this.suppressClick = true;
          this.dispatch('drag', {from_x:pointer.point.x, from_y:pointer.point.y, to_x:point.x, to_y:point.y,
            button, duration_ms:Math.min(2000, Math.max(50, Date.now() - pointer.started)), modifier:pointer.modifier}, frame);
        } else if (pointer.button !== 0) {
          this.dispatch('click', {...point, button, count:1, modifier:pointer.modifier}, frame);
        }
      }
      this.gesture(false);
      if (canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    });
    on(canvas, 'click', event => {
      event.preventDefault();
      if (this.suppressClick) {this.suppressClick = false; return;}
      const point = this.point(event);
      if (!this.control || !point || !this.frame) return;
      const frame = this.frame, modifier = this.modifiers(event);
      // 单击绝不为双击识别等待 250ms；两次原生单击本身就是一次双击。
      this.dispatch('click', {...point, button:'left', count:1, modifier}, frame);
    });
    on(canvas, 'contextmenu', event => event.preventDefault());
    on(canvas, 'auxclick', event => event.preventDefault());
    on(canvas, 'pointercancel', () => this.cancelPointer());
    on(canvas, 'lostpointercapture', () => this.cancelPointer());
    on(canvas, 'wheel', event => {
      const point = this.point(event);
      if (!this.control || !this.frame || !point) return;
      event.preventDefault();
      const horizontal = Math.abs(event.deltaX) > Math.abs(event.deltaY);
      const delta = horizontal ? event.deltaX : event.deltaY;
      if (!delta) return;
      const direction = horizontal ? (delta > 0 ? 'right' : 'left') : (delta > 0 ? 'down' : 'up');
      const amount = Math.min(10, Math.max(1, Math.ceil(Math.abs(delta) / (event.deltaMode === 0 ? 100 : 3))));
      // 滚轮是实时输入，不做 100ms 批处理等待。
      this.dispatch('scroll', {...point, direction, amount, by:'line'}, this.frame);
    }, {passive:false});
    on(keyboard, 'keydown', event => {
      if (!this.control || !this.frame || event.isComposing || event.key === 'Process' || event.key === 'Dead') return;
      if (['Control', 'Meta', 'Shift', 'Alt'].includes(event.key)) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v') return;
      const modifiers = this.modifiers(event);
      if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) return;
      const key = keyName(event.key);
      if (!key) return;
      event.preventDefault();
      if (event.repeat) return;
      if (modifiers.length) this.dispatch('hotkey', {keys:[...modifiers, key]});
      else this.dispatch('press_key', {key});
    });
    on(keyboard, 'compositionstart', () => {
      if (!this.control || !this.frame) return;
      this.composing = true;
      this.gesture(true);
    });
    on(keyboard, 'compositionend', () => {
      this.composing = false;
      this.commitText();
      this.gesture(false);
    });
    on(keyboard, 'input', event => {if (!event.isComposing) this.commitText();});
    on(keyboard, 'blur', () => this.cancelCoordinates());
  }

  setPlatform(platform) {this.platform = String(platform || '').toLowerCase();}
  setControl(value) {
    this.control = Boolean(value);
    if (!this.control) this.cancelInput();
  }
  modifiers(event) {
    const mac = /darwin|mac/.test(this.platform);
    return [event.ctrlKey && 'ctrl', event.metaKey && (mac ? 'cmd' : 'win'),
      event.altKey && (mac ? 'option' : 'alt'), event.shiftKey && 'shift'].filter(Boolean);
  }
  point(event) {
    if (!this.frame || !this.canvas.width || !this.canvas.height) return null;
    const rect = this.canvas.getBoundingClientRect();
    const scale = Math.min(rect.width / this.canvas.width, rect.height / this.canvas.height);
    if (!Number.isFinite(scale) || scale <= 0) return null;
    const x = (event.clientX - rect.left - (rect.width - this.canvas.width * scale) / 2) / scale;
    const y = (event.clientY - rect.top - (rect.height - this.canvas.height * scale) / 2) / scale;
    if (x < 0 || y < 0 || x >= this.canvas.width || y >= this.canvas.height) return null;
    const sourceWidth = this.frame.sourceWidth || this.canvas.width;
    const sourceHeight = this.frame.sourceHeight || this.canvas.height;
    return {x:Math.min(sourceWidth - 1, Math.floor(x * sourceWidth / this.canvas.width)),
      y:Math.min(sourceHeight - 1, Math.floor(y * sourceHeight / this.canvas.height))};
  }

  // Continuous frames never cancel an in-progress pointer, IME composition or wheel batch.
  showVideoFrame(frame) {
    if (this.closed) return null;
    const width = frame.previewWidth || frame.videoFrame.displayWidth || frame.videoFrame.codedWidth;
    const height = frame.previewHeight || frame.videoFrame.displayHeight || frame.videoFrame.codedHeight;
    const sourceWidth = frame.sourceWidth || width, sourceHeight = frame.sourceHeight || height;
    if (![width, height, sourceWidth, sourceHeight].every(value => Number.isSafeInteger(value) && value > 0)) {
      throw new Error('Invalid CUA video coordinate dimensions');
    }
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
    this.canvas.getContext('2d').drawImage(frame.videoFrame, 0, 0);
    this.frame = {...frame, width, height, sourceWidth, sourceHeight};
    return this.frame;
  }

  run(name, args, frame = this.frame) {
    const current = this.frame, text = TEXT_ACTIONS.has(name);
    const continuousVideo = sameVideoContext(frame, current);
    if (this.closed || !this.control || !frame || !current
        || (text ? frame.epoch !== current.epoch : frame !== current && !continuousVideo)) {
      throw new Error('A current video frame and control mode are required');
    }
    return this.action(name, {...args}, text ? current : continuousVideo ? current : frame);
  }
  dispatch(name, args, frame = this.frame) {
    this.run(name, args, frame).catch(error => {if (!this.closed) this.error(error);});
  }
  typeText(text) {
    if (!String(text).length) return Promise.resolve();
    return this.run('type_text', {text:String(text)});
  }
  pressKey(key) {
    key = keyName(key);
    return key ? this.run('press_key', {key}) : Promise.resolve();
  }
  hotkey(keys) {
    keys = keys.map(keyName);
    return keys.length >= 2 && keys.every(Boolean) ? this.run('hotkey', {keys}) : Promise.resolve();
  }
  commitText() {
    if (this.composing || !this.keyboard.value) return;
    const text = this.keyboard.value;
    this.keyboard.value = '';
    this.dispatch('type_text', {text});
  }
  cancelPointer() {
    if (this.pointer) {
      const id = this.pointer.id;
      this.pointer = null;
      if (this.canvas.hasPointerCapture?.(id)) this.canvas.releasePointerCapture(id);
      this.gesture(!!this.composing);
    }
  }
  cancelCoordinates() {
    this.cancelPointer();
    this.suppressClick = false;
    this.gesture(!!this.composing);
  }
  cancelInput() {
    this.composing = false;
    this.cancelCoordinates();
    this.keyboard.value = '';
    this.gesture(false);
  }
  clear() {
    this.frame = null;
    this.cancelInput();
    this.canvas.getContext('2d').clearRect(0, 0, this.canvas.width, this.canvas.height);
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.clear();
    for (const remove of this.listeners) remove();
    this.listeners.length = 0;
  }
}

function keyName(key) {
  const named = {Enter:'return', Escape:'esc', Backspace:'backspace', Delete:'del', delete:'del', Tab:'tab', ' ':'space',
    ArrowUp:'up', ArrowDown:'down', ArrowLeft:'left', ArrowRight:'right', Home:'home', End:'end',
    PageUp:'pageup', PageDown:'pagedown'};
  if (named[key]) return named[key];
  if (typeof key !== 'string') return null;
  if (/^(?:[!-~]|f(?:[1-9]|1[0-2]))$/i.test(key)) return key.toLowerCase();
  if (['return', 'esc', 'backspace', 'del', 'tab', 'space', 'up', 'down', 'left', 'right',
    'home', 'end', 'pageup', 'pagedown', 'ctrl', 'cmd', 'win', 'alt', 'option', 'shift'].includes(key)) return key;
  return null;
}
