/*
 * beats.js — 离线节拍分析（纯函数，无 DOM/网络依赖，node 可单测）。
 * 输入单声道 PCM（Float32Array）+ 采样率，输出：
 *   { bpm, beatOffset, beatPeriod, duration, beats: [t...],
 *     onsets: [{t, strength}], confidence }
 *
 * 方法（shotcraft music-beat-sync 的浏览器简化版）：
 *   10ms RMS 包络 → 半波整流能量流（onset flux）→ 自相关求 BPM（60–180）
 *   → 网格相位拟合 → 拍点网格；onsets 为 flux 自适应阈值峰值（真实瞬态，
 *   稀疏重音钉这些点而非网格插值点）。
 * 注意：能量流对强鼓点电子乐可靠；弱节奏/自由速度曲目 confidence 会低，
 * confidence < 0.3 时建议人工核对 beats 首尾再分镜。
 */

const HOP_SEC = 0.01;

/** RMS 包络 + onset flux */
function onsetEnvelope(samples, sampleRate) {
  const hop = Math.max(1, Math.round(sampleRate * HOP_SEC));
  const win = hop * 2;
  const n = Math.max(0, Math.floor((samples.length - win) / hop) + 1);
  const env = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const off = i * hop;
    let sum = 0;
    for (let j = 0; j < win; j++) {
      const v = samples[off + j] || 0;
      sum += v * v;
    }
    env[i] = Math.sqrt(sum / win);
  }
  const flux = new Float32Array(n);
  for (let i = 1; i < n; i++) flux[i] = Math.max(0, env[i] - env[i - 1]);
  // 轻平滑（3 点）抑制采样噪声
  const sm = new Float32Array(n);
  for (let i = 1; i < n - 1; i++) sm[i] = (flux[i - 1] + flux[i] * 2 + flux[i + 1]) / 4;
  return sm;
}

/** 自相关求最优拍周期（秒）：60–180 BPM，抛物线插值细化 */
function bestPeriod(flux) {
  const minLag = Math.round(60 / 180 / HOP_SEC); // 33
  const maxLag = Math.round(60 / 60 / HOP_SEC);  // 100
  const n = flux.length;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += flux[i];
  mean /= n || 1;
  const f = new Float32Array(n);
  let energy = 0;
  for (let i = 0; i < n; i++) { f[i] = flux[i] - mean; energy += f[i] * f[i]; }
  if (energy <= 1e-12) return { period: 0.5, confidence: 0 };
  const score = (lag) => {
    if (lag < 1 || lag >= n) return 0;
    let s = 0;
    for (let i = 0; i + lag < n; i++) s += f[i] * f[i + lag];
    return s / (n - lag);
  };
  let best = minLag, bestS = -Infinity;
  const scores = [];
  for (let lag = minLag; lag <= maxLag; lag++) {
    // 倍频/半频歧义：强鼓点曲的 accent 周期（如 4 拍一重音）会让倍周期相关更强——
    // 用感知速度先验（中心 120 BPM 的高斯窗）压向基拍，而不是叠加倍周期权重
    const bpm = 60 / (lag * HOP_SEC);
    const prior = Math.exp(-Math.pow((bpm - 120) / 55, 2) / 2);
    const s = score(lag) * prior;
    scores[lag] = s;
    if (s > bestS) { bestS = s; best = lag; }
  }
  // 抛物线细化
  const y0 = scores[best - 1] || bestS, y1 = bestS, y2 = scores[best + 1] || bestS;
  const denom = y0 - 2 * y1 + y2;
  const shift = Math.abs(denom) > 1e-12 ? (0.5 * (y0 - y2)) / denom : 0;
  const period = (best + Math.max(-0.5, Math.min(0.5, shift))) * HOP_SEC;
  return { period };
}

/** 网格相位拟合：在 [0, period) 内找 flux 累积最强的偏移；
 *  confidence = 落在拍点网格（±1 hop 容差）上的 flux 占总 flux 的比例——
 *  干净鼓点曲接近 1，自由速度/弱节奏曲低（稀疏脉冲的自相关幅值天然小，
 *  不能用相关幅值当置信度） */
function bestPhase(flux, period) {
  const steps = Math.max(1, Math.round(period / HOP_SEC));
  const n = flux.length;
  let bestOff = 0, bestS = -Infinity;
  for (let s = 0; s < steps; s++) {
    let sum = 0;
    for (let i = s; i < n; i += steps) sum += flux[i];
    if (sum > bestS) { bestS = sum; bestOff = s; }
  }
  let total = 0, onGrid = 0;
  for (let i = 0; i < n; i++) total += flux[i];
  if (total > 1e-12) {
    for (let i = bestOff; i < n; i += steps) {
      onGrid += Math.max(flux[i - 1] || 0, flux[i], flux[i + 1] || 0);
    }
  }
  return { offset: bestOff * HOP_SEC, coverage: Math.max(0, Math.min(1, onGrid / (total || 1))) };
}

/** flux 峰值挑选（自适应阈值 + 最小间隔）→ 真实瞬态清单 */
function pickOnsets(flux, duration) {
  const n = flux.length;
  let max = 0;
  for (let i = 0; i < n; i++) if (flux[i] > max) max = flux[i];
  if (max <= 1e-9) return [];
  const winLen = Math.round(0.4 / HOP_SEC); // 400ms 局部均值
  const minGap = Math.round(0.08 / HOP_SEC);
  const out = [];
  let last = -minGap;
  for (let i = 1; i < n - 1; i++) {
    if (flux[i] < flux[i - 1] || flux[i] < flux[i + 1]) continue;
    let local = 0, cnt = 0;
    for (let j = Math.max(0, i - winLen); j < Math.min(n, i + winLen); j++) { local += flux[j]; cnt++; }
    const th = (local / Math.max(1, cnt)) * 1.6 + max * 0.06;
    if (flux[i] < th) continue;
    if (i - last < minGap) {
      if (out.length && flux[i] > out[out.length - 1].strength * max) {
        out[out.length - 1] = { t: +(i * HOP_SEC).toFixed(3), strength: +(flux[i] / max).toFixed(3) };
        last = i;
      }
      continue;
    }
    out.push({ t: +(i * HOP_SEC).toFixed(3), strength: +(flux[i] / max).toFixed(3) });
    last = i;
  }
  return out.filter((o) => o.t < duration);
}

/**
 * 主入口。samples 建议传单声道（多声道先取均值或左声道）。
 * opts: { bpmMin = 60, bpmMax = 180 }（保留扩展位，当前固定 60–180）
 */
export function analyzeBeats(samples, sampleRate) {
  if (!samples || !samples.length || !sampleRate) {
    return { bpm: 0, beatOffset: 0, beatPeriod: 0, duration: 0, beats: [], onsets: [], confidence: 0 };
  }
  const duration = samples.length / sampleRate;
  const flux = onsetEnvelope(samples, sampleRate);
  const { period } = bestPeriod(flux);
  const { offset, coverage } = bestPhase(flux, period);
  const beats = [];
  for (let t = offset; t < duration; t += period) beats.push(+t.toFixed(3));
  const onsets = pickOnsets(flux, duration);
  return {
    bpm: +(60 / period).toFixed(2),
    beatOffset: +offset.toFixed(3),
    beatPeriod: +period.toFixed(4),
    duration: +duration.toFixed(3),
    beats,
    onsets,
    confidence: +coverage.toFixed(3),
  };
}

export default analyzeBeats;