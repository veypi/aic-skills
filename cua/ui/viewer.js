// Render one CUA snapshot and translate local gestures into complete MCP actions.
// No remote key/button is kept down between calls, and input is never replayed.
const TEXT_ACTIONS = new Set(['type_text', 'press_key', 'hotkey']);
export class CuaViewer {
  constructor(canvas, keyboard, {action, gesture = () => {}, error = () => {}}) {
    this.canvas = canvas;
    this.keyboard = keyboard;
    this.action = action;
    this.gesture = gesture;
    this.error = error;
    this.platform = '';
    this.deliveryMode = 'background';
    this.control = false;
    this.closed = false;
    this.generation = 0;
    this.pendingInput = [];
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
      if (!pointer || event.pointerId !== pointer.id) return;
      event.preventDefault();
      const point = this.point(event);
      this.pointer = null;
      if (point && pointer.frame === this.frame) {
        const button = ['left', 'middle', 'right'][pointer.button];
        if (pointer.moved) {
          this.suppressClick = true;
          this.dispatch('drag', {from_x:pointer.point.x, from_y:pointer.point.y, to_x:point.x, to_y:point.y,
            button, duration_ms:Math.min(2000, Math.max(50, Date.now() - pointer.started)), modifier:pointer.modifier}, pointer.frame);
        } else if (pointer.button !== 0) {
          this.dispatch('click', {...point, button, count:1, modifier:pointer.modifier}, pointer.frame);
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
      clearTimeout(this.clickTimer);
      if (event.detail === 2) {
        this.dispatch('click', {...point, button:'left', count:2, modifier}, frame);
        this.gesture(false);
      } else {
        // Coalesce a double click into one upstream click(count:2), not three clicks.
        this.gesture(true);
        this.clickTimer = setTimeout(() => {
          this.clickTimer = null;
          this.dispatch('click', {...point, button:'left', count:1, modifier}, frame);
          this.gesture(false);
        }, 250);
      }
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
      if (this.wheel?.direction === direction && this.wheel.frame === this.frame)
        this.wheel.amount = Math.min(10, this.wheel.amount + amount);
      else this.wheel = {direction, amount, frame:this.frame, point};
      this.wheel.point = point;
      if (!this.wheelTimer) {
        this.gesture(true);
        this.wheelTimer = setTimeout(() => {
          const wheel = this.wheel;
          this.wheelTimer = null; this.wheel = null;
          if (wheel) this.dispatch('scroll', {...wheel.point, direction:wheel.direction, amount:wheel.amount, by:'line'}, wheel.frame);
          this.gesture(false);
        }, 100);
      }
    }, {passive:false});
    on(keyboard, 'keydown', event => {
      if (!this.control || !this.inputFrame() || event.isComposing || event.key === 'Process' || event.key === 'Dead') return;
      if (['Control', 'Meta', 'Shift', 'Alt'].includes(event.key)) return;
      // Native paste lands in this textarea, then type_text forwards the text.
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
      if (!this.control || !this.inputFrame()) return;
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
  setDeliveryMode(mode) {
    if (!['background', 'foreground'].includes(mode)) throw new Error('Invalid input delivery mode');
    if (this.deliveryMode === mode) return;
    this.cancelInput();
    this.deliveryMode = mode;
  }
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
    // Undo only the Pod preview resize. The upstream driver still owns its
    // screenshot-to-desktop/window mapping, including native DPI and capture_id.
    const sourceWidth = this.frame.sourceWidth || this.canvas.width;
    const sourceHeight = this.frame.sourceHeight || this.canvas.height;
    return {x:Math.min(sourceWidth - 1, Math.floor(x * sourceWidth / this.canvas.width)),
      y:Math.min(sourceHeight - 1, Math.floor(y * sourceHeight / this.canvas.height))};
  }
  async showFrame(frame) {
    if (this.closed) return null;
    const generation = ++this.generation;
    const previous = this.inputFrame();
    if (previous?.epoch === frame.epoch) this.cancelCoordinates();
    else this.cancelInput();
    this.frame = null;
    this.pendingFrame = frame;
    this.decoding = true;
    let bitmap;
    try {
      const {data, mimeType} = frame.image;
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(mimeType)) throw new Error('Unsupported CUA screenshot format');
      const bytes = Uint8Array.from(atob(data), char => char.charCodeAt(0));
      bitmap = await createImageBitmap(new Blob([bytes], {type:mimeType}));
      if (this.closed || generation !== this.generation) return null;
      if (!bitmap.width || !bitmap.height) throw new Error('Empty CUA screenshot');
      const sourceWidth = frame.sourceWidth ?? bitmap.width;
      const sourceHeight = frame.sourceHeight ?? bitmap.height;
      if (![sourceWidth, sourceHeight].every(value => Number.isSafeInteger(value) && value > 0)
          || (frame.previewWidth != null && frame.previewWidth !== bitmap.width)
          || (frame.previewHeight != null && frame.previewHeight !== bitmap.height)) {
        throw new Error('Invalid CUA preview coordinate dimensions');
      }
      this.canvas.width = bitmap.width;
      this.canvas.height = bitmap.height;
      this.canvas.getContext('2d').drawImage(bitmap, 0, 0);
      this.frame = {...frame, width:bitmap.width, height:bitmap.height, sourceWidth, sourceHeight};
      this.pendingFrame = null;
      this.decoding = false;
      this.flushInput();
      return this.frame;
    } catch (error) {
      if (this.closed || generation !== this.generation) return null;
      this.pendingFrame = null;
      this.decoding = false;
      this.cancelInput();
      throw error;
    } finally {bitmap?.close();}
  }
  inputFrame() {return this.pendingFrame || this.frame;}
  async run(name, args, frame = this.inputFrame()) {
    const current = this.inputFrame(), text = TEXT_ACTIONS.has(name);
    if (this.closed || !this.control || !frame || !current
        || (text ? frame.epoch !== current.epoch : this.decoding || frame !== this.frame)) {
      throw new Error('A current screenshot and control mode are required');
    }
    args = {...args, delivery_mode:this.deliveryMode};
    if (text && this.decoding) {
      return new Promise((resolve, reject) => {
        const previous = this.pendingInput.at(-1);
        if (name === 'type_text' && previous?.name === name && previous.epoch === current.epoch) {
          previous.args.text += args.text;
          previous.waiters.push({resolve, reject});
        } else if (this.pendingInput.length >= 16) {
          reject(new Error('CUA input queue is full'));
        } else {
          this.pendingInput.push({name, args, epoch:current.epoch, waiters:[{resolve, reject}]});
        }
      });
    }
    return this.action(name, args, text ? current : frame);
  }
  dispatch(name, args, frame = this.inputFrame()) {
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
  flushInput() {
    if (this.decoding || !this.frame || !this.control || this.closed) return;
    for (const job of this.pendingInput.splice(0)) {
      if (job.epoch !== this.frame.epoch) {
        for (const waiter of job.waiters) waiter.resolve(null);
        continue;
      }
      Promise.resolve(this.action(job.name, job.args, this.frame)).then(
        value => {for (const waiter of job.waiters) waiter.resolve(value);},
        error => {for (const waiter of job.waiters) waiter.reject(error);},
      );
    }
  }
  cancelCoordinates() {
    this.cancelPointer();
    clearTimeout(this.clickTimer); clearTimeout(this.wheelTimer);
    this.clickTimer = null; this.wheelTimer = null; this.wheel = null;
    this.suppressClick = false;
    this.gesture(!!this.composing);
  }
  cancelInput() {
    this.composing = false;
    this.cancelCoordinates();
    this.keyboard.value = '';
    for (const job of this.pendingInput.splice(0)) {
      for (const waiter of job.waiters) waiter.resolve(null);
    }
    this.gesture(false);
  }
  clear() {
    ++this.generation;
    this.frame = null;
    this.pendingFrame = null;
    this.decoding = false;
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
