// cua/stream-v1：设备 H264 Annex B 画面的浏览器接收器。
//
// 外层包 [u8 kind][u32 payloadLen BE][u64 seq BE][payload]：
//   kind 1 FRAME   设备→页面，9 字节帧头 + Annex B access unit
//   kind 2 CONTROL 设备→页面，UTF-8 JSON
//   kind 4 ACK     页面→设备，payload 为空，seq 是已消费的帧号
// FRAME payload [u8 flags(bit0 IDR)][u16 codedWidth][u16 codedHeight]
//               [u32 pts_ms][Annex B AU]。

const textDecoder = new TextDecoder();

const KIND_FRAME = 1;
const KIND_CONTROL = 2;
const KIND_ACK = 4;
const HEADER_BYTES = 13;
const FRAME_HEADER_BYTES = 9;
const MAX_PACKET_BYTES = 16 * 1024 * 1024;

export const ACK_WATCHDOG_MS = 1500;
// 远程桌面宁可跳帧，也不能积出几百毫秒的操作延迟。
export const MAX_DECODE_QUEUE = 2;

const asError = error => error instanceof Error ? error : new Error(String(error || 'CUA cast failed'));
const hexByte = value => value.toString(16).padStart(2, '0');

// H264 SPS 的前三个字节是 profile_idc / constraint flags / level_idc。
// WebCodecs 的 avc1.PPCCLL 正好由这三个字节的十六进制组成。
export function codecFromAnnexB(data) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  for (let i = 0; i + 4 < bytes.length;) {
    let start = -1;
    let prefix = 0;
    if (bytes[i] === 0 && bytes[i + 1] === 0 && bytes[i + 2] === 1) {
      start = i + 3;
      prefix = 3;
    } else if (bytes[i] === 0 && bytes[i + 1] === 0 && bytes[i + 2] === 0 && bytes[i + 3] === 1) {
      start = i + 4;
      prefix = 4;
    }
    if (start < 0) { i++; continue; }
    let end = start;
    while (end + 2 < bytes.length
      && !(bytes[end] === 0 && bytes[end + 1] === 0
        && (bytes[end + 2] === 1 || (bytes[end + 2] === 0 && end + 3 < bytes.length && bytes[end + 3] === 1)))) {
      end++;
    }
    if ((bytes[start] & 0x1f) === 7 && start + 3 < end) {
      return `avc1.${hexByte(bytes[start + 1])}${hexByte(bytes[start + 2])}${hexByte(bytes[start + 3])}`;
    }
    i = start + prefix;
    if (end > i) i = end;
  }
  return '';
}

export class CuaCast {
  static supported() {
    return typeof globalThis.VideoDecoder === 'function'
      && typeof globalThis.EncodedVideoChunk === 'function';
  }

  constructor({
    connection,
    frame = () => {},
    closed = () => {},
    error = () => {},
    decoderFactory = callbacks => new globalThis.VideoDecoder(callbacks),
    startupFlush = true,
  }) {
    if (!connection?.openStream) throw new Error('CUA cast requires a connection');
    this.onFrame = frame;
    this.onClosed = closed;
    this.onError = error;
    this.decoderFactory = decoderFactory;
    this.startupFlush = startupFlush;
    this.closed = false;
    this.buffer = new Uint8Array(0);
    this.config = {};
    this.metrics = {received: 0, submitted: 0, decoded: 0, skipped: 0, errors: 0};
    this.decoder = null;
    this.generation = 0;
    this.codec = '';
    this.waitingForIDR = true;
    this.lastSeq = null;
    this.pendingAcks = new Set();
    this.pendingOutputs = new Set();
    this.outputsByTimestamp = new Map();
    this.videoFrames = new Set();
    this.stream = connection.openStream({
      command: 'cua_cast',
      name: 'view',
      onData: bytes => this.receive(bytes),
      onClose: reason => {
        if (this.closed) return;
        this.close();
        this.onClosed(reason);
      },
    });
  }

  async ready() {
    await this.stream.ready;
    return this;
  }

  stats() {
    return {...this.metrics, decodeQueueSize: this.decoder?.decodeQueueSize || 0,
      pendingOutputs: this.pendingOutputs.size};
  }

  packet(kind, seq, payload = new Uint8Array(0)) {
    const out = new Uint8Array(HEADER_BYTES + payload.length);
    const view = new DataView(out.buffer);
    view.setUint8(0, kind);
    view.setUint32(1, payload.length);
    view.setBigUint64(5, BigInt(seq));
    out.set(payload, HEADER_BYTES);
    return out;
  }

  receive(bytes) {
    if (this.closed) return;
    const chunk = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const joined = new Uint8Array(this.buffer.length + chunk.length);
    joined.set(this.buffer);
    joined.set(chunk, this.buffer.length);
    this.buffer = joined;
    while (!this.closed && this.buffer.length >= HEADER_BYTES) {
      const view = new DataView(this.buffer.buffer, this.buffer.byteOffset, HEADER_BYTES);
      const kind = view.getUint8(0);
      const size = view.getUint32(1);
      const seq = view.getBigUint64(5);
      if (size > MAX_PACKET_BYTES) {
        this.report(new Error(`Invalid CUA cast packet size: ${size}`));
        this.buffer = new Uint8Array(0);
        return;
      }
      if (this.buffer.length < HEADER_BYTES + size) return;
      const payload = this.buffer.slice(HEADER_BYTES, HEADER_BYTES + size);
      this.buffer = this.buffer.slice(HEADER_BYTES + size);
      if (kind === KIND_FRAME) this.receiveFrame(seq, payload);
      else if (kind === KIND_CONTROL) this.receiveControl(payload);
    }
  }

  receiveControl(payload) {
    let message;
    try {
      message = JSON.parse(textDecoder.decode(payload));
    } catch (error) {
      this.report(new Error(`Invalid CUA cast control: ${error.message}`));
      return;
    }
    if (message.type === 'config') {
      const value = message.config && typeof message.config === 'object' ? message.config : message;
      const keys = ['codec', 'width', 'height', 'source_width', 'source_height', 'fps'];
      const next = {...this.config};
      for (const key of keys) {
        if (value[key] !== undefined) next[key] = value[key];
      }
      const changed = keys.some(key => next[key] !== this.config[key]);
      this.config = next;
      if (changed) this.resetDecoder();
      return;
    }
    const sessionError = (message.type === 'error' && (!message.scope || message.scope === 'session'))
      || message.type === 'session_error'
      || (message.type === 'session' && message.error);
    if (sessionError) {
      // 只有设备会话失败才让主会话回退截图；单帧解码错误由本类重置并恢复。
      this.report(Object.assign(new Error(message.error || message.message || 'CUA cast session failed'),
        {code: 'cua_cast_session'}));
    }
  }

  receiveFrame(seq, payload) {
    this.metrics.received++;
    const entry = {seq, acked: false, timer: null};
    this.pendingAcks.add(entry);
    entry.timer = setTimeout(() => {
      if (this.pendingOutputs.has(entry)) {
        this.report(new Error('CUA H264 decoder output timed out'));
        this.resetDecoder();
      } else {
        this.finish(entry);
      }
    }, ACK_WATCHDOG_MS);
    if (payload.length < FRAME_HEADER_BYTES) {
      this.report(new Error('Invalid CUA cast frame header'));
      this.resetDecoder();
      this.finish(entry);
      return;
    }
    const view = new DataView(payload.buffer, payload.byteOffset, FRAME_HEADER_BYTES);
    const flags = view.getUint8(0);
    const idr = !!(flags & 1);
    const codedWidth = view.getUint16(1);
    const codedHeight = view.getUint16(3);
    const ptsMs = view.getUint32(5);
    const au = payload.slice(FRAME_HEADER_BYTES);
    const jumped = this.lastSeq !== null && seq !== this.lastSeq + 1n;
    this.lastSeq = seq;
    if (jumped && !idr) {
      // 保留旧 GOP 的在途输出；下一个 IDR 自带完整参考链，无需杀掉解码器。
      this.waitingForIDR = true;
      this.metrics.skipped++;
      this.finish(entry);
      return;
    }
    if (this.waitingForIDR && !idr) { this.metrics.skipped++; this.finish(entry); return; }
    if (this.overloaded()) {
      if (idr) {
        // IDR 不依赖旧 GOP；若旧输入仍积压，在关键帧边界彻底丢掉它。
        this.resetDecoder();
      } else {
        this.metrics.skipped++;
        this.waitingForIDR = true;
        this.finish(entry);
        return;
      }
    }

    const codec = this.config.codec || this.codec || codecFromAnnexB(au);
    if (!codec) {
      this.metrics.skipped++;
      this.report(new Error('CUA cast frame has no H264 codec or SPS'));
      this.resetDecoder();
      this.finish(entry);
      return;
    }
    entry.width = this.config.width || codedWidth;
    entry.height = this.config.height || codedHeight;
    entry.sourceWidth = this.config.source_width || entry.width;
    entry.sourceHeight = this.config.source_height || entry.height;
    entry.codec = codec;
    entry.timestamp = ptsMs * 1000;
    entry.idr = idr;

    let generation;
    try {
      const decoder = this.ensureDecoder(codec, codedWidth, codedHeight);
      generation = this.generation;
      this.pendingOutputs.add(entry);
      this.addOutput(entry);
      decoder.decode(new globalThis.EncodedVideoChunk({
        type: idr ? 'key' : 'delta',
        timestamp: entry.timestamp,
        data: au,
      }));
      this.metrics.submitted++;
      this.waitingForIDR = false;
      if (this.startupFlush && this.metrics.submitted === 1) {
        // 某些 VideoDecoder 实现在流式 decode 后一直压着首帧；显式 flush
        // 既能促成交付，也能把隐藏的格式错误立即暴露出来。
        decoder.flush().then(() => {
          if (this.closed || generation !== this.generation) return;
          if (this.metrics.decoded === 0) {
            this.report(Object.assign(new Error('CUA H264 decoder flush completed without a decoded frame'),
              {code: 'cua_cast_session'}));
          }
        }, error => {
          if (this.closed || generation !== this.generation) return;
          this.report(Object.assign(new Error(error?.message || String(error)),
            {code: 'cua_cast_session', cause: error}));
        });
      }
    } catch (error) {
      if (generation === undefined || generation === this.generation) {
        this.report(error);
        this.resetDecoder();
      }
      this.finish(entry);
    }
  }

  ensureDecoder(codec, codedWidth, codedHeight) {
    if (this.decoder && this.codec === codec) return this.decoder;
    if (this.decoder) this.resetDecoder();
    const generation = ++this.generation;
    const decoder = this.decoderFactory({
      output: videoFrame => this.receiveOutput(videoFrame, generation),
      error: error => {
        if (this.closed || generation !== this.generation) return;
        this.report(error);
        this.resetDecoder();
      },
    });
    this.decoder = decoder;
    this.codec = codec;
    this.waitingForIDR = true;
    try {
      decoder.configure({
        codec,
        codedWidth,
        codedHeight,
        optimizeForLatency: true,
        // 首个 IDR 后的显式 flush 保证首帧交付；硬解已经同一份 Annex B
        // 码流实测（首帧与连续 60 帧均正常），不要错误降级到软解。
        hardwareAcceleration: 'prefer-hardware',
        // Annex B 按长度/起始码自带参数集，不能使用 AVCC description。
      });
    } catch (error) {
      // 解码器根本不支持该 H.264 profile/尺寸，继续等 IDR 也不会恢复。
      throw Object.assign(new Error(error?.message || String(error)), {code: 'cua_cast_session', cause: error});
    }
    return decoder;
  }

  overloaded() {
    // 同步绘制下 pendingOutputs 只是硬解内部在途帧，不是待绘队列。
    return this.decoder && this.decoder.decodeQueueSize > MAX_DECODE_QUEUE;
  }

  addOutput(entry) {
    const list = this.outputsByTimestamp.get(entry.timestamp) || [];
    list.push(entry);
    this.outputsByTimestamp.set(entry.timestamp, list);
  }

  takeOutput(timestamp) {
    const list = this.outputsByTimestamp.get(timestamp);
    if (!list?.length) return null;
    const entry = list.shift();
    if (!list.length) this.outputsByTimestamp.delete(timestamp);
    return entry;
  }

  receiveOutput(videoFrame, generation) {
    this.metrics.decoded++;
    // 旧 decoder 的迟到输出不能按相同 timestamp 抢走新 decoder 的帧。
    if (this.closed || generation !== this.generation) {
      videoFrame.close();
      return;
    }
    const entry = this.takeOutput(videoFrame.timestamp);
    if (!entry || !this.pendingOutputs.has(entry)) {
      videoFrame.close();
      return;
    }
    this.videoFrames.add(videoFrame);
    // Canvas 绘制是同步的：解出一帧就立即显示，绝不用 Promise 把历史帧串行排队。
    try {
      if (!this.closed && generation === this.generation && this.pendingOutputs.has(entry)) {
        this.onFrame({
          videoFrame,
          seq: entry.seq,
          width: entry.width,
          height: entry.height,
          sourceWidth: entry.sourceWidth,
          sourceHeight: entry.sourceHeight,
          codec: entry.codec,
        });
      }
    } catch (error) {
      if (!this.closed && generation === this.generation) {
        this.report(error);
        this.resetDecoder();
      }
    } finally {
      this.releaseVideoFrame(videoFrame);
      this.pendingOutputs.delete(entry);
      this.finish(entry);
    }
  }

  releaseVideoFrame(videoFrame) {
    if (!this.videoFrames.delete(videoFrame)) return;
    videoFrame.close();
  }

  resetDecoder() {
    this.generation++;
    this.waitingForIDR = true;
    this.codec = '';
    const decoder = this.decoder;
    this.decoder = null;
    if (decoder) {
      try { decoder.close(); } catch {}
    }
    this.outputsByTimestamp.clear();
    for (const entry of this.pendingOutputs) this.finish(entry);
    this.pendingOutputs.clear();
  }

  finish(entry) {
    if (entry.acked) return;
    entry.acked = true;
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = null;
    this.pendingAcks.delete(entry);
    this.ack(entry.seq);
  }

  ack(seq) {
    if (this.closed) return;
    this.stream.send(this.packet(KIND_ACK, seq));
  }

  report(error) {
    this.metrics.errors++;
    this.onError(asError(error));
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.buffer = new Uint8Array(0);
    for (const entry of this.pendingAcks) {
      if (entry.timer) clearTimeout(entry.timer);
      entry.timer = null;
      entry.acked = true;
    }
    this.pendingAcks.clear();
    this.resetDecoder();
    for (const videoFrame of this.videoFrames) videoFrame.close();
    this.videoFrames.clear();
    const result = this.stream.close();
    if (result?.catch) result.catch(() => {});
  }
}
