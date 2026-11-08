/**
 * ============================================================================
 * run-core.js —— 建模代码执行 + 分析管线（主线程 builtin 路径与 OCCT Worker 共用）
 * ============================================================================
 *
 * 纯逻辑无 DOM：输入代码字符串与内核 API，输出 { result, parts }。
 * 单一实现源 = 双内核/双线程语义一致性的根基；viewer.js（主线程）与
 * occt-worker.js（Worker）都只是本模块的宿主。
 *
 * 输出契约：
 *   成功 { result: {success:true, parts, steps, stats, interference, warnings, executionTime },
 *          parts: [{name, color, shape}] }              —— shape 为内核 Shape（含 positions/indices）
 *   失败 throw（调用方用 makeErrorResult 收敛成 result 对象）
 * ============================================================================
 */

import {
  GeomError, KERNEL_API, kernelCtrl,
  detectInterference, analyzePrintability,
  traceApi, buildSteps, _traceStart, _traceStop,
  fmtInt,
} from './kernel.js';
import { bindReliefApi } from './relief.js';

/** 归一化用户返回值 → parts 数组（{name, shape, color}） */
export function normalizeResult(raw) {
  const isShape = (obj) => obj && typeof obj.volume === 'function';
  const asPart = (item, i) => {
    if (isShape(item)) return { name: `部件 ${i + 1}`, shape: item, color: null };
    if (item && isShape(item.shape)) {
      return { name: item.name || `部件 ${i + 1}`, shape: item.shape, color: item.color || null };
    }
    throw new GeomError(
      `第 ${i + 1} 个返回值不是几何体（得到 ${typeof item}）`,
      { code: 'INVALID_RETURN', recoverable: true, suggestion: '代码需要 return box(...) 之类的几何体，或几何体数组' },
    );
  };
  if (isShape(raw)) return [asPart(raw, 0)];
  if (Array.isArray(raw)) {
    if (!raw.length) throw new GeomError('返回了空数组', { code: 'EMPTY_RETURN', recoverable: true });
    return raw.map(asPart);
  }
  throw new GeomError(
    `代码没有返回几何体（得到 ${raw === undefined ? 'undefined' : typeof raw}）`,
    { code: 'NO_RETURN', recoverable: true, suggestion: '请在代码末尾加上 return <几何体>' },
  );
}

/** 统一错误 → result 对象（success:false）；Worker 侧序列化后由 client 原样回传 */
export function makeErrorResult(err, elapsed) {
  let line = null, column = null;
  const m = String(err.stack || '').match(/(?:<anonymous>|Function):(\d+):(\d+)/);
  if (m) {
    // V8 中 new Function 的函数头占 2 行 + 注入的 "use strict" 占 1 行
    line = Math.max(1, parseInt(m[1], 10) - 3);
    column = parseInt(m[2], 10);
  }
  if (err instanceof GeomError) {
    return {
      success: false, errorType: err.errorType, code: err.code,
      message: err.message, line, column,
      recoverable: err.recoverable, suggestion: err.suggestion,
      executionTime: Math.round(elapsed),
    };
  }
  if (err instanceof SyntaxError) {
    return {
      success: false, errorType: 'PARSE_ERROR',
      message: err.message, line, column,
      suggestion: line ? `请检查第 ${line} 行附近的语法（括号、逗号是否配对）` : '请检查代码语法',
      executionTime: Math.round(elapsed),
    };
  }
  return {
    success: false, errorType: 'RUNTIME_ERROR',
    message: err.message || String(err), line, column,
    recoverable: true,
    suggestion: line ? `错误发生在第 ${line} 行附近` : '',
    executionTime: Math.round(elapsed),
  };
}

/**
 * 执行建模代码并完成全部分析（设计步骤树 / 统计 / 干涉检测 / 打印就绪检测）。
 * @param {string} code 用户建模代码（末尾 return 几何体或其数组）
 * @param {object|null} base 内核 API（null = 内置内核 KERNEL_API；OCCT 内核对象在 Worker 侧传入）
 * @param {object} opts { timeout?: ms（0/缺省=不限）, maxTriangles?: 上限告警阈值 }
 * @returns {{result: object, parts: Array<{name: string, color: string|null, shape: object}>}}
 */
export function runCodeAndAnalyze(code, base, opts = {}) {
  const maxTriangles = opts.maxTriangles ?? 1_000_000;
  const t0 = performance.now();
  kernelCtrl.aborted = false;
  kernelCtrl.deadline = opts.timeout ? Date.now() + opts.timeout : 0;
  try {
    const baseApi = base || KERNEL_API;
    const api = Object.assign({}, baseApi, bindReliefApi(baseApi));
    const traced = traceApi(api);
    const names = Object.keys(traced);
    const values = Object.values(traced);
    // eslint-disable-next-line no-new-func
    const fn = new Function(...names, 'kernel', `"use strict";\n${code}`);
    _traceStart(code);
    let raw;
    try {
      raw = fn(...values, traced);
    } finally {
      _traceStop();
    }

    const parts = normalizeResult(raw);
    // 设计步骤树（执行追踪回放，按返回部件分组）
    let stepTree = null;
    try {
      stepTree = buildSteps(parts);
    } catch (e) {
      console.warn('[run-core] 步骤树构建异常:', (e && e.message) || e);
    }
    const warnings = [];
    for (const p of parts) {
      if (p.shape._warning) warnings.push(p.shape._warning);
    }

    // 统计
    let volume = 0, area = 0, verts = 0, tris = 0, edges = 0;
    const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
    for (const p of parts) {
      volume += p.shape.volume();
      area += p.shape.area();
      verts += p.shape.vertexCount;
      tris += p.shape.triangleCount;
      edges += p.shape.edgeCount();
      const b = p.shape.bounds();
      for (let k = 0; k < 3; k++) {
        bounds.min[k] = Math.min(bounds.min[k], b.min[k]);
        bounds.max[k] = Math.max(bounds.max[k], b.max[k]);
      }
    }
    if (tris > maxTriangles) {
      warnings.push(`三角面数 ${fmtInt(tris)} 超过上限 ${fmtInt(maxTriangles)}，建议降低圆弧分段数`);
    }

    const executionTime = Math.round(performance.now() - t0);

    // 构建每个部件的摘要（去掉 positions/indices 坐标数据，AI 不需要）
    const partsSummary = parts.map((p) => {
      const pb = p.shape.bounds();
      const pVol = p.shape.volume();
      const pArea = p.shape.area();
      const pSize = pb.max.map((v, i) => v - pb.min[i]);
      return {
        name: p.name,
        color: p.color,
        volume: pVol,
        area: pArea,
        vertices: p.shape.vertexCount,
        triangles: p.shape.triangleCount,
        edges: p.shape.edgeCount(),
        boundingBox: { min: pb.min, max: pb.max, size: pSize },
        isSolid: p.shape.volume() > 0.001,
      };
    });
    // 每个部件附设计步骤文案（供 AI 向用户口述设计思路；上限 30 步防超长）
    if (stepTree) {
      for (const g of stepTree.groups) {
        if (partsSummary[g.partIndex]) {
          partsSummary[g.partIndex].steps = g.steps.slice(0, 30).map((s) => s.text);
        }
      }
    }

    // 复杂度评级：三角面密度
    const meshDensity = volume > 0.001 ? tris / volume : tris;
    let complexity;
    if (tris < 1000) complexity = 'low';
    else if (tris < 10000) complexity = 'medium';
    else if (tris < 50000) complexity = 'high';
    else complexity = 'very_high';

    const bboxSize = bounds.max.map((v, i) => v - bounds.min[i]);

    // 部件位置干涉检测（多部件时）：AABB 粗筛 + 三角形级相交，结果供 AI 判断装配冲突
    let interference = { count: 0, pairs: [], approximate: false };
    if (parts.length > 1) {
      try {
        interference = detectInterference(parts);
      } catch (e) {
        console.warn('[run-core] 干涉检测异常:', (e && e.message) || e);
      }
    }

    // 打印就绪检测（水密/开放边/非流形/悬空面），供 AI 与用户判断可打印性；超大模型跳过
    let printability = null;
    if (tris <= 500_000) {
      try {
        const per = parts.map((p) => analyzePrintability(p.shape));
        printability = {
          watertight: per.every((x) => x.watertight),
          openEdges: per.reduce((s, x) => s + x.openEdges, 0),
          openLoops: per.reduce((s, x) => s + x.openLoops, 0),
          nonManifoldEdges: per.reduce((s, x) => s + x.nonManifoldEdges, 0),
          overhangDeg: per.length ? per[0].overhangDeg : 45,
          overhangArea: per.reduce((s, x) => s + x.overhangArea, 0),
          regions: per.reduce((s, x) => s + x.regions, 0),
          planarFaces: per.reduce((s, x) => s + x.planarFaces, 0),
          featureEdges: per.reduce((s, x) => s + x.featureEdges, 0),
        };
        printability.overhangRatio = printability.overhangArea / (area || 1);
      } catch (e) {
        console.warn('[run-core] 打印检测异常:', (e && e.message) || e);
      }
    } else {
      printability = { skipped: true, reason: `三角面数 ${fmtInt(tris)} 超过 50 万，打印检测跳过` };
    }

    const result = {
      success: true,
      parts: partsSummary,
      steps: stepTree,
      stats: {
        volume,
        area,
        boundingBox: { min: bounds.min, max: bounds.max, size: bboxSize },
        mesh: { vertices: verts, triangles: tris, edges, density: Math.round(meshDensity * 100) / 100, complexity },
        partCount: parts.length,
        interferenceCount: interference.count,
        printability,
      },
      interference,
      warnings,
      executionTime,
    };
    return { result, parts };
  } finally {
    kernelCtrl.deadline = 0;
    kernelCtrl.aborted = false;
  }
}
