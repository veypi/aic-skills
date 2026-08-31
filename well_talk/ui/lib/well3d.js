/**
 * well3d.js — 纯 JavaScript 三维井筒可视化引擎（ES Module）
 *
 * 零依赖构建，可直接在 HTML 页面中引用的纯 JavaScript 库，仅依赖 three.js。
 *
 *   <script type="importmap">
 *     { "imports": { "three": "./lib/vendor/three.module.js" } }
 *   </script>
 *   <script type="module">
 *     import { Well3DViewer, DataStore } from './lib/well3d.js'
 *     ...
 *   </script>
 *
 * Features:
 *  - Wellbore trajectories (line + tube)
 *  - Wellbore data: casings, completion tools, shoes, formation markers,
 *    formation column, perforations, depth markers
 *  - Horizons / surfaces from regular grids
 *  - Generic pointer events (click / move / enter / exit)
 *  - Flexible HTML point-feature label system
 *  - HTML well map schematic (SVG)
 *
 * Data model (DataStore keys):
 *  'position-logs'    : Float32Array stride 4 [east, tvdMsl, north, mdMsl, ...]
 *  'wellbore-headers' : WellboreHeader object
 *  'casings'          : CasingItem[] { mdTopMsl, mdBottomMsl, outerDiameter, innerDiameter, type, isShoe, properties }
 *  'completion-tools' : CompletionTool[] { name, mdTopMsl, mdBottomMsl, length, diameterTop, diameterBottom, diameterMax, diameterDrift, category }
 *  'perforations'     : PerforationInterval[] { mdTopMsl, mdBottomMsl, status, density, phase, innerDiameter, outerDiameter }
 *  'formations'       : FormationInterval[] { name, color, level, mdTopMsl, mdBottomMsl, type }
 *  'surface-meta'     : SurfaceMeta { header: {nx, ny, xinc, yinc, xori, yori, rot}, min, max, color, name }
 *  'surface-values'   : Float32Array (row-major, nx * ny, nullValue = NaN or <= -999)
 *
 * Coordinate system:
 *   x = easting offset, y = -tvdMsl (depth goes down, negative y), z = -northing offset
 */

import * as THREE from './vendor/three.module.js';
import { OrbitControls } from './vendor/OrbitControls.js';
import { CurveInterpolator } from './vendor/curve-interpolator.js';

/* ========================================================================== */
/* Math utils                                                                 */
/* ========================================================================== */

export const clamp = (v, min, max) => Math.min(Math.max(v, min), max);
export const lerp = (a, b, t) => a + (b - a) * t;
export const TAU = Math.PI * 2;
export const PI2 = Math.PI / 2;

const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const len3 = (a) => Math.hypot(a[0], a[1], a[2]);
const norm3 = (a) => {
  const l = len3(a);
  return l > 1e-12 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
};
/** Rodrigues' rotation of v around unit axis k by theta radians */
function rotate3(v, k, theta) {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const kxv = cross3(k, v);
  const kdv = dot3(k, v);
  return [
    v[0] * c + kxv[0] * s + k[0] * kdv * (1 - c),
    v[1] * c + kxv[1] * s + k[1] * kdv * (1 - c),
    v[2] * c + kxv[2] * s + k[2] * kdv * (1 - c),
  ];
}

export function titleCase(str) {
  return String(str).replace(/\w\S*/g, (t) => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase());
}

/* ========================================================================== */
/* Curve3D — spline interpolation */
/* ========================================================================== */

export function getSplineCurve(points, closed = false) {
  if (!points || points.length < 2) return null;
  const interpolator = new CurveInterpolator(points, { alpha: 1, tension: 0, closed });

  return {
    getPointAt: (pos) => interpolator.getPointAt(pos),
    getPoints: (nSamples, from = 0, to = 1) => interpolator.getPoints(nSamples, null, from, to),
    getTangentAt: (pos) => interpolator.getTangentAt(pos),
    getNormalAt: (pos) => interpolator.getNormalAt(pos),
    getBoundingBox: (from = 0, to = 1) => {
      const bbox = interpolator.getBoundingBox(from, to);
      return { min: bbox.min, max: bbox.max };
    },
    nearest: (point) => {
      const r = interpolator.getNearestPosition(point);
      return { position: r.u, point: r.point, distance: r.distance };
    },
    get length() {
      return interpolator.length;
    },
    closed,
  };
}

/**
 * Calculate a stable set of (parallel transport) frames for a curve at the
 * specified normalized positions.
 */
export function calculateFrenetFrames(curve, curvePositions) {
  const count = curvePositions.length;
  const frames = new Array(count);
  if (!count) return [];

  curvePositions.forEach((u, i) => {
    frames[i] = {
      curvePosition: u,
      position: curve.getPointAt(u),
      tangent: norm3(curve.getTangentAt(u)),
      normal: [0, 0, 0],
      binormal: [0, 0, 0],
    };
  });

  let normal = [0, 1, 0];
  let min = Math.abs(frames[0].tangent[1]);
  const tx = Math.abs(frames[0].tangent[0]);
  const tz = Math.abs(frames[0].tangent[2]);
  if (tx <= min) {
    min = tx;
    normal = [1, 0, 0];
  }
  if (tz <= min) normal = [0, 0, 1];

  let vec = norm3(cross3(frames[0].tangent, normal));
  frames[0].normal = norm3(cross3(frames[0].tangent, vec));
  frames[0].binormal = norm3(cross3(frames[0].tangent, frames[0].normal));

  for (let i = 1; i < count; i++) {
    vec = cross3(frames[i - 1].tangent, frames[i].tangent);
    frames[i].normal = frames[i - 1].normal.slice();
    if (len3(vec) > 1e-7) {
      vec = norm3(vec);
      const theta = Math.acos(clamp(dot3(frames[i - 1].tangent, frames[i].tangent), -1, 1));
      frames[i].normal = rotate3(frames[i - 1].normal, vec, theta);
    }
    frames[i].binormal = norm3(cross3(frames[i].tangent, frames[i].normal));
  }
  return frames;
}

/**
 * Positions along a curve at a given segment density, optionally simplified by
 * a tangent-deviation threshold.
 */
export function getCurvePositions(curve, from = 0, to = 1, segmentsPerMeter = 0.1, simplificationThreshold = 0) {
  const segments = [];
  const curveLength = curve.length;
  const nSegments = Math.max(1, Math.ceil(segmentsPerMeter * curveLength));
  const stepSize = 1 / nSegments;
  const MIN_SEGMENT_LENGTH = 1 / (curveLength * 100);

  if (simplificationThreshold) simplificationThreshold *= 0.1;

  segments.push(from);
  let guideTangent = simplificationThreshold ? curve.getTangentAt(from) : null;
  const startAt = Math.floor(from * nSegments);
  let lastPosition = from;

  for (let j = startAt; j <= nSegments; j++) {
    const curvePosition = j * stepSize;
    const currentSegmentLength = curvePosition - lastPosition;
    const candidateTangent = simplificationThreshold ? curve.getTangentAt(curvePosition) : null;
    if (
      curvePosition > from &&
      curvePosition < to &&
      (currentSegmentLength >= MIN_SEGMENT_LENGTH ||
        !simplificationThreshold ||
        Math.abs(dot3(guideTangent, candidateTangent)) < 1 - simplificationThreshold)
    ) {
      segments.push(curvePosition);
      guideTangent = candidateTangent;
      lastPosition = curvePosition;
    }
  }
  segments.push(to);
  return segments;
}

/* ========================================================================== */
/* Trajectory                                                                 */
/* ========================================================================== */

/**
 * Creates a Trajectory from a position log (stride 4: east, tvdMsl, north, mdMsl).
 */
export function getTrajectory(id, poslogMsl) {
  if (!poslogMsl || poslogMsl.length < 2 * 4) return null;
  const origEast = poslogMsl[0];
  const origNorth = poslogMsl[2];

  const points = [];
  for (let j = 0; j < poslogMsl.length; j += 4) {
    points.push([
      poslogMsl[j] - origEast,
      -poslogMsl[j + 1],
      origNorth - poslogMsl[j + 2],
    ]);
  }

  const curve = getSplineCurve(points, false);
  if (!curve) return null;

  const top = poslogMsl[3];
  const bottom = poslogMsl[poslogMsl.length - 1];
  const length = bottom - top;

  const getPositionAtDepth = (md, clamped = false) => {
    let pos = (md - top) / length;
    if (clamped) pos = clamp(pos, 0, 1);
    if (pos < 0 || pos > 1) return null;
    return pos;
  };

  return {
    id,
    curve,
    get measuredLength() {
      return length;
    },
    get measuredTop() {
      return top;
    },
    get measuredBottom() {
      return bottom;
    },
    getPositionAtDepth,
    getPointAtDepth: (md, clamped = false) => {
      const pos = getPositionAtDepth(md, clamped);
      return pos !== null ? curve.getPointAt(pos) : null;
    },
  };
}

/* ========================================================================== */
/* Tube geometry with variable radius                                         */
/* ========================================================================== */

function interpolateRadius(u, steps) {
  if (u <= steps[0][0]) return steps[0][1];
  if (u >= steps[steps.length - 1][0]) return steps[steps.length - 1][1];
  for (let i = 0; i < steps.length - 1; i++) {
    const a = steps[i];
    const b = steps[i + 1];
    if (u >= a[0] && u <= b[0]) {
      if (b[0] === a[0]) return b[1];
      return lerp(a[1], b[1], (u - a[0]) / (b[0] - a[0]));
    }
  }
  return steps[steps.length - 1][1];
}

/**
 * Build a tube (as plain arrays) along a Curve3D, optionally with a varying
 * radius described by [position, radius] steps.
 *
 * options:
 *  from, to               normalized curve range (0-1)
 *  radius                 constant radius (used when radiusSteps is omitted)
 *  radiusSteps            [[u, r], ...] radius profile
 *  radialSegments         vertices per ring
 *  segmentsPerMeter       sampling density
 *  simplificationThreshold
 *  startCap, endCap       add end caps
 *  computeLengths         add a `lengths` attribute (normalized curve position)
 */
export function buildTubeGeometry(curve, options = {}) {
  const {
    from = 0,
    to = 1,
    radius = 0.5,
    radiusSteps = null,
    radialSegments = 12,
    segmentsPerMeter = 0.1,
    simplificationThreshold = 0,
    startCap = true,
    endCap = true,
    computeLengths = false,
  } = options;

  let samples = getCurvePositions(curve, from, to, segmentsPerMeter, simplificationThreshold);

  let steps = null;
  if (radiusSteps && radiusSteps.length) {
    steps = radiusSteps
      .map(([u, r]) => [clamp(u, from, to), r])
      .sort((a, b) => a[0] - b[0]);
    // merge step positions into samples
    const set = new Set(samples.map((u) => u.toFixed(7)));
    for (const [u] of steps) {
      const key = u.toFixed(7);
      if (!set.has(key)) {
        samples.push(u);
        set.add(key);
      }
    }
    samples.sort((a, b) => a - b);
  }

  const frames = calculateFrenetFrames(curve, samples);
  const ringSize = radialSegments + 1;

  const vertexCount = frames.length * ringSize + (startCap ? ringSize + 1 : 0) + (endCap ? ringSize + 1 : 0);
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const lengths = computeLengths ? new Float32Array(vertexCount) : null;
  const indices = [];

  const span = Math.max(1e-12, to - from);
  let v = 0;

  frames.forEach((frame, i) => {
    const r = steps ? interpolateRadius(frame.curvePosition, steps) : radius;
    const len = clamp((frame.curvePosition - from) / span, 0, 1);
    for (let j = 0; j <= radialSegments; j++) {
      const theta = (j / radialSegments) * TAU;
      const sin = Math.sin(theta);
      const cos = Math.cos(theta);
      const nx = frame.normal[0] * cos + frame.binormal[0] * sin;
      const ny = frame.normal[1] * cos + frame.binormal[1] * sin;
      const nz = frame.normal[2] * cos + frame.binormal[2] * sin;
      const o = v * 3;
      positions[o] = frame.position[0] + nx * r;
      positions[o + 1] = frame.position[1] + ny * r;
      positions[o + 2] = frame.position[2] + nz * r;
      normals[o] = nx;
      normals[o + 1] = ny;
      normals[o + 2] = nz;
      uvs[v * 2] = j / radialSegments;
      uvs[v * 2 + 1] = len;
      if (lengths) lengths[v] = frame.curvePosition;
      v++;
    }
  });

  for (let i = 0; i < frames.length - 1; i++) {
    for (let j = 0; j < radialSegments; j++) {
      const a = i * ringSize + j;
      const b = (i + 1) * ringSize + j;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }

  // caps as triangle fans
  const addCap = (frame, r, sign) => {
    const centerIndex = v;
    const o = v * 3;
    positions[o] = frame.position[0];
    positions[o + 1] = frame.position[1];
    positions[o + 2] = frame.position[2];
    normals[o] = frame.tangent[0] * sign;
    normals[o + 1] = frame.tangent[1] * sign;
    normals[o + 2] = frame.tangent[2] * sign;
    uvs[v * 2] = 0.5;
    uvs[v * 2 + 1] = 0.5;
    if (lengths) lengths[v] = frame.curvePosition;
    v++;

    const ringStart = v;
    for (let j = 0; j <= radialSegments; j++) {
      const theta = (j / radialSegments) * TAU;
      const sin = Math.sin(theta);
      const cos = Math.cos(theta);
      const nx = frame.normal[0] * cos + frame.binormal[0] * sin;
      const ny = frame.normal[1] * cos + frame.binormal[1] * sin;
      const nz = frame.normal[2] * cos + frame.binormal[2] * sin;
      const o2 = v * 3;
      positions[o2] = frame.position[0] + nx * r;
      positions[o2 + 1] = frame.position[1] + ny * r;
      positions[o2 + 2] = frame.position[2] + nz * r;
      normals[o2] = frame.tangent[0] * sign;
      normals[o2 + 1] = frame.tangent[1] * sign;
      normals[o2 + 2] = frame.tangent[2] * sign;
      uvs[v * 2] = 0.5 + 0.5 * cos;
      uvs[v * 2 + 1] = 0.5 + 0.5 * sin;
      if (lengths) lengths[v] = frame.curvePosition;
      v++;
    }
    for (let j = 0; j < radialSegments; j++) {
      if (sign < 0) indices.push(centerIndex, ringStart + j + 1, ringStart + j);
      else indices.push(centerIndex, ringStart + j, ringStart + j + 1);
    }
  };

  if (startCap) {
    const r = steps ? interpolateRadius(frames[0].curvePosition, steps) : radius;
    addCap(frames[0], r, -1);
  }
  if (endCap) {
    const r = steps ? interpolateRadius(frames[frames.length - 1].curvePosition, steps) : radius;
    addCap(frames[frames.length - 1], r, 1);
  }

  return { positions, normals, uvs, lengths, indices };
}

/** Convert buildTubeGeometry output into a THREE.BufferGeometry */
export function toBufferGeometry(tube) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(tube.positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(tube.normals, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(tube.uvs, 2));
  if (tube.lengths) geometry.setAttribute('lengths', new THREE.BufferAttribute(tube.lengths, 1));
  geometry.setIndex(tube.indices);
  return geometry;
}

/** Merge multiple buildTubeGeometry outputs into one BufferGeometry */
export function mergeTubes(tubes) {
  let vertexCount = 0;
  let indexCount = 0;
  tubes.forEach((t) => {
    vertexCount += t.positions.length / 3;
    indexCount += t.indices.length;
  });
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const lengths = tubes.some((t) => t.lengths) ? new Float32Array(vertexCount) : null;
  const indices = vertexCount > 65535 ? new Uint32Array(indexCount) : new Uint16Array(indexCount);

  let vo = 0;
  let io = 0;
  tubes.forEach((t) => {
    positions.set(t.positions, vo * 3);
    normals.set(t.normals, vo * 3);
    uvs.set(t.uvs, vo * 2);
    if (lengths) {
      if (t.lengths) lengths.set(t.lengths, vo);
      else lengths.fill(0, vo, vo + t.positions.length / 3);
    }
    for (let i = 0; i < t.indices.length; i++) indices[io + i] = t.indices[i] + vo;
    vo += t.positions.length / 3;
    io += t.indices.length;
  });

  return toBufferGeometry({ positions, normals, uvs, lengths, indices: Array.from(indices) });
}

/* ========================================================================== */
/* DataStore — simple in-memory key-value store */
/* ========================================================================== */

export class DataStore {
  constructor() {
    this._data = new Map(); // key -> Map(id -> value)
  }
  set(key, id, value) {
    if (!this._data.has(key)) this._data.set(key, new Map());
    this._data.get(key).set(String(id), value);
    return this;
  }
  get(key, id) {
    const m = this._data.get(key);
    if (!m) return null;
    if (id === undefined) return m; // return whole map
    return m.get(String(id)) ?? null;
  }
  remove(key, id) {
    this._data.get(key)?.delete(String(id));
  }
  ids(key) {
    const m = this._data.get(key);
    return m ? Array.from(m.keys()) : [];
  }
  clear() {
    this._data.clear();
  }
}

/* ========================================================================== */
/* Wellbore data generators                                                   */
/* ========================================================================== */

function trajectoryFromStore(store, id) {
  const poslog = store.get('position-logs', id);
  return getTrajectory(id, poslog);
}

/** Default completion-tool category colors */
export const completionToolCategoryColors = {
  'blank pipe': '#5d646e',
  tube: '#9aa2ad',
  packer: '#d9534f',
  gauge: '#4f8fd9',
  plug: '#e07b39',
  pbr: '#4faf62',
  'safety valve': '#9b59b6',
  spm: '#39b8b2',
  screen: '#d9c84f',
  tracer: '#e06fa8',
  unknown: '#c8ccd2',
};

/**
 * Casings — one tube per casing item. Items flagged `isShoe` get a
 * flared bottom (shoeFactor), others get beveled ends.
 */
export function buildCasings(store, id, options = {}) {
  const { fromMsl, shoeFactor = 2, segmentsPerMeter = 0.1, simplificationThreshold = 0, radialSegments = 16 } = options;

  const data = store.get('casings', id);
  if (!data || !data.length) return null;
  const trajectory = trajectoryFromStore(store, id);
  if (!trajectory) return null;

  const minFrom =
    fromMsl !== undefined
      ? clamp((fromMsl - trajectory.measuredTop) / trajectory.measuredLength, 0, 1)
      : 0;

  const items = data
    .filter((d) => d.mdBottomMsl > trajectory.measuredTop && (fromMsl === undefined || d.mdBottomMsl > fromMsl))
    .map((d) => ({ ...d, mdTopMsl: Math.max(d.mdTopMsl, trajectory.measuredTop) }))
    .sort((a, b) => a.outerDiameter - b.outerDiameter || a.mdTopMsl - b.mdTopMsl);

  if (!items.length) return null;

  const curveLengthFactor = 1 / trajectory.measuredLength;
  const sections = [];

  items.forEach((item) => {
    const itemLength = clamp(item.mdBottomMsl - item.mdTopMsl, 0.0001, trajectory.measuredLength);
    const top = Math.max(minFrom, clamp((item.mdTopMsl - trajectory.measuredTop) / trajectory.measuredLength, 0, 1));
    const bottom = clamp((item.mdBottomMsl - trajectory.measuredTop) / trajectory.measuredLength, 0, 1);
    if (bottom <= top) return;

    const radius = item.outerDiameter / 2;
    const innerRadius = item.innerDiameter ? item.innerDiameter / 2 : radius * 0.95;
    const steps = [];

    if (item.isShoe) {
      steps.push([top, radius], [top + (bottom - top) / 4, radius], [bottom, radius * shoeFactor]);
    } else {
      const radiusMin = radius - (radius - innerRadius) / 4;
      const shift = Math.min((radius - radiusMin) * 2, itemLength / 3) * curveLengthFactor;
      steps.push([top, radiusMin], [top + shift, radius], [bottom - shift, radius], [bottom, radiusMin]);
    }

    const tube = buildTubeGeometry(trajectory.curve, {
      from: top,
      to: bottom,
      radiusSteps: steps,
      radialSegments,
      segmentsPerMeter,
      simplificationThreshold,
      startCap: true,
      endCap: true,
    });

    sections.push({ item, top, bottom, radius, geometry: toBufferGeometry(tube) });
  });

  return sections.length ? { trajectory, sections } : null;
}

/**
 * Completion tools — merged geometry grouped by category.
 */
export function buildCompletionTools(store, id, options = {}) {
  const { fromMsl, radialSegments = 16, sizeMultiplier = 1, segmentsPerMeter = 0.1, simplificationThreshold = 0 } = options;

  const data = store.get('completion-tools', id);
  if (!data || !data.length) return null;
  const trajectory = trajectoryFromStore(store, id);
  if (!trajectory) return null;

  const minFrom =
    fromMsl !== undefined
      ? clamp((fromMsl - trajectory.measuredTop) / trajectory.measuredLength, 0, 1)
      : 0;

  const tools = data
    .filter((d) => d.mdBottomMsl > trajectory.measuredTop && (fromMsl === undefined || d.mdBottomMsl > fromMsl))
    .sort((a, b) => a.mdTopMsl - b.mdTopMsl);

  if (!tools.length) return null;

  const byCategory = new Map();
  tools.forEach((tool) => {
    const cat = tool.category || 'unknown';
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat).push(tool);
  });

  const curveLengthFactor = 1 / trajectory.measuredLength;
  const categories = [];

  byCategory.forEach((categoryTools, category) => {
    const tubes = [];
    const toolData = [];
    categoryTools.forEach((tool) => {
      const toolLength = clamp(tool.length || tool.mdBottomMsl - tool.mdTopMsl, 0.0001, trajectory.measuredLength);
      const top = clamp((tool.mdTopMsl - trajectory.measuredTop) / trajectory.measuredLength, 0, 1);
      const bottom = clamp((tool.mdBottomMsl - trajectory.measuredTop) / trajectory.measuredLength, 0, 1);
      if (bottom <= Math.max(top, minFrom)) return;

      const radiusTop = sizeMultiplier * ((tool.diameterTop || tool.diameterBottom || tool.diameterMax) / 2);
      const radiusBottom = sizeMultiplier * ((tool.diameterBottom || tool.diameterTop || tool.diameterMax) / 2);
      const radiusMax = sizeMultiplier * ((tool.diameterMax || tool.diameterTop) / 2);
      const radiusMin = Math.min(radiusTop, radiusBottom, radiusMax);

      const steps = [[top, radiusTop]];
      const shift = Math.min((radiusMax - radiusMin) * 2, toolLength / 3) * curveLengthFactor;
      if (radiusMax > radiusMin) {
        steps.push([top + shift, radiusMax], [bottom - shift, radiusMax]);
      }
      steps.push([bottom, radiusBottom]);

      tubes.push(
        buildTubeGeometry(trajectory.curve, {
          from: Math.max(top, minFrom),
          to: bottom,
          radiusSteps: steps,
          radialSegments,
          segmentsPerMeter,
          simplificationThreshold,
          startCap: true,
          endCap: true,
        })
      );
      toolData.push(tool);
    });
    if (tubes.length) {
      categories.push({ category, tools: toolData, geometry: mergeTubes(tubes) });
    }
  });

  return categories.length ? { trajectory, categories } : null;
}

/**
 * Shoes — symbols at the bottom of casing items flagged `isShoe`.
 */
export function buildShoes(store, id, options = {}) {
  const { fromMsl } = options;
  const data = store.get('casings', id);
  if (!data || !data.length) return null;
  const trajectory = trajectoryFromStore(store, id);
  if (!trajectory) return null;

  const shoes = data
    .filter((d) => d.isShoe && d.mdBottomMsl > trajectory.measuredTop && (fromMsl === undefined || d.mdBottomMsl > fromMsl))
    .map((d) => {
      const pos = clamp((d.mdBottomMsl - trajectory.measuredTop) / trajectory.measuredLength, 0, 1);
      return {
        name:
          d.properties && (d.properties['Diameter'] || d.properties['Type'])
            ? `${d.properties['Diameter'] ?? ''} ${d.properties['Type'] ?? ''}`.trim()
            : `${d.outerDiameter}" shoe @ ${Math.round(d.mdBottomMsl)}m`,
        data: d.properties || {},
        md: d.mdBottomMsl,
        position: trajectory.curve.getPointAt(pos),
        direction: trajectory.curve.getTangentAt(pos),
        radius: d.outerDiameter / 2,
      };
    });

  return shoes.length ? { trajectory, shoes } : null;
}

/**
 * Formation markers (tops) for a wellbore.
 * formations: [{ name, color, level, mdTopMsl, mdBottomMsl, type }]
 */
export function buildFormationMarkers(store, id, options = {}) {
  const { fromMsl, baseRadius = 10 } = options;
  const data = store.get('formations', id);
  if (!data || !data.length) return null;
  const trajectory = trajectoryFromStore(store, id);
  if (!trajectory) return null;

  const markers = data
    .filter((d) => d.mdTopMsl > trajectory.measuredTop && (fromMsl === undefined || d.mdTopMsl > fromMsl))
    .sort((a, b) => a.mdTopMsl - b.mdTopMsl)
    .map((d, i) => {
      const pos = clamp((d.mdTopMsl - trajectory.measuredTop) / trajectory.measuredLength, 0, 1);
      return {
        id: `${id}_${i}`,
        name: d.name,
        color: d.color || '#cccccc',
        depth: d.mdTopMsl,
        level: d.level ?? 0,
        type: 'top',
        radius: d.radius ?? baseRadius,
        position: trajectory.curve.getPointAt(pos),
        direction: trajectory.curve.getTangentAt(pos),
        data: d,
      };
    });

  return markers.length ? { trajectory, markers } : null;
}

/**
 * Formation column — tube segments colored per formation interval.
 */
export function buildFormationColumn(store, id, options = {}) {
  const { fromMsl, radius = 0.6, segmentsPerMeter = 0.1, simplificationThreshold = 0, radialSegments = 12 } = options;
  const data = store.get('formations', id);
  if (!data || !data.length) return null;
  const trajectory = trajectoryFromStore(store, id);
  if (!trajectory) return null;

  const intervals = data
    .filter((d) => d.mdBottomMsl > trajectory.measuredTop && (fromMsl === undefined || d.mdBottomMsl > fromMsl))
    .sort((a, b) => a.mdTopMsl - b.mdTopMsl);

  if (!intervals.length) return null;

  const segments = [];
  intervals.forEach((d) => {
    const top = clamp((Math.max(d.mdTopMsl, fromMsl ?? -Infinity) - trajectory.measuredTop) / trajectory.measuredLength, 0, 1);
    const bottom = clamp((d.mdBottomMsl - trajectory.measuredTop) / trajectory.measuredLength, 0, 1);
    if (bottom <= top) return;
    const tube = buildTubeGeometry(trajectory.curve, {
      from: top,
      to: bottom,
      radius: d.radius ?? radius,
      radialSegments,
      segmentsPerMeter,
      simplificationThreshold,
      startCap: true,
      endCap: true,
    });
    segments.push({ interval: d, geometry: toBufferGeometry(tube) });
  });

  return segments.length ? { trajectory, segments } : null;
}

/**
 * Perforations — spikes around the wellbore over open perforation intervals.
 */
export function buildPerforations(store, id, options = {}) {
  const { fromMsl, density = 0.5, directions = 9 } = options;
  const data = store.get('perforations', id);
  if (!data || !data.length) return null;
  const trajectory = trajectoryFromStore(store, id);
  if (!trajectory) return null;

  const filtered = data
    .filter((d) => (d.status === undefined || d.status === 'Open') && d.mdBottomMsl > trajectory.measuredTop && (fromMsl === undefined || d.mdBottomMsl > fromMsl))
    .sort((a, b) => a.mdTopMsl - b.mdTopMsl);

  if (!filtered.length) return null;

  const rotationAngle = TAU / directions;
  const spikes = [];

  filtered.forEach((interval) => {
    const top = clamp((interval.mdTopMsl - trajectory.measuredTop) / trajectory.measuredLength, 0, 1);
    const bottom = clamp((interval.mdBottomMsl - trajectory.measuredTop) / trajectory.measuredLength, 0, 1);
    if (bottom <= top) return;

    const intervalLength = (bottom - top) * trajectory.measuredLength;
    const count = Math.max(1, Math.round(intervalLength * (interval.density ?? density)));
    const phase = ((interval.phase ?? 90) * Math.PI) / 180;
    const baseRadius = (interval.outerDiameter ?? 0.2) / 2;

    const us = [];
    for (let i = 0; i <= count; i++) us.push(top + ((bottom - top) * i) / count);
    const frames = calculateFrenetFrames(trajectory.curve, us);

    frames.forEach((frame, i) => {
      for (let d = 0; d < directions; d++) {
        const angle = phase + d * rotationAngle + i * 0.7;
        const dir = [
          frame.normal[0] * Math.cos(angle) + frame.binormal[0] * Math.sin(angle),
          frame.normal[1] * Math.cos(angle) + frame.binormal[1] * Math.sin(angle),
          frame.normal[2] * Math.cos(angle) + frame.binormal[2] * Math.sin(angle),
        ];
        spikes.push({
          position: [
            frame.position[0] + dir[0] * baseRadius,
            frame.position[1] + dir[1] * baseRadius,
            frame.position[2] + dir[2] * baseRadius,
          ],
          direction: dir,
          interval,
        });
      }
    });
  });

  return spikes.length ? { trajectory, spikes } : null;
}

/**
 * Depth markers — label points at regular MD intervals along a trajectory.
 */
export function buildDepthMarkers(store, id, options = {}) {
  const { interval = 500, depthReferencePoint = 'MSL', fromMsl } = options;
  const poslog = store.get('position-logs', id);
  if (!poslog || poslog.length < 8) return null;
  const trajectory = getTrajectory(id, poslog);
  if (!trajectory) return null;

  let offset = 0;
  if (depthReferencePoint === 'RT') {
    const header = store.get('wellbore-headers', id);
    if (header) offset = header.depthReferenceElevation || 0;
  }

  const lastTick = poslog[poslog.length - 1] + offset;
  const start = Math.max(trajectory.measuredTop, fromMsl !== undefined && Number.isFinite(fromMsl) ? fromMsl : trajectory.measuredTop);
  const firstTick = start + offset;
  const ticks = [firstTick];
  let next = Math.floor(firstTick / interval) * interval;
  if (next <= firstTick) next += interval;
  while (next < lastTick) {
    ticks.push(next);
    next += interval;
  }
  ticks.push(lastTick);

  return ticks.map((tick) => {
    const pos = clamp((tick - offset - trajectory.measuredTop) / trajectory.measuredLength, 0, 1);
    return {
      id: `${id}_${tick}`,
      name: String(Math.round(tick * 10) / 10),
      depth: tick,
      direction: trajectory.curve.getTangentAt(pos),
      position: trajectory.curve.getPointAt(pos),
    };
  });
}

/* ========================================================================== */
/* Surface / horizon                                                          */
/* ========================================================================== */

const isNullValue = (v) => v === undefined || Number.isNaN(v) || v <= -999;

/**
 * Build a triangulated surface mesh geometry from a regular grid of depths.
 * values: Float32Array row-major (ny rows of nx columns), depth msl (positive down).
 * Cells touching null values (NaN / <= -999) are skipped.
 *
 * The geometry is positioned so that (xori, yori) maps to world (0, 0),
 * x = easting offset, y = -depth, z = -northing offset — matching trajectories.
 */
export function buildSurfaceGeometry(meta, values) {
  const { nx, ny, xinc, yinc, xori = 0, yori = 0, rot = 0 } = meta.header;
  const vertexIndex = new Int32Array(nx * ny).fill(-1);
  const positions = [];
  const depths = [];
  const uvs = [];

  for (let iy = 0; iy < ny; iy++) {
    for (let ix = 0; ix < nx; ix++) {
      const v = values[iy * nx + ix];
      if (isNullValue(v)) continue;
      vertexIndex[iy * nx + ix] = positions.length / 3;
      positions.push(ix * xinc, -v, -iy * yinc);
      depths.push(v);
      uvs.push(ix / (nx - 1), 1 - iy / (ny - 1));
    }
  }

  const indices = [];
  for (let iy = 0; iy < ny - 1; iy++) {
    for (let ix = 0; ix < nx - 1; ix++) {
      const a = vertexIndex[iy * nx + ix];
      const b = vertexIndex[iy * nx + ix + 1];
      const c = vertexIndex[(iy + 1) * nx + ix];
      const d = vertexIndex[(iy + 1) * nx + ix + 1];
      // note winding: z = -north, so flip to keep upward normals
      if (a >= 0 && b >= 0 && c >= 0) indices.push(a, b, c);
      if (b >= 0 && d >= 0 && c >= 0) indices.push(b, d, c);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute('depth', new THREE.BufferAttribute(new Float32Array(depths), 1));
  geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  // apply header rotation (about grid center) / origin translation
  if (rot) {
    geometry.translate((-(nx - 1) * xinc) / 2, 0, ((ny - 1) * yinc) / 2);
    geometry.rotateY((rot * Math.PI) / 180);
    geometry.translate(((nx - 1) * xinc) / 2, 0, (-(ny - 1) * yinc) / 2);
  }
  geometry.translate(xori, 0, -yori);

  return geometry;
}

/** Simple depth color ramps */
export const colorRamps = {
  depth: [
    [0.0, [46, 134, 193]],
    [0.5, [241, 196, 83]],
    [1.0, [203, 67, 53]],
  ],
  /** rainbow: red -> yellow -> green -> cyan -> blue (shallow to deep) */
  rainbow: [
    [0.0, [215, 35, 40]],
    [0.18, [245, 130, 20]],
    [0.35, [250, 215, 40]],
    [0.52, [90, 200, 60]],
    [0.68, [0, 180, 140]],
    [0.84, [0, 130, 210]],
    [1.0, [35, 45, 170]],
  ],
  viridis: [
    [0.0, [68, 1, 84]],
    [0.25, [59, 82, 139]],
    [0.5, [33, 145, 140]],
    [0.75, [94, 201, 98]],
    [1.0, [253, 231, 37]],
  ],
  terrain: [
    [0.0, [51, 102, 153]],
    [0.4, [120, 170, 120]],
    [0.7, [210, 190, 130]],
    [1.0, [150, 90, 60]],
  ],
};

export function sampleRamp(ramp, t) {
  t = clamp(t, 0, 1);
  for (let i = 0; i < ramp.length - 1; i++) {
    const [t0, c0] = ramp[i];
    const [t1, c1] = ramp[i + 1];
    if (t >= t0 && t <= t1) {
      const f = (t - t0) / (t1 - t0 || 1);
      return [lerp(c0[0], c1[0], f) / 255, lerp(c0[1], c1[1], f) / 255, lerp(c0[2], c1[2], f) / 255];
    }
  }
  const c = ramp[ramp.length - 1][1];
  return [c[0] / 255, c[1] / 255, c[2] / 255];
}

/**
 * Build contour line segments (marching squares) for a surface grid.
 * Returns a THREE.LineSegments object positioned in world coordinates.
 * options: { interval, color, opacity, offset }
 */
export function buildContourLines(meta, values, options = {}) {
  const { interval = 50, color = '#000000', opacity = 0.35, offset = 0.75 } = options;
  const { nx, ny, xinc, yinc, xori = 0, yori = 0, rot = 0 } = meta.header;

  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (isNullValue(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!Number.isFinite(min)) return null;

  const positions = [];
  const cosR = rot ? Math.cos((rot * Math.PI) / 180) : 1;
  const sinR = rot ? Math.sin((rot * Math.PI) / 180) : 0;
  const cx = ((nx - 1) * xinc) / 2;
  const cz = ((ny - 1) * yinc) / 2;

  const pushPoint = (gx, gy, level) => {
    // grid coords -> world (matching buildSurfaceGeometry)
    let x = gx * xinc;
    let z = -gy * yinc;
    if (rot) {
      const dx = x - cx;
      const dz = z + cz;
      x = cx + dx * cosR + dz * sinR;
      z = -cz - dx * sinR + dz * cosR;
    }
    positions.push(x + xori, -level + offset, z - yori);
  };

  for (let level = Math.ceil(min / interval) * interval; level <= max; level += interval) {
    for (let iy = 0; iy < ny - 1; iy++) {
      for (let ix = 0; ix < nx - 1; ix++) {
        const v00 = values[iy * nx + ix];
        const v10 = values[iy * nx + ix + 1];
        const v01 = values[(iy + 1) * nx + ix];
        const v11 = values[(iy + 1) * nx + ix + 1];
        if (isNullValue(v00) || isNullValue(v10) || isNullValue(v01) || isNullValue(v11)) continue;
        const cmin = Math.min(v00, v10, v01, v11);
        const cmax = Math.max(v00, v10, v01, v11);
        if (level < cmin || level > cmax) continue;

        // edge crossings (grid coords, y down)
        const pts = [];
        const cross = (va, vb, xa, ya, xb, yb) => {
          if ((va < level) === (vb < level)) return;
          const t = (level - va) / (vb - va);
          pts.push([xa + (xb - xa) * t, ya + (yb - ya) * t]);
        };
        cross(v00, v10, ix, iy, ix + 1, iy); // top
        cross(v10, v11, ix + 1, iy, ix + 1, iy + 1); // right
        cross(v01, v11, ix, iy + 1, ix + 1, iy + 1); // bottom
        cross(v00, v01, ix, iy, ix, iy + 1); // left

        if (pts.length === 2) {
          pushPoint(pts[0][0], pts[0][1], level);
          pushPoint(pts[1][0], pts[1][1], level);
        } else if (pts.length === 4) {
          // saddle: pair by center value
          const center = (v00 + v10 + v01 + v11) / 4;
          const pairs = center >= level ? [[0, 1, 2, 3]] : [[0, 3, 1, 2]];
          const [a, b, c, d] = pairs[0];
          pushPoint(pts[a][0], pts[a][1], level);
          pushPoint(pts[b][0], pts[b][1], level);
          pushPoint(pts[c][0], pts[c][1], level);
          pushPoint(pts[d][0], pts[d][1], level);
        }
      }
    }
  }

  if (!positions.length) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  const lines = new THREE.LineSegments(
    geometry,
    new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false })
  );
  lines.name = 'surface-contours';
  lines.userData = { type: 'surface-contours', interval };
  return lines;
}

/* ========================================================================== */
/* Component factories — turn generator output into THREE.Object3D            */
/* ========================================================================== */

function applyEvents(viewer, object, handlers) {
  if (viewer && handlers && (handlers.onClick || handlers.onPointerMove || handlers.onPointerEnter || handlers.onPointerExit)) {
    viewer.events.add(object, handlers);
  }
}

/** Wellbore trajectory — line (radius 0) or tube */
export function createTrajectoryComponent(viewer, id, options = {}) {
  const {
    color = '#e8c25a',
    radius = 0,
    radialSegments = 12,
    segmentsPerMeter = 0.2,
    simplificationThreshold = 0.0001,
    fromMsl,
    opacity = 1,
    name,
    events,
  } = options;

  const trajectory = trajectoryFromStore(viewer.store, id);
  if (!trajectory) return null;

  const from =
    fromMsl !== undefined
      ? clamp((fromMsl - trajectory.measuredTop) / trajectory.measuredLength, 0, 1)
      : 0;

  const group = new THREE.Group();
  group.name = name || `trajectory-${id}`;
  group.userData = { type: 'trajectory', wellboreId: id, trajectory };

  if (radius > 0) {
    const tube = buildTubeGeometry(trajectory.curve, {
      from,
      to: 1,
      radius,
      radialSegments,
      segmentsPerMeter,
      simplificationThreshold,
      startCap: true,
      endCap: true,
      computeLengths: true,
    });
    const mesh = new THREE.Mesh(
      toBufferGeometry(tube),
      new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.1, transparent: opacity < 1, opacity })
    );
    mesh.userData = group.userData;
    group.add(mesh);
  } else {
    const us = getCurvePositions(trajectory.curve, from, 1, segmentsPerMeter, simplificationThreshold);
    const pts = us.map((u) => new THREE.Vector3(...trajectory.curve.getPointAt(u)));
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity })
    );
    line.userData = group.userData;
    group.add(line);
  }

  applyEvents(viewer, group, events);
  return group;
}

/** Casings — one metallic mesh per casing section */
export function createCasingsComponent(viewer, id, options = {}) {
  const { color = '#c9ced6', metalness = 0.25, roughness = 0.45, colorMap, events, ...genOpts } = options;
  const result = buildCasings(viewer.store, id, genOpts);
  if (!result) return null;

  const group = new THREE.Group();
  group.name = `casings-${id}`;
  group.userData = { type: 'casings', wellboreId: id };

  result.sections.forEach((section) => {
    const c = (colorMap && colorMap[section.item.type]) || color;
    const mesh = new THREE.Mesh(
      section.geometry,
      new THREE.MeshStandardMaterial({ color: c, metalness, roughness })
    );
    mesh.userData = {
      type: 'casing',
      wellboreId: id,
      casing: section.item,
      mdTop: section.item.mdTopMsl,
      mdBottom: section.item.mdBottomMsl,
    };
    group.add(mesh);
  });

  applyEvents(viewer, group, events);
  return group;
}

/** Completion tools — one mesh per category */
export function createCompletionToolsComponent(viewer, id, options = {}) {
  const { colors = completionToolCategoryColors, metalness = 0.15, roughness = 0.55, events, ...genOpts } = options;
  const result = buildCompletionTools(viewer.store, id, genOpts);
  if (!result) return null;

  const group = new THREE.Group();
  group.name = `completion-tools-${id}`;
  group.userData = { type: 'completion-tools', wellboreId: id };

  result.categories.forEach(({ category, tools, geometry }) => {
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({
        color: colors[category] || colors.unknown,
        metalness,
        roughness,
      })
    );
    mesh.userData = { type: 'completion-tool', category, wellboreId: id, tools };
    group.add(mesh);
  });

  applyEvents(viewer, group, events);
  return group;
}

/** Shoes — cone symbols at casing shoe depths, plus optional labels */
export function createShoesComponent(viewer, id, options = {}) {
  const { sizeMultiplier = 1, color = '#8e44ad', addLabels = true, labelOptions = {}, events, ...genOpts } = options;
  const result = buildShoes(viewer.store, id, genOpts);
  if (!result) return null;

  const group = new THREE.Group();
  group.name = `shoes-${id}`;
  group.userData = { type: 'shoes', wellboreId: id };

  const material = new THREE.MeshStandardMaterial({ color, metalness: 0.2, roughness: 0.5 });
  const up = new THREE.Vector3(0, 1, 0);

  result.shoes.forEach((shoe, i) => {
    const r = shoe.radius * sizeMultiplier;
    const geometry = new THREE.ConeGeometry(r, r * 3, 16);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(...shoe.position);
    // cone points +y by default; orient along tangent
    mesh.quaternion.setFromUnitVectors(up, new THREE.Vector3(...shoe.direction).normalize());
    mesh.userData = { type: 'shoe', wellboreId: id, name: shoe.name, md: shoe.md, data: shoe.data };
    group.add(mesh);

    if (addLabels && viewer.labels) {
      viewer.labels.add({
        id: `shoe_${id}_${i}`,
        position: shoe.position,
        direction: shoe.direction,
        name: shoe.name,
        priority: 5,
        color,
        ...labelOptions,
      });
    }
  });

  applyEvents(viewer, group, events);
  return group;
}

/** Formation markers — discs perpendicular to the trajectory + labels */
export function createFormationMarkersComponent(viewer, id, options = {}) {
  const { addLabels = true, opacity = 0.85, labelOptions = {}, events, ...genOpts } = options;
  const result = buildFormationMarkers(viewer.store, id, genOpts);
  if (!result) return null;

  const group = new THREE.Group();
  group.name = `formation-markers-${id}`;
  group.userData = { type: 'formation-markers', wellboreId: id };

  const up = new THREE.Vector3(0, 0, 1);

  result.markers.forEach((marker) => {
    const geometry = new THREE.CircleGeometry(marker.radius, 32);
    const material = new THREE.MeshBasicMaterial({
      color: marker.color,
      transparent: true,
      opacity,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(...marker.position);
    mesh.quaternion.setFromUnitVectors(up, new THREE.Vector3(...marker.direction).normalize());
    mesh.userData = { type: 'formation-marker', wellboreId: id, ...marker };
    group.add(mesh);

    if (addLabels && viewer.labels) {
      viewer.labels.add({
        id: marker.id,
        position: marker.position,
        direction: marker.direction,
        name: marker.name,
        priority: 3,
        color: marker.color,
        onClick: labelOptions.onClick,
        ...labelOptions,
      });
    }
  });

  applyEvents(viewer, group, events);
  return group;
}

/** Formation column — tube segments colored per formation */
export function createFormationColumnComponent(viewer, id, options = {}) {
  const { radius = 0.6, opacity = 1, events, ...genOpts } = options;
  const result = buildFormationColumn(viewer.store, id, { ...genOpts, radius, radialSegments: options.radialSegments ?? 12 });
  if (!result) return null;

  const group = new THREE.Group();
  group.name = `formation-column-${id}`;
  group.userData = { type: 'formation-column', wellboreId: id };

  result.segments.forEach(({ interval, geometry }) => {
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({
        color: interval.color || '#cccccc',
        roughness: 0.7,
        metalness: 0.05,
        transparent: opacity < 1,
        opacity,
      })
    );
    mesh.userData = { type: 'formation-interval', wellboreId: id, interval };
    group.add(mesh);
  });

  applyEvents(viewer, group, events);
  return group;
}

/** Perforations — instanced spikes around the wellbore */
export function createPerforationsComponent(viewer, id, options = {}) {
  const { sizeMultiplier = 1, color = '#e67e22', spikeLength = 2, spikeRadius = 0.25, events, ...genOpts } = options;
  const result = buildPerforations(viewer.store, id, genOpts);
  if (!result) return null;

  const geometry = new THREE.ConeGeometry(spikeRadius * sizeMultiplier, spikeLength * sizeMultiplier, 6);
  const material = new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.2 });
  const mesh = new THREE.InstancedMesh(geometry, material, result.spikes.length);

  const matrix = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const target = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const quat = new THREE.Quaternion();

  result.spikes.forEach((spike, i) => {
    pos.set(...spike.position);
    target.set(...spike.direction).normalize();
    quat.setFromUnitVectors(up, target);
    // place cone so its base sits on the wellbore and tip points outward
    const center = pos.clone().add(target.clone().multiplyScalar((spikeLength * sizeMultiplier) / 2));
    matrix.compose(center, quat, new THREE.Vector3(1, 1, 1));
    mesh.setMatrixAt(i, matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;

  mesh.name = `perforations-${id}`;
  mesh.userData = { type: 'perforations', wellboreId: id, spikes: result.spikes };
  applyEvents(viewer, mesh, events);
  return mesh;
}

/** Depth markers — labels at regular MD intervals */
export function createDepthMarkersComponent(viewer, id, options = {}) {
  const { addLabels = true, color = '#9fb4c8', priority = 1, labelOptions = {}, ...genOpts } = options;
  const markers = buildDepthMarkers(viewer.store, id, genOpts);
  if (!markers) return null;

  if (addLabels && viewer.labels) {
    markers.forEach((m) => {
      viewer.labels.add({
        id: `depth_${m.id}`,
        position: m.position,
        direction: m.direction,
        name: m.name,
        priority,
        color,
        className: 'w3-label--depth',
        ...labelOptions,
      });
    });
  }
  return markers;
}

/** Surface / horizon component */
export function createSurfaceComponent(viewer, id, options = {}) {
  const {
    color = null,
    ramp = colorRamps.depth,
    opacity = 0.9,
    wireframe = false,
    flatShading = false,
    metalness = 0,
    roughness = 0.9,
    reverseRamp = false,
    contours = null, // { interval, color, opacity, offset } | false
    events,
  } = options;

  const meta = viewer.store.get('surface-meta', id);
  const values = viewer.store.get('surface-values', id);
  if (!meta || !values) return null;

  const geometry = buildSurfaceGeometry(meta, values);

  const materialParams = {
    transparent: opacity < 1,
    opacity,
    wireframe,
    flatShading,
    metalness,
    roughness,
    side: THREE.DoubleSide,
  };

  if (color) {
    materialParams.color = color;
  } else {
    // vertex colors by depth ramp
    const depthAttr = geometry.getAttribute('depth');
    const colors = new Float32Array(depthAttr.count * 3);
    const min = meta.displayMin ?? meta.min;
    const max = meta.displayMax ?? meta.max;
    for (let i = 0; i < depthAttr.count; i++) {
      let t = (depthAttr.getX(i) - min) / (max - min || 1);
      if (reverseRamp) t = 1 - t;
      const [r, g, b] = sampleRamp(ramp, t);
      colors[i * 3] = r;
      colors[i * 3 + 1] = g;
      colors[i * 3 + 2] = b;
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    materialParams.vertexColors = true;
  }

  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial(materialParams));
  mesh.name = `surface-${id}`;
  mesh.userData = { type: 'surface', surfaceId: id, meta };

  let contourLines = null;
  if (contours) {
    contourLines = buildContourLines(meta, values, contours === true ? {} : contours);
    if (contourLines) mesh.add(contourLines);
  }

  applyEvents(viewer, mesh, events);
  mesh.contourLines = contourLines;
  return mesh;
}

/* ========================================================================== */
/* Pointer events — generic click / move / enter / exit via raycasting        */
/* ========================================================================== */

export class PointerEventManager {
  /**
   * @param {HTMLElement} domElement the renderer's canvas (or any overlay)
   * @param {THREE.Camera} camera
   */
  constructor(domElement, camera) {
    this.domElement = domElement;
    this.camera = camera;
    this.targets = new Map(); // root object -> handlers
    this.raycaster = new THREE.Raycaster();
    this.raycaster.params.Line = { threshold: 8 }; // allow picking thin trajectory lines
    this.pointer = new THREE.Vector2();
    this.hovered = new Set();
    this.enabled = true;

    this._onPointerMove = this._onPointerMove.bind(this);
    this._onClick = this._onClick.bind(this);
    this._onPointerLeave = this._onPointerLeave.bind(this);

    domElement.addEventListener('pointermove', this._onPointerMove);
    domElement.addEventListener('click', this._onClick);
    domElement.addEventListener('pointerleave', this._onPointerLeave);
  }

  /** Register an object (checked recursively) for pointer events.
   * handlers: { onClick, onPointerMove, onPointerEnter, onPointerExit, cursor } */
  add(object, handlers) {
    this.targets.set(object, handlers);
    return this;
  }

  remove(object) {
    this.targets.delete(object);
    this.hovered.delete(object);
    return this;
  }

  dispose() {
    this.domElement.removeEventListener('pointermove', this._onPointerMove);
    this.domElement.removeEventListener('click', this._onClick);
    this.domElement.removeEventListener('pointerleave', this._onPointerLeave);
    this.targets.clear();
    this.hovered.clear();
  }

  _updatePointer(event) {
    const rect = this.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  /** Raycast all targets; returns Map(root -> {intersection, handlers}) with the nearest hit per root */
  _pick(event) {
    this._updatePointer(event);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const roots = Array.from(this.targets.keys());
    const hits = new Map();
    if (!roots.length) return hits;

    const intersects = this.raycaster.intersectObjects(roots, true);
    for (const hit of intersects) {
      let obj = hit.object;
      let root = null;
      let visible = true;
      while (obj) {
        if (obj.visible === false) visible = false;
        if (this.targets.has(obj)) {
          root = obj;
          break;
        }
        obj = obj.parent;
      }
      if (root && visible && !hits.has(root)) {
        hits.set(root, { intersection: hit, handlers: this.targets.get(root) });
      }
    }
    return hits;
  }

  _makeEvent(type, originalEvent, root, payload) {
    const { intersection } = payload || {};
    return {
      type,
      root,
      object: intersection ? intersection.object : null,
      point: intersection ? intersection.point.clone() : null,
      uv: intersection ? intersection.uv : null,
      distance: intersection ? intersection.distance : null,
      instanceId: intersection ? intersection.instanceId : undefined,
      userData: root ? root.userData : null,
      originalEvent,
    };
  }

  _onPointerMove(event) {
    if (!this.enabled) return;
    const hits = this._pick(event);

    // exits
    for (const root of Array.from(this.hovered)) {
      if (!hits.has(root)) {
        const handlers = this.targets.get(root);
        this.hovered.delete(root);
        handlers.onPointerExit?.(this._makeEvent('pointerexit', event, root, null));
      }
    }
    // enters + moves
    let cursor = null;
    hits.forEach(({ intersection, handlers }, root) => {
      if (!this.hovered.has(root)) {
        this.hovered.add(root);
        handlers.onPointerEnter?.(this._makeEvent('pointerenter', event, root, { intersection }));
      }
      handlers.onPointerMove?.(this._makeEvent('pointermove', event, root, { intersection }));
      if (handlers.cursor) cursor = handlers.cursor;
      else if (handlers.onClick) cursor = 'pointer';
    });
    this.domElement.style.cursor = cursor || '';
  }

  _onClick(event) {
    if (!this.enabled) return;
    const hits = this._pick(event);
    // deliver to the nearest hit, skipping roots flagged `passthrough`
    const sorted = Array.from(hits, ([root, payload]) => ({ root, payload })).sort(
      (a, b) => a.payload.intersection.distance - b.payload.intersection.distance
    );
    const target = sorted.find((h) => !h.payload.handlers.passthrough) || sorted[0];
    if (target && target.payload.handlers.onClick) {
      target.payload.handlers.onClick(
        this._makeEvent('click', event, target.root, { intersection: target.payload.intersection })
      );
    }
  }

  _onPointerLeave(event) {
    for (const root of Array.from(this.hovered)) {
      const handlers = this.targets.get(root);
      this.hovered.delete(root);
      handlers?.onPointerExit?.(this._makeEvent('pointerexit', event, root, null));
    }
    this.domElement.style.cursor = '';
  }
}

/* ========================================================================== */
/* Label layer — flexible HTML point-feature label system                     */
/* ========================================================================== */

let labelStylesInjected = false;
function injectLabelStyles() {
  if (labelStylesInjected) return;
  labelStylesInjected = true;
  const css = `
.w3-label-layer { position: absolute; inset: 0; overflow: hidden; pointer-events: none; z-index: 5; }
.w3-label-layer svg.w3-leader-lines { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
.w3-label { position: absolute; transform: translate(-50%, -50%); pointer-events: none;
  font: 11px/1.3 "Segoe UI", system-ui, sans-serif; color: #dfe6ee; white-space: nowrap;
  background: rgba(13, 20, 28, 0.75); border: 1px solid rgba(255,255,255,0.18);
  border-radius: 3px; padding: 2px 6px; user-select: none; }
.w3-label--clickable { pointer-events: auto; cursor: pointer; }
.w3-label--clickable:hover { background: rgba(40, 55, 70, 0.9); }
.w3-label--depth { background: transparent; border: none; color: #9fb4c8; font-size: 10px; padding: 0 2px; }
.w3-label--plain { background: transparent; border: none; padding: 0 2px; }
.w3-label-dot { position: absolute; width: 5px; height: 5px; border-radius: 50%;
  transform: translate(-50%, -50%); background: #fff; box-shadow: 0 0 3px rgba(0,0,0,0.8); }
`;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
}

export class LabelLayer {
  /**
   * @param {HTMLElement} container positioned element wrapping the canvas
   * @param {THREE.Camera} camera
   */
  constructor(container, camera) {
    injectLabelStyles();
    this.container = container;
    this.camera = camera;
    this.labels = new Map();
    this.enabled = true;
    this.collisionDetection = true;

    this.layer = document.createElement('div');
    this.layer.className = 'w3-label-layer';
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.setAttribute('class', 'w3-leader-lines');
    this.layer.appendChild(this.svg);
    container.appendChild(this.layer);

    this._v = new THREE.Vector3();
  }

  /**
   * Add a label.
   * data: {
   *   id, position: [x,y,z], name | html, direction?: [x,y,z],
   *   distance?: px offset from anchor (default 18),
   *   side?: 1 | -1 (which side of the direction, default 1),
   *   priority?: number (higher wins collisions),
   *   color?, className?, onClick?, collide?: boolean (default true),
   *   dot?: boolean (show anchor dot, default true), leaderLine?: boolean
   * }
   */
  add(data) {
    if (!data.id) data.id = `label_${this.labels.size}`;
    const el = document.createElement('div');
    el.className = 'w3-label' + (data.className ? ' ' + data.className : '');
    if (data.html !== undefined) el.innerHTML = data.html;
    else el.textContent = data.name ?? '';
    if (data.color) el.style.borderLeft = `3px solid ${data.color}`;
    if (data.onClick) {
      el.classList.add('w3-label--clickable');
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        data.onClick(data, e);
      });
    }
    const dot = document.createElement('div');
    dot.className = 'w3-label-dot';
    if (data.color) dot.style.background = data.color;

    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('stroke', data.color || 'rgba(255,255,255,0.4)');
    line.setAttribute('stroke-width', '1');
    this.svg.appendChild(line);
    this.layer.appendChild(el);
    if (data.dot !== false) this.layer.appendChild(dot);

    this.labels.set(data.id, { data, el, dot, line, visible: true });
    return data.id;
  }

  remove(id) {
    const entry = this.labels.get(id);
    if (!entry) return;
    entry.el.remove();
    entry.dot.remove();
    entry.line.remove();
    this.labels.delete(id);
  }

  clear() {
    Array.from(this.labels.keys()).forEach((id) => this.remove(id));
  }

  setVisible(id, visible) {
    const entry = this.labels.get(id);
    if (entry) entry.data.forceHidden = !visible;
  }

  _project(position) {
    const rect = this.container.getBoundingClientRect();
    this._v.set(position[0], position[1], position[2]).project(this.camera);
    if (this._v.z > 1 || this._v.z < -1) return null;
    return {
      x: (this._v.x * 0.5 + 0.5) * rect.width,
      y: (-this._v.y * 0.5 + 0.5) * rect.height,
      w: rect.width,
      h: rect.height,
    };
  }

  /** Call once per frame */
  update() {
    const entries = Array.from(this.labels.values());
    if (!this.enabled) {
      entries.forEach((e) => {
        e.el.style.display = 'none';
        e.dot.style.display = 'none';
        e.line.style.display = 'none';
      });
      return;
    }

    const placed = [];
    const computed = [];

    for (const entry of entries) {
      const { data, el, dot, line } = entry;
      const anchor = this._project(data.position);
      if (!anchor || data.forceHidden) {
        el.style.display = 'none';
        dot.style.display = 'none';
        line.style.display = 'none';
        continue;
      }

      let dx = 0;
      let dy = -(data.distance ?? 18);
      if (data.direction) {
        const tip = this._project([
          data.position[0] + data.direction[0] * 10,
          data.position[1] + data.direction[1] * 10,
          data.position[2] + data.direction[2] * 10,
        ]);
        if (tip) {
          // perpendicular to the screen-space direction
          let px = -(tip.y - anchor.y);
          let py = tip.x - anchor.x;
          const l = Math.hypot(px, py) || 1;
          const side = data.side ?? 1;
          const dist = data.distance ?? 18;
          dx = (px / l) * dist * side;
          dy = (py / l) * dist * side;
        }
      }

      const x = anchor.x + dx;
      const y = anchor.y + dy;

      el.style.display = '';
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
      dot.style.display = '';
      dot.style.left = `${anchor.x}px`;
      dot.style.top = `${anchor.y}px`;

      const rect = { x: x - el.offsetWidth / 2, y: y - el.offsetHeight / 2, w: el.offsetWidth, h: el.offsetHeight, entry };
      computed.push({ entry, anchor, x, y, rect, priority: data.priority ?? 0 });
    }

    // collision detection: higher priority first
    if (this.collisionDetection) {
      computed.sort((a, b) => b.priority - a.priority);
    }
    for (const c of computed) {
      const { entry, anchor, x, y, rect } = c;
      let hidden = false;
      if (this.collisionDetection && entry.data.collide !== false) {
        for (const p of placed) {
          if (rect.x < p.x + p.w && rect.x + rect.w > p.x && rect.y < p.y + p.h && rect.y + rect.h > p.y) {
            hidden = true;
            break;
          }
        }
      }
      if (hidden) {
        entry.el.style.display = 'none';
        entry.dot.style.display = 'none';
        entry.line.style.display = 'none';
      } else {
        placed.push(rect);
        if (entry.data.leaderLine !== false && entry.data.direction) {
          entry.line.style.display = '';
          entry.line.setAttribute('x1', anchor.x);
          entry.line.setAttribute('y1', anchor.y);
          entry.line.setAttribute('x2', x);
          entry.line.setAttribute('y2', y);
        } else {
          entry.line.style.display = 'none';
        }
      }
    }
  }
}

/* ========================================================================== */
/* Well map — HTML/SVG wellbore schematic                                     */
/* ========================================================================== */

let wellMapStylesInjected = false;
function injectWellMapStyles() {
  if (wellMapStylesInjected) return;
  wellMapStylesInjected = true;
  const css = `
.w3-wellmap { position: relative; width: 100%; height: 100%; overflow: hidden; user-select: none; }
.w3-wellmap svg { display: block; width: 100%; height: 100%; }
.w3-wellmap .track { pointer-events: painted; }
.w3-wellmap .track.interactive { cursor: pointer; }
.w3-wellmap text { font-family: monospace; }
`;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
}

const SVGNS = 'http://www.w3.org/2000/svg';
const svgEl = (tag, attrs = {}) => {
  const el = document.createElementNS(SVGNS, tag);
  for (const k in attrs) el.setAttribute(k, attrs[k]);
  return el;
};

/**
 * A 2D SVG schematic of wellbores (tracks) against depth.
 *
 * const wm = new WellMap(container, {
 *   interactive: true, depthCursor: true, colorMap: { id: '#f00' },
 *   onSelect: (wellboreId, depth) => {},
 *   onDepthChange: (depth) => {},
 *   onWellboreOver: (header, depth) => {},
 *   styles: { depthAxisWidth: 40, trackWidth: 56, darkMode: true, textColor: '#ccc',
 *             depthAxisColor: '#445', kickoffAxisColor: '#334' }
 * })
 * wm.setWellbores(headers)  // WellboreHeader[]
 * wm.setActiveDepths({ id: mdMsl })
 * wm.select(id); wm.setDepth(md)
 */
export class WellMap {
  constructor(container, options = {}) {
    injectWellMapStyles();
    this.container = container;
    this.options = options;
    this.styles = {
      depthAxisWidth: 42,
      trackWidth: 56,
      topMargin: 16,
      bottomMargin: 42,
      darkMode: true,
      textColor: '#b8c4d0',
      depthAxisColor: '#3a4a5a',
      kickoffAxisColor: '#2c3a48',
      ...(options.styles || {}),
    };
    this.wellbores = [];
    this.activeDepths = {};
    this.selectedId = options.selected ?? null;
    this.depth = options.depth;
    this.interactive = !!options.interactive;
    this.depthCursor = options.depthCursor !== false;

    this.root = document.createElement('div');
    this.root.className = 'w3-wellmap';
    this.svg = svgEl('svg');
    this.root.appendChild(this.svg);
    container.appendChild(this.root);

    this._resizeObserver = new ResizeObserver(() => this.render());
    this._resizeObserver.observe(container);

    if (this.interactive) {
      this.svg.addEventListener('pointermove', (e) => this._onPointerMove(e));
      this.svg.addEventListener('pointerleave', () => {
        this.options.onWellboreOver?.(null, undefined);
      });
    }
  }

  setWellbores(headers) {
    this.wellbores = headers.slice();
    // parents before children, then by slot order of creation
    const byName = new Map(this.wellbores.map((w) => [w.well || w.name, w]));
    const ordered = [];
    const remaining = this.wellbores.slice();
    let guard = 1000;
    while (remaining.length && guard-- > 0) {
      const idx = remaining.findIndex(
        (w) => !w.parent || !byName.has(w.parent) || ordered.some((o) => (o.well || o.name) === w.parent)
      );
      if (idx === -1) {
        ordered.push(...remaining.splice(0));
        break;
      }
      ordered.push(remaining.splice(idx, 1)[0]);
    }
    this.wellbores = ordered;
    this.slotsById = new Map(this.wellbores.map((w, i) => [w.id, i]));
    this.render();
  }

  setActiveDepths(activeDepths) {
    this.activeDepths = activeDepths || {};
    this.render();
  }

  select(id) {
    this.selectedId = id;
    this.render();
  }

  setDepth(depth) {
    this.depth = depth;
    this._updateDepthCursor();
  }

  dispose() {
    this._resizeObserver.disconnect();
    this.root.remove();
  }

  _measures() {
    const rect = this.container.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    const n = Math.max(1, this.wellbores.length);
    const avail = width - this.styles.depthAxisWidth - 8;
    const trackWidth = Math.min(this.styles.trackWidth, avail / n);
    const ratio = clamp(trackWidth / this.styles.trackWidth, 0, 1);
    const totalTracksWidth = trackWidth * n;
    const offsetX = this.styles.depthAxisWidth + (avail - totalTracksWidth) / 2;
    const range = [this.styles.topMargin, height - this.styles.bottomMargin];
    return { width, height, trackWidth, ratio, offsetX, range, n };
  }

  _domain() {
    let min = Infinity;
    let max = -Infinity;
    this.wellbores.forEach((w) => {
      const top = w.kickoffDepthMsl ?? -(w.depthReferenceElevation || 0);
      min = Math.min(min, top, 0);
      max = Math.max(max, w.depthMdMsl);
    });
    if (!Number.isFinite(min)) min = 0;
    if (!Number.isFinite(max)) max = 100;
    const pad = (max - min) * 0.02;
    return [min - pad, max + pad];
  }

  _onPointerMove(e) {
    if (!this.depthCursor) return;
    const rect = this.svg.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const { range } = this._measures();
    const domain = this._domain();
    const pos = clamp(y, range[0], range[1]);
    const depth = domain[0] + ((pos - range[0]) / (range[1] - range[0])) * (domain[1] - domain[0]);
    this.depth = depth;
    this._updateDepthCursor();
    this.options.onDepthChange?.(depth);
  }

  _updateDepthCursor() {
    if (!this.cursorGroup) return;
    if (this.depth === undefined || this.depth === null) {
      this.cursorGroup.style.display = 'none';
      return;
    }
    const { width, range } = this._measures();
    const domain = this._domain();
    const y = range[0] + ((this.depth - domain[0]) / (domain[1] - domain[0])) * (range[1] - range[0]);
    if (y < range[0] || y > range[1]) {
      this.cursorGroup.style.display = 'none';
      return;
    }
    this.cursorGroup.style.display = '';
    this.cursorLine.setAttribute('y1', y);
    this.cursorLine.setAttribute('y2', y);
    this.cursorLine.setAttribute('x2', width);
    this.cursorText.setAttribute('y', y - 3);
    this.cursorText.setAttribute('x', width - 4);
    this.cursorText.textContent = `${Math.round(this.depth)}m`;
  }

  render() {
    if (!this.svg.isConnected) return;
    const { width, height, trackWidth, ratio, offsetX, range } = this._measures();
    if (width < 10 || height < 10) return;
    const domain = this._domain();
    const scale = (d) => range[0] + ((d - domain[0]) / (domain[1] - domain[0])) * (range[1] - range[0]);

    while (this.svg.firstChild) this.svg.removeChild(this.svg.firstChild);
    const s = this.styles;
    const getSlotX = (slot) => offsetX + slot * trackWidth + trackWidth / 2;

    // --- depth axis (left) ---
    const axisGroup = svgEl('g');
    const startTick = Math.floor(domain[0] / 100) * 100;
    for (let t = startTick; t <= domain[1]; t += 100) {
      const y = scale(t);
      axisGroup.appendChild(svgEl('line', { x1: 8, x2: s.depthAxisWidth, y1: y, y2: y, stroke: s.depthAxisColor, 'stroke-width': 1 }));
      const label = svgEl('text', { x: s.depthAxisWidth + 4, y: y + 3, 'font-size': 9, fill: s.textColor, opacity: 0.6 });
      label.textContent = t % 500 === 0 ? String(t) : '';
      axisGroup.appendChild(label);
    }
    this.svg.appendChild(axisGroup);

    // --- kickoff axis (horizontal lines at kickoff depths) ---
    const kickoffs = new Set();
    this.wellbores.forEach((w) => {
      if (w.kickoffDepthMsl !== null && w.kickoffDepthMsl !== undefined) kickoffs.add(w.kickoffDepthMsl);
    });
    const kickGroup = svgEl('g');
    const sortedTicks = Array.from(kickoffs).sort((a, b) => a - b);
    sortedTicks.forEach((tick, i) => {
      const y = scale(tick);
      kickGroup.appendChild(
        svgEl('line', { x1: s.depthAxisWidth, x2: width, y1: y, y2: y, stroke: s.kickoffAxisColor, 'stroke-width': 0.5 })
      );
      const prev = i > 0 ? sortedTicks[i - 1] : null;
      if (prev === null || Math.abs(scale(tick) - scale(prev)) > 6) {
        const label = svgEl('text', { x: s.depthAxisWidth + 4, y: y - 2, 'font-size': 9, fill: s.textColor, opacity: 0.7 });
        label.textContent = String(Math.round(tick));
        kickGroup.appendChild(label);
      }
    });
    this.svg.appendChild(kickGroup);

    // --- tracks ---
    const tracksGroup = svgEl('g', { class: 'tracks' });
    const strokeWidth = Math.max(1.2, ratio * 10);
    const lineHeight = ratio ? Math.min(15, ratio * 24) : 0;
    const byName = new Map(this.wellbores.map((w) => [w.well || w.name, w]));
    const dash = strokeWidth / 2;
    const filterColor = s.darkMode ? 'rgba(0,0,0,.9)' : 'rgba(240,240,240,.9)';

    const pathStr = (x1, x2, y1, y2) => {
      let d = `M ${x1} ${y1}`;
      if (x1 !== x2) {
        if (y2 - y1 > strokeWidth) d += ` A ${strokeWidth} ${strokeWidth} 0 0 0 ${x2} ${y1 + strokeWidth}`;
        else d += ` L ${x2} ${y1}`;
      }
      d += ` L ${x2} ${y2}`;
      return d;
    };

    this.wellbores.forEach((w) => {
      const slot = this.slotsById.get(w.id);
      const parent = w.parent ? byName.get(w.parent) : null;
      const parentSlot = parent ? this.slotsById.get(parent.id) : null;
      const x1 = getSlotX(parentSlot !== null && parentSlot !== undefined ? parentSlot : slot);
      const x2 = getSlotX(slot);
      const fromMsl = w.kickoffDepthMsl ?? -(w.depthReferenceElevation || 0);
      const top = scale(fromMsl);
      const termination = scale(w.depthMdMsl);
      const kickoff = w.kickoffDepthMsl != null ? scale(w.kickoffDepthMsl) : null;
      const isSelected = this.selectedId === w.id;
      const color = (this.options.colorMap && this.options.colorMap[w.id]) || this.options.color || '#c0c8d0';

      const g = svgEl('g', {
        class: `track${isSelected ? ' selected' : ''}${this.interactive ? ' interactive' : ''}`,
        opacity: !this.interactive || isSelected ? 1 : 0.75,
      });
      const title = svgEl('title');
      title.textContent = w.name;
      g.appendChild(title);

      const activeTo = this.activeDepths[w.id];
      const drawPath = (x1p, x2p, y1, y2, dashed) => {
        const p = svgEl('path', {
          d: pathStr(x1p, x2p, y1, y2),
          stroke: color,
          'stroke-width': strokeWidth,
          fill: 'none',
          style: `filter: drop-shadow(1px 1px 2px ${filterColor})`,
        });
        if (dashed) {
          p.setAttribute('stroke-dasharray', `${dash},${dash / 2}`);
          p.style.pointerEvents = 'none';
        }
        g.appendChild(p);
        if (dashed) {
          // invisible hit-path
          g.appendChild(
            svgEl('path', { d: pathStr(x1p, x2p, y1, y2), stroke: color, 'stroke-width': strokeWidth, 'stroke-opacity': 0, fill: 'none' })
          );
        }
      };

      if (activeTo !== undefined) {
        drawPath(x1, x2, top, scale(activeTo), false);
        if (scale(activeTo) > top) drawPath(x2, x2, scale(activeTo), termination, true);
      } else {
        drawPath(x1, x2, top, termination, true);
      }

      if (kickoff !== null) {
        g.appendChild(
          svgEl('circle', { cx: x1, cy: kickoff, r: strokeWidth * 0.8, fill: color, stroke: '#00000080', 'stroke-width': 0.5 })
        );
      }

      if (lineHeight >= 8 && ratio >= 0.45) {
        const name = svgEl('text', {
          x: x2,
          y: termination + lineHeight,
          'font-size': lineHeight - 2,
          fill: s.textColor,
          'fill-opacity': isSelected ? 1 : 0.75,
          'text-anchor': 'middle',
          'dominant-baseline': 'middle',
          'font-weight': 'bold',
          style: isSelected ? 'text-decoration: underline' : '',
        });
        name.textContent = (w.well ? w.name.replace(w.well, '') : w.name) || 'Main';
        g.appendChild(name);
      }
      if (ratio >= 0.5) {
        const td = svgEl('text', {
          x: x2,
          y: termination + lineHeight * 2,
          'font-size': lineHeight * 0.75 - 2,
          fill: s.textColor,
          'fill-opacity': isSelected ? 1 : 0.75,
          'text-anchor': 'middle',
        });
        td.textContent = `${w.depthMdMsl}m`;
        g.appendChild(td);
      }

      if (this.interactive) {
        g.addEventListener('click', (e) => {
          const rect = this.svg.getBoundingClientRect();
          const y = clamp(e.clientY - rect.top, range[0], range[1]);
          const depth = domain[0] + ((y - range[0]) / (range[1] - range[0])) * (domain[1] - domain[0]);
          this.depth = depth;
          this.options.onDepthChange?.(depth);
          this._updateDepthCursor();
          if (this.selectedId !== w.id) {
            this.selectedId = w.id;
            this.options.onSelect?.(w.id, depth);
            this.render();
          }
        });
        g.addEventListener('pointermove', (e) => {
          if (!(e.target instanceof SVGPathElement)) return;
          const rect = this.svg.getBoundingClientRect();
          const y = clamp(e.clientY - rect.top, range[0], range[1]);
          const depth = domain[0] + ((y - range[0]) / (range[1] - range[0])) * (domain[1] - domain[0]);
          this.options.onWellboreOver?.(w, depth);
        });
        g.addEventListener('pointerleave', (e) => {
          if (e.target instanceof SVGPathElement) this.options.onWellboreOver?.(null, undefined);
        });
      }

      tracksGroup.appendChild(g);
    });
    this.svg.appendChild(tracksGroup);

    // --- depth cursor ---
    const cursorColor = s.cursorColor || '#e8c25a';
    this.cursorGroup = svgEl('g', { style: 'pointer-events:none' });
    this.cursorLine = svgEl('line', { x1: s.depthAxisWidth, y1: 0, y2: 0, stroke: cursorColor, 'stroke-width': 1, 'stroke-dasharray': '6,4' });
    this.cursorText = svgEl('text', { 'font-size': 10, fill: cursorColor, 'text-anchor': 'end' });
    this.cursorGroup.appendChild(this.cursorLine);
    this.cursorGroup.appendChild(this.cursorText);
    this.cursorGroup.style.display = 'none';
    if (this.interactive && this.depthCursor) this.svg.appendChild(this.cursorGroup);
    this._updateDepthCursor();
  }
}

/* ========================================================================== */
/* Well3DViewer — renderer / scene / camera / integration                      */
/* ========================================================================== */

export class Well3DViewer {
  /**
   * const viewer = new Well3DViewer(container, {
   *   store, background: 0x0d1420, cameraPosition: [800, -1200, 800],
   *   target: [0, -1500, 0], grid: 0 (or grid size), antialias: true
   * })
   */
  constructor(container, options = {}) {
    this.container = container;
    this.options = options;
    this.store = options.store || new DataStore();

    container.style.position = container.style.position || 'relative';
    container.style.overflow = 'hidden';

    this.renderer = new THREE.WebGLRenderer({ antialias: options.antialias !== false, alpha: false });
    this.renderer.setPixelRatio(window.devicePixelRatio || 1);
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    if (options.shadows) this.renderer.shadowMap.enabled = true;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(options.background ?? 0x0d1420);
    if (options.fog) this.scene.fog = new THREE.Fog(options.background ?? 0x0d1420, options.fog[0], options.fog[1]);

    this.camera = new THREE.PerspectiveCamera(
      options.fov ?? 50,
      container.clientWidth / container.clientHeight,
      options.near ?? 0.1,
      options.far ?? 100000
    );
    const cp = options.cameraPosition || [1000, -1000, 1000];
    this.camera.position.set(cp[0], cp[1], cp[2]);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    const t = options.target || [0, -500, 0];
    this.controls.target.set(t[0], t[1], t[2]);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.update();

    // lights
    this.scene.add(new THREE.AmbientLight(0xffffff, options.ambientIntensity ?? 0.45));
    this.scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x33302a, options.hemisphereIntensity ?? 0.9));
    const dir = new THREE.DirectionalLight(0xffffff, options.directionalIntensity ?? 1.6);
    dir.position.set(1, 2, 1.5).multiplyScalar(5000);
    this.scene.add(dir);
    const dir2 = new THREE.DirectionalLight(0xaFC4ff, 0.5);
    dir2.position.set(-1, -0.5, -1).multiplyScalar(5000);
    this.scene.add(dir2);

    if (options.grid) {
      const size = typeof options.grid === 'number' ? options.grid : 5000;
      const grid = new THREE.GridHelper(size, 25, 0x2a3a4a, 0x1c2836);
      grid.position.y = options.gridY ?? 0;
      this.scene.add(grid);
    }
    if (options.axes) this.scene.add(new THREE.AxesHelper(options.axes));

    this.events = new PointerEventManager(this.renderer.domElement, this.camera);
    this.labels = new LabelLayer(container, this.camera);

    this._onBeforeRender = [];
    this._running = true;
    this._resizeObserver = new ResizeObserver(() => this._resize());
    this._resizeObserver.observe(container);

    this._animate = this._animate.bind(this);
    requestAnimationFrame(this._animate);
  }

  _resize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  _animate() {
    if (!this._running) return;
    requestAnimationFrame(this._animate);
    this.controls.update();
    this._onBeforeRender.forEach((fn) => fn());
    this.renderer.render(this.scene, this.camera);
    this.labels.update();
  }

  onBeforeRender(fn) {
    this._onBeforeRender.push(fn);
  }

  dispose() {
    this._running = false;
    this._resizeObserver.disconnect();
    this.events.dispose();
    this.labels.clear();
    this.labels.layer.remove();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  /* ---- component adders (return THREE.Object3D, already added to scene) ---- */

  addTrajectory(id, options) {
    const obj = createTrajectoryComponent(this, id, options);
    if (obj) this.scene.add(obj);
    return obj;
  }

  addCasings(id, options) {
    const obj = createCasingsComponent(this, id, options);
    if (obj) this.scene.add(obj);
    return obj;
  }

  addCompletionTools(id, options) {
    const obj = createCompletionToolsComponent(this, id, options);
    if (obj) this.scene.add(obj);
    return obj;
  }

  addShoes(id, options) {
    const obj = createShoesComponent(this, id, options);
    if (obj) this.scene.add(obj);
    return obj;
  }

  addFormationMarkers(id, options) {
    const obj = createFormationMarkersComponent(this, id, options);
    if (obj) this.scene.add(obj);
    return obj;
  }

  addFormationColumn(id, options) {
    const obj = createFormationColumnComponent(this, id, options);
    if (obj) this.scene.add(obj);
    return obj;
  }

  addPerforations(id, options) {
    const obj = createPerforationsComponent(this, id, options);
    if (obj) this.scene.add(obj);
    return obj;
  }

  addDepthMarkers(id, options) {
    return createDepthMarkersComponent(this, id, options);
  }

  addSurface(id, options) {
    const obj = createSurfaceComponent(this, id, options);
    if (obj) this.scene.add(obj);
    return obj;
  }

  remove(object) {
    if (!object) return;
    this.scene.remove(object);
    this.events.remove(object);
  }

  /** Get a Trajectory helper for a wellbore in the store */
  getTrajectory(id) {
    return trajectoryFromStore(this.store, id);
  }

  /** Point on a wellbore at MD msl (world coords [x,y,z]) or null */
  getPointAtDepth(id, md, clamped = true) {
    const t = this.getTrajectory(id);
    return t ? t.getPointAtDepth(md, clamped) : null;
  }

  /** Focus camera target on a world position (animated not included) */
  focus(point, distance) {
    this.controls.target.set(point[0], point[1], point[2]);
    if (distance) {
      const dir = this.camera.position.clone().sub(this.controls.target).normalize().multiplyScalar(distance);
      this.camera.position.copy(this.controls.target).add(dir);
    }
    this.controls.update();
  }

  /** Fit camera to a wellbore's bounding box */
  focusWellbore(id, padding = 1.4) {
    const t = this.getTrajectory(id);
    if (!t) return;
    const bbox = t.curve.getBoundingBox(0, 1);
    const center = [(bbox.min[0] + bbox.max[0]) / 2, (bbox.min[1] + bbox.max[1]) / 2, (bbox.min[2] + bbox.max[2]) / 2];
    const size = Math.max(bbox.max[0] - bbox.min[0], bbox.max[1] - bbox.min[1], bbox.max[2] - bbox.min[2]);
    this.focus(center, size * padding * 1.2);
  }
}

export default {
  Well3DViewer,
  DataStore,
  WellMap,
  LabelLayer,
  PointerEventManager,
  getSplineCurve,
  getTrajectory,
  getCurvePositions,
  calculateFrenetFrames,
  buildTubeGeometry,
  toBufferGeometry,
  buildCasings,
  buildCompletionTools,
  buildShoes,
  buildFormationMarkers,
  buildFormationColumn,
  buildPerforations,
  buildDepthMarkers,
  buildSurfaceGeometry,
  buildContourLines,
  colorRamps,
  sampleRamp,
  clamp,
  lerp,
};
