import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACK_WATCHDOG_MS,
  CuaCast,
  MAX_DECODE_QUEUE,
  codecFromAnnexB,
} from './cast.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
const SPS = new Uint8Array([0, 0, 0, 1, 0x67, 0x42, 0xc0, 0x1f, 0x95]);
const IDR = new Uint8Array([0, 0, 0, 1, 0x65, 1, 2, 3]);
const DELTA = new Uint8Array([0, 0, 0, 1, 0x41, 4, 5]);
const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) {out.set(part, offset); offset += part.length;}
  return out;
};

function packet(kind, seq, payload = new Uint8Array(0)) {
  const out = new Uint8Array(13 + payload.length);
  const view = new DataView(out.buffer);
  view.setUint8(0, kind);
  view.setUint32(1, payload.length);
  view.setBigUint64(5, BigInt(seq));
  out.set(payload, 13);
  return out;
}

function framePacket(seq, {idr = false, width = 640, height = 360, pts = 1000, au = IDR} = {}) {
  const payload = new Uint8Array(9 + au.length);
  const view = new DataView(payload.buffer);
  view.setUint8(0, idr ? 1 : 0);
  view.setUint16(1, width);
  view.setUint16(3, height);
  view.setUint32(5, pts);
  payload.set(au, 9);
  return packet(1, seq, payload);
}

function control(value) {
  return packet(2, 0, new TextEncoder().encode(JSON.stringify(value)));
}

class FakeChunk {
  constructor(init) {Object.assign(this, init);}
}

class FakeDecoder {
  constructor(callbacks, world) {
    this.callbacks = callbacks;
    this.world = world;
    this.decodeQueueSize = 0;
    this.config = null;
    this.closed = false;
    world.decoders.push(this);
  }
  configure(config) {
    this.config = config;
    if (this.world.configureError) throw this.world.configureError;
  }
  decode(chunk) {
    this.world.chunks.push(chunk);
    if (this.world.decodeError) {
      const error = this.world.decodeError;
      this.world.decodeError = null;
      throw error;
    }
  }
  close() {this.closed = true; this.closeCount = (this.closeCount || 0) + 1;}
  flush() {this.world.flushes = (this.world.flushes || 0) + 1; return Promise.resolve();}
  output(timestamp, {seq = 1n} = {}) {
    const videoFrame = {
      timestamp,
      seq,
      closed: 0,
      close() {this.closed++;},
    };
    this.world.videoFrames.push(videoFrame);
    this.callbacks.output(videoFrame);
    return videoFrame;
  }
}

function fixture(t, options = {}) {
  const originalDecoder = globalThis.VideoDecoder;
  const originalChunk = globalThis.EncodedVideoChunk;
  globalThis.VideoDecoder = FakeDecoder;
  globalThis.EncodedVideoChunk = FakeChunk;
  const world = {
    decoders: [], chunks: [], videoFrames: [], sent: [], errors: [], closed: [], frames: [],
    configureError: null, decodeError: null,
  };
  let streamOptions;
  const stream = {
    ready: options.ready || Promise.resolve(),
    send(bytes) {world.sent.push(bytes); return true;},
    close() {world.streamClosed = (world.streamClosed || 0) + 1;},
  };
  const connection = {
    openStream(value) {streamOptions = value; return stream;},
  };
  const cast = new CuaCast({
    connection,
    decoderFactory: callbacks => new FakeDecoder(callbacks, world),
    startupFlush: false,
    frame: value => {
      world.frames.push(value);
      if (options.frame) options.frame(value);
    },
    closed: error => world.closed.push(error),
    error: error => world.errors.push(error),
  });
  t.after(() => {
    cast.close();
    if (originalDecoder) globalThis.VideoDecoder = originalDecoder;
    else delete globalThis.VideoDecoder;
    if (originalChunk) globalThis.EncodedVideoChunk = originalChunk;
    else delete globalThis.EncodedVideoChunk;
  });
  return {
    cast, world, stream,
    receive: bytes => streamOptions.onData(bytes),
    transportClose: error => streamOptions.onClose(error),
    options: () => streamOptions,
    config: value => streamOptions.onData(control({type: 'config', ...value})),
    frame: (seq, value) => streamOptions.onData(framePacket(seq, value)),
    acks: () => world.sent.filter(bytes => bytes[0] === 4).map(bytes => new DataView(bytes.buffer).getBigUint64(5)),
  };
}

test('supported checks both WebCodecs entry points', t => {
  const originalDecoder = globalThis.VideoDecoder;
  const originalChunk = globalThis.EncodedVideoChunk;
  t.after(() => {
    if (originalDecoder) globalThis.VideoDecoder = originalDecoder;
    else delete globalThis.VideoDecoder;
    if (originalChunk) globalThis.EncodedVideoChunk = originalChunk;
    else delete globalThis.EncodedVideoChunk;
  });
  globalThis.VideoDecoder = class {};
  globalThis.EncodedVideoChunk = class {};
  assert.equal(CuaCast.supported(), true);
  delete globalThis.VideoDecoder;
  assert.equal(CuaCast.supported(), false);
});

test('ready waits for cua_cast view stream', async t => {
  let release;
  const ready = new Promise(resolve => {release = resolve;});
  const f = fixture(t, {ready});
  let completed = false;
  const pending = f.cast.ready().then(value => {completed = true; return value;});
  await tick();
  assert.equal(completed, false);
  release();
  assert.equal(await pending, f.cast);
  assert.equal(f.options().command, 'cua_cast');
  assert.equal(f.options().name, 'view');
});

test('incremental unpack handles split and coalesced FRAME and CONTROL packets', t => {
  const f = fixture(t);
  const first = framePacket(1, {idr: true, au: concat(SPS, IDR)});
  f.receive(first.slice(0, 6));
  f.receive(first.slice(6));
  f.receive(concat(control({type: 'config', width: 1280, source_width: 1920}), new Uint8Array(0)));
  assert.equal(f.world.chunks.length, 1);
  assert.equal(f.cast.config.width, 1280);
  assert.equal(f.cast.config.source_width, 1920);
});

test('waits for IDR initially and extracts avc1 codec from Annex B SPS', t => {
  const f = fixture(t);
  f.frame(1, {au: DELTA});
  assert.equal(f.world.decoders.length, 0);
  assert.deepEqual(f.acks(), [1n]);
  f.frame(2, {idr: true, width: 640, height: 360, pts: 12, au: concat(SPS, IDR)});
  assert.equal(f.world.chunks.length, 1);
  assert.deepEqual(f.world.decoders[0].config, {
    codec: 'avc1.42c01f', codedWidth: 640, codedHeight: 360, optimizeForLatency: true,
    hardwareAcceleration: 'prefer-hardware',
  });
  assert.equal(f.world.decoders[0].config.description, undefined);
  assert.equal(f.world.chunks[0].type, 'key');
  assert.equal(f.world.chunks[0].timestamp, 12000);
  assert.equal(codecFromAnnexB(concat(SPS, IDR)), 'avc1.42c01f');
});

test('decoded output draws synchronously, closes VideoFrame and ACKs without an output queue', t => {
  const f = fixture(t);
  f.config({codec: 'avc1.4d401f', width: 1280, height: 720, source_width: 1920, source_height: 1080});
  f.frame(9, {idr: true, width: 1280, height: 720, pts: 33});
  const videoFrame = f.world.decoders[0].output(33000);
  assert.equal(f.world.frames.length, 1);
  const value = f.world.frames[0];
  assert.equal(value.videoFrame, videoFrame);
  assert.equal(value.seq, 9n);
  assert.equal(value.width, 1280);
  assert.equal(value.height, 720);
  assert.equal(value.sourceWidth, 1920);
  assert.equal(value.sourceHeight, 1080);
  assert.equal(value.codec, 'avc1.4d401f');
  assert.equal(videoFrame.closed, 1);
  assert.deepEqual(f.acks(), [9n]);
  assert.equal(f.cast.outputQueue, undefined);
});

test('sequence jump on delta preserves in-flight output and recovers on the next IDR', t => {
  const f = fixture(t);
  f.frame(1, {idr: true, au: concat(SPS, IDR)});
  const first = f.world.decoders[0];
  f.frame(3, {au: DELTA});
  assert.equal(first.closed, false);
  assert.equal(f.world.chunks.length, 1);
  assert.deepEqual(f.acks(), [3n]);
  f.frame(4, {au: DELTA});
  assert.equal(f.world.chunks.length, 1);
  f.frame(5, {idr: true, au: concat(SPS, IDR)});
  assert.equal(f.world.chunks.length, 2);
  assert.equal(f.world.chunks[1].type, 'key');
});

test('decode exception reports, ACKs and recovers on a later IDR without closing stream', t => {
  const f = fixture(t);
  f.world.decodeError = new Error('bad annex b');
  f.frame(1, {idr: true, au: concat(SPS, IDR)});
  assert.equal(f.world.errors.length, 1);
  assert.match(f.world.errors[0].message, /bad annex b/);
  assert.deepEqual(f.acks(), [1n]);
  assert.equal(f.world.streamClosed, undefined);
  f.frame(2, {au: DELTA});
  assert.equal(f.world.chunks.length, 1);
  f.frame(3, {idr: true, au: concat(SPS, IDR)});
  assert.equal(f.world.chunks.length, 2);
  assert.equal(f.world.decoders.length, 2);
});

test('drawing failure closes output, ACKs, resets and does not tear down transport', t => {
  const f = fixture(t, {frame: () => {throw new Error('canvas failed');}});
  f.frame(1, {idr: true, au: concat(SPS, IDR)});
  const decoder = f.world.decoders[0];
  const videoFrame = decoder.output(1000000);
  assert.equal(videoFrame.closed, 1);
  assert.deepEqual(f.acks(), [1n]);
  assert.equal(decoder.closed, true);
  assert.match(f.world.errors[0].message, /canvas failed/);
  assert.equal(f.world.streamClosed, undefined);
});

test('decoder error callback ACKs queued output and waits for IDR', t => {
  const f = fixture(t);
  f.frame(1, {idr: true, au: concat(SPS, IDR)});
  const decoder = f.world.decoders[0];
  decoder.callbacks.error(new Error('decoder died'));
  assert.deepEqual(f.acks(), [1n]);
  assert.equal(decoder.closed, true);
  f.frame(2, {au: DELTA});
  assert.equal(f.world.chunks.length, 1);
  assert.deepEqual(f.acks(), [1n, 2n]);
});

test('late output from a reset decoder cannot consume a new generation frame', async t => {
  const f = fixture(t);
  f.frame(1, {idr: true, au: concat(SPS, IDR)});
  const oldDecoder = f.world.decoders[0];
  oldDecoder.callbacks.error(new Error('reset'));
  f.frame(2, {idr: true, au: concat(SPS, IDR)});
  const stale = oldDecoder.output(1000000);
  assert.equal(stale.closed, 1);
  assert.equal(f.cast.pendingOutputs.size, 1);
  const current = f.world.decoders[1].output(1000000);
  await tick();
  assert.equal(current.closed, 1);
  assert.equal(f.world.frames.length, 1);
  assert.equal(f.world.frames[0].seq, 2n);
});

test('decode queue backpressure drops until a fresh IDR without killing in-flight output', t => {
  const f = fixture(t);
  f.frame(1, {idr: true, au: concat(SPS, IDR)});
  const decoder = f.world.decoders[0];
  decoder.decodeQueueSize = MAX_DECODE_QUEUE + 1;
  f.frame(2, {au: DELTA});
  assert.equal(decoder.closed, false);
  assert.equal(f.world.chunks.length, 1);
  assert.deepEqual(f.acks(), [2n]);
  decoder.decodeQueueSize = 0;
  f.frame(3, {idr: true, au: concat(SPS, IDR)});
  assert.equal(f.world.chunks.length, 2);
});

test('IDR discards a genuinely stuck decode queue at the GOP boundary', t => {
  const f = fixture(t);
  f.frame(1, {idr: true, au: concat(SPS, IDR)});
  const decoder = f.world.decoders[0];
  decoder.decodeQueueSize = MAX_DECODE_QUEUE + 1;
  f.frame(2, {au: DELTA});
  assert.equal(decoder.closed, false, 'a delta drop preserves normal in-flight output');
  f.frame(3, {idr: true, au: concat(SPS, IDR)});
  assert.equal(decoder.closed, true, 'the IDR boundary discards the stuck input queue');
  assert.equal(f.world.decoders.length, 2);
  assert.equal(f.world.chunks.length, 2);
  assert.deepEqual(f.acks(), [2n, 1n]);
});

test('ACK watchdog confirms an output that never arrives and close clears its timer', t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const f = fixture(t);
  f.frame(7, {idr: true, au: concat(SPS, IDR)});
  t.mock.timers.tick(ACK_WATCHDOG_MS - 1);
  assert.deepEqual(f.acks(), []);
  t.mock.timers.tick(1);
  assert.deepEqual(f.acks(), [7n]);
  f.cast.close();
  assert.equal(f.cast.pendingAcks.size, 0);
  assert.equal(f.world.decoders[0].closed, true);
  assert.equal(f.world.streamClosed, 1);
  f.cast.close();
  assert.equal(f.world.streamClosed, 1);
  t.mock.timers.tick(ACK_WATCHDOG_MS * 2);
  assert.deepEqual(f.acks(), [7n]);
});

test('watchdog also confirms dropped frames and timers do not survive close', t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const f = fixture(t);
  f.frame(4, {au: DELTA});
  assert.deepEqual(f.acks(), [4n]);
  f.frame(5, {idr: true, au: concat(SPS, IDR)});
  f.cast.close();
  t.mock.timers.tick(ACK_WATCHDOG_MS * 2);
  assert.deepEqual(f.acks(), [4n]);
});

test('close during a draw releases the frame exactly once', t => {
  const f = fixture(t, {frame: () => f.cast.close()});
  f.frame(1, {idr: true, au: concat(SPS, IDR)});
  const videoFrame = f.world.decoders[0].output(1000000);
  assert.equal(videoFrame.closed, 1);
  assert.deepEqual(f.acks(), []);
});

test('CONTROL session error is distinct from transport close', t => {
  const f = fixture(t);
  f.receive(control({type: 'error', scope: 'session', error: 'capture stopped'}));
  assert.equal(f.world.errors.length, 1);
  assert.match(f.world.errors[0].message, /capture stopped/);
  assert.equal(f.world.closed.length, 0);
  const reason = new Error('rtc closed');
  f.transportClose(reason);
  assert.deepEqual(f.world.closed, [reason]);
  assert.equal(f.world.errors.length, 1);
  assert.equal(f.world.streamClosed, 1);
  f.transportClose(new Error('duplicate'));
  assert.equal(f.world.closed.length, 1);
});

test('unsupported decoder configuration is a session failure, not an endless IDR retry', t => {
  const f = fixture(t);
  f.world.configureError = new Error('unsupported avc profile');
  f.frame(1, {idr: true, au: concat(SPS, IDR)});
  assert.equal(f.world.errors.length, 1);
  assert.equal(f.world.errors[0].code, 'cua_cast_session');
  assert.match(f.world.errors[0].message, /unsupported avc profile/);
  assert.deepEqual(f.acks(), [1n]);
});

test('startup flush exposes a decoder that returns no frame', async t => {
  const f = fixture(t);
  f.cast.startupFlush = true;
  f.frame(1, {idr: true, au: concat(SPS, IDR)});
  await tick();
  assert.equal(f.world.flushes, 1);
  assert.equal(f.world.errors.length, 1);
  assert.equal(f.world.errors[0].code, 'cua_cast_session');
  assert.match(f.world.errors[0].message, /without a decoded frame/);
});
