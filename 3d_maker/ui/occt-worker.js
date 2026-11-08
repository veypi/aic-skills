/**
 * ============================================================================
 * occt-worker.js —— OCCT 内核专用 Worker（3D Maker）
 * ============================================================================
 *
 * 存在理由：opencascade.js 全量构建每次实例化都要在主线程跑 ~1.8s 的
 * embind 注册 + OCCT 静态构造（实测，IndexedDB 缓存只能省下载与编译），
 * 建模计算（布尔/网格化/分析）也是 CPU 密集。全部搬进本 Worker 后，
 * 主线程（页面 UI / 渲染 / 交互）全程零冻结。
 *
 * 协议（postMessage）：
 *   → {type:'init'}                                       加载内核（glue+wasm+实例化）
 *   ← {type:'progress', pct, text}                        init 进度（可能多条）
 *   ← {type:'ready'} | {type:'initError', message}
 *   → {type:'run', id, code, timeout, maxTriangles}       执行建模代码（run-core 管线）
 *   ← {type:'result', id, outcome:{result, partsMesh|null}}
 *       partsMesh: [{name, color, positions, indices}] —— typed arrays 经 transferable
 *       零复制回主线程；result 为 run-core 产物（纯 JSON，含 stats/steps/printability）。
 *   失败（用户代码错/内核错）也以 result 回传（success:false，makeErrorResult 语义），
 *   仅壳级异常（init 失败/worker 崩溃）走 initError / onerror。
 *
 * 中断/超时：OCCT 调用不可协作中断，由主线程 client 看门狗 terminate 本 worker 并重建
 * （mesh 级长循环仍受 kernelCtrl.deadline 约束，能按 TIMEOUT 语义正常返回）。
 * ============================================================================
 */

import { runCodeAndAnalyze, makeErrorResult } from './run-core.js';
import OCCT from './occt-kernel.js';

let api = null;

function post(msg, transfers) {
  self.postMessage(msg, transfers || []);
}

async function init() {
  api = await OCCT.createOCCTKernel(null, (pct, text) => post({ type: 'progress', pct, text }));
  post({ type: 'ready' });
}

function run(msg) {
  const t0 = performance.now();
  try {
    const { result, parts } = runCodeAndAnalyze(msg.code, api, {
      timeout: msg.timeout || 0,
      maxTriangles: msg.maxTriangles,
    });
    const partsMesh = parts.map((p) => ({
      name: p.name,
      color: p.color || null,
      positions: p.shape.positions,
      indices: p.shape.indices,
    }));
    const transfers = [];
    for (const m of partsMesh) {
      transfers.push(m.positions.buffer, m.indices.buffer);
    }
    // 注意：transfer 后 worker 侧 mesh buffer 已 detach，parts 不再可用——
    // result/stats/steps 均已在上方计算完毕，parts 生命周期随本次 run 结束。
    post({ type: 'result', id: msg.id, outcome: { result, partsMesh } }, transfers);
  } catch (err) {
    post({
      type: 'result',
      id: msg.id,
      outcome: { result: makeErrorResult(err, performance.now() - t0), partsMesh: null },
    });
  }
}

self.onmessage = (e) => {
  const m = e.data || {};
  if (m.type === 'init') {
    init().catch((err) => post({ type: 'initError', message: String((err && err.message) || err) }));
  } else if (m.type === 'run') {
    run(m);
  }
};
