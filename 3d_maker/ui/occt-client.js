/**
 * ============================================================================
 * occt-client.js —— OCCT Worker 主线程门面（viewer 的 kernel 对象）
 * ============================================================================
 *
 * 用法（index.html）：
 *   import { createOCCTClient } from './occt-client.js';
 *   const kernel = await createOCCTClient((pct, text) => { ...进度条... });
 *   await viewer.setKernel(kernel, { name: 'occt' });
 *
 * viewer 侧契约（viewer.js run/abort 识别 `worker:true` 标记）：
 *   - run(code, {timeout, maxTriangles}) → Promise<{result, partsMesh|null}>
 *       恒 resolve（用户代码错/超时/中断都收敛为 success:false 的 result）；
 *       仅传输级异常才 reject（viewer catch 兜底为 RUNTIME_ERROR）。
 *   - abort()                              终止当前 run（worker terminate + 后台重建）
 *   - dispose()                            页面销毁时终止 worker
 *
 * 中断/超时语义：OCCT 调用不可协作中断 → 看门狗 terminate + 重建（~2s 后台进行，
 * 期间 kernelLoading 进度条重新出现；下一个 run 自动等待新 worker 就绪）。
 * ============================================================================
 */

export class OCCTClient {
  constructor(onProgress) {
    this.worker = true; // viewer 识别标记
    this._onProgress = onProgress || null;
    this._w = null;
    this._ready = null;
    this._pending = null; // { id, resolve, timer }
    this._seq = 0;
  }

  /** 启动 worker 并等待内核就绪；失败 reject（调用方回退内置内核） */
  _start() {
    this._ready = new Promise((resolve, reject) => {
      this._readyResolve = resolve;
      this._readyReject = reject;
    });
    this._ready.catch(() => {}); // 重建无人 await 时不报 unhandled rejection
    const w = new Worker(new URL('./occt-worker.js', import.meta.url), { type: 'module' });
    this._w = w;
    w.onmessage = (e) => this._onMsg(e.data || {});
    w.onerror = (e) => this._onFatal(new Error('worker 错误: ' + ((e && e.message) || 'unknown')));
    w.postMessage({ type: 'init' });
    return this._ready;
  }

  _onMsg(m) {
    if (m.type === 'progress') {
      this._onProgress?.(m.pct, m.text);
    } else if (m.type === 'ready') {
      this._readyResolve?.();
    } else if (m.type === 'initError') {
      this._readyReject?.(new Error(m.message || 'OCCT worker 初始化失败'));
    } else if (m.type === 'result' && this._pending && this._pending.id === m.id) {
      const p = this._pending;
      this._pending = null;
      clearTimeout(p.timer);
      p.resolve(m.outcome);
    }
  }

  /** worker 崩溃/异常：当前 run 以错误结果收尾，后台重建 worker */
  _onFatal(err) {
    if (this._pending) {
      const p = this._pending;
      this._pending = null;
      clearTimeout(p.timer);
      p.resolve({
        result: {
          success: false, errorType: 'WORKER_ERROR',
          message: err.message, recoverable: true,
        },
        partsMesh: null,
      });
    }
    this._respawn();
  }

  /** 在 worker 内执行建模代码（run-core 管线），主线程只收 result + mesh 数据 */
  async run(code, opts = {}) {
    await this._ready;
    if (!this._w) throw new Error('OCCT worker 不可用');
    const id = ++this._seq;
    return new Promise((resolve) => {
      let timer = 0;
      if (opts.timeout) {
        // 看门狗：worker 内 mesh 级长循环按 deadline 自行抛 TIMEOUT（正常结果回来）；
        // 纯 OCCT 调用无协作中断，留 5s 余量后强制终止重建。
        timer = setTimeout(() => {
          this._pending = null;
          this._respawn();
          resolve({
            result: {
              success: false, errorType: 'RUNTIME_ERROR', code: 'TIMEOUT',
              message: '计算超时', recoverable: true,
              suggestion: '请减小模型精度（如降低圆弧分段数）或简化布尔运算',
            },
            partsMesh: null,
          });
        }, opts.timeout + 5000);
      }
      this._pending = { id, resolve, timer };
      this._w.postMessage({
        type: 'run', id, code,
        timeout: opts.timeout || 0,
        maxTriangles: opts.maxTriangles || 0,
      });
    });
  }

  /** 中断当前计算：terminate + 后台重建（OCCT 不可协作中断，这是唯一真实语义） */
  abort() {
    const p = this._pending;
    if (!p) return;
    this._pending = null;
    clearTimeout(p.timer);
    this._respawn();
    p.resolve({
      result: {
        success: false, errorType: 'RUNTIME_ERROR', code: 'ABORTED',
        message: '计算已被用户中断', recoverable: true,
        suggestion: '点击"运行"重新开始',
      },
      partsMesh: null,
    });
  }

  _respawn() {
    const old = this._w;
    this._w = null;
    try { old && old.terminate(); } catch (_) {}
    this._start().catch((e) => console.warn('[OCCT] worker 重建失败:', (e && e.message) || e));
  }

  dispose() {
    const old = this._w;
    this._w = null;
    try { old && old.terminate(); } catch (_) {}
  }
}

export async function createOCCTClient(onProgress) {
  const client = new OCCTClient(onProgress);
  await client._start();
  return client;
}

export default { createOCCTClient };
