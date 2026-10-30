// Copyright 2026 Kai Prince. SPDX-License-Identifier: Apache-2.0
// See LICENSE/COPYRIGHT. Independent implementation of the complex Laplace
// derivative FMM; derivation and primary references are in developer tests.
const LIMIT = 1e6, MAX_POINTS = 8192;
const chooseCache = new Map();
function number(value, fallback, low, high, name) {
  value = value ?? fallback;
  if (!Number.isFinite(value) || value < low || value > high) throw new Error(`graph force: invalid ${name}`);
  return value;
}
function binomials(order) {
  if (!chooseCache.has(order)) {
    const rows = [[1]];
    for (let n = 1; n <= 2 * order; n++) rows.push(Array.from({ length: n + 1 }, (_, k) => k === 0 || k === n ? 1 : rows[n - 1][k - 1] + rows[n - 1][k]));
    chooseCache.set(order, rows);
  }
  return chooseCache.get(order);
}
function powers(x, y, count) {
  const re = new Float64Array(count), im = new Float64Array(count); re[0] = 1;
  for (let k = 1; k < count; k++) { re[k] = re[k - 1] * x - im[k - 1] * y; im[k] = re[k - 1] * y + im[k - 1] * x; }
  return [re, im];
}
function direction(a, b) {
  const forward = a < b, key = forward ? `${a}\0${b}` : `${b}\0${a}`;
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) hash = Math.imul(hash ^ key.charCodeAt(i), 16777619);
  const angle = (hash >>> 0) / 4294967296 * 2 * Math.PI, sign = forward ? 1 : -1;
  return [sign * Math.cos(angle), sign * Math.sin(angle)];
}

/** Repulsion qi*qj*(zi-zj)/|zi-zj|², with bounded direct near-field
 * regularization. This is a genuine adaptive FMM: leaf moments, upward M2M,
 * mutual cell M2L, downward L2L and local evaluation; near pairs are direct.
 * theta bounds (source radius + target radius)/centre distance. Degenerate
 * coincident leaves can still require quadratic direct work, exposed in stats.
 * No input objects are mutated. Returned force order matches input order. */
export function repulsiveForces(input, options = {}) {
  if (!Array.isArray(input) || input.length > MAX_POINTS) throw new Error('graph force: at most 8192 points required');
  const order = number(options.order, 8, 2, 12, 'order');
  const capacity = number(options.leafCapacity, 12, 1, 64, 'leaf capacity');
  if (!Number.isInteger(order) || !Number.isInteger(capacity)) throw new Error('graph force: integer expansion/leaf bounds required');
  const theta = number(options.theta, .55, .15, .7, 'separation'), softening = number(options.softening, .5, 1e-8, 1e4, 'softening');
  const ids = new Set();
  const points = input.map((point, i) => {
    const id = String(point.id ?? i);
    if (ids.has(id)) throw new Error('graph force: duplicate point identity'); ids.add(id);
    return { x: number(point.x, undefined, -LIMIT, LIMIT, 'x'), y: number(point.y, undefined, -LIMIT, LIMIT, 'y'), q: number(point.charge, 1, 0, 1e4, 'charge'), id, i };
  });
  const forces = points.map(() => ({ x: 0, y: 0 }));
  const stats = { algorithm: 'complex-2d-fmm', order, cells: 0, maxDepth: 0, pairVisits: 0, directPairs: 0, m2mTranslations: 0, m2lTranslations: 0, l2lTranslations: 0, coefficientProducts: 0 };
  if (!points.length) return { forces, stats };
  const C = binomials(order);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const point of points) { minX = Math.min(minX, point.x); maxX = Math.max(maxX, point.x); minY = Math.min(minY, point.y); maxY = Math.max(maxY, point.y); }
  function cell(indices, x, y, half, depth) {
    stats.cells++; stats.maxDepth = Math.max(stats.maxDepth, depth);
    const node = { x, y, half, indices, children: [], mr: new Float64Array(order), mi: new Float64Array(order), lr: new Float64Array(order), li: new Float64Array(order) };
    if (indices.length > capacity && depth < 20 && half > 1e-9) {
      const groups = [[], [], [], []];
      for (const i of indices) groups[(points[i].x >= x ? 1 : 0) + (points[i].y >= y ? 2 : 0)].push(i);
      for (let k = 0; k < 4; k++) if (groups[k].length) node.children.push(cell(groups[k], x + (k & 1 ? 1 : -1) * half / 2, y + (k & 2 ? 1 : -1) * half / 2, half / 2, depth + 1));
    }
    if (!node.children.length) {
      for (const i of indices) {
        const point = points[i], [re, im] = powers(point.x - x, point.y - y, order);
        for (let k = 0; k < order; k++) { node.mr[k] += point.q * re[k]; node.mi[k] += point.q * im[k]; stats.coefficientProducts++; }
      }
    } else for (const child of node.children) {
      const [re, im] = powers(child.x - x, child.y - y, order); stats.m2mTranslations++;
      for (let k = 0; k < order; k++) for (let l = 0; l <= k; l++) {
        const b = C[k][l], r = re[k - l], s = im[k - l];
        node.mr[k] += b * (child.mr[l] * r - child.mi[l] * s); node.mi[k] += b * (child.mr[l] * s + child.mi[l] * r); stats.coefficientProducts++;
      }
    }
    return node;
  }
  const tree = cell(points.map((_, i) => i), (minX + maxX) / 2, (minY + maxY) / 2, Math.max(maxX - minX, maxY - minY, softening * 2) * .500001, 0);
  function direct(i, j) {
    const a = points[i], b = points[j]; let x = a.x - b.x, y = a.y - b.y;
    if (x === 0 && y === 0) { const d = direction(a.id, b.id); x = d[0] * softening; y = d[1] * softening; }
    const scale = a.q * b.q / Math.max(x * x + y * y, softening * softening), fx = x * scale, fy = y * scale;
    forces[i].x += fx; forces[i].y += fy; forces[j].x -= fx; forces[j].y -= fy; stats.directPairs++;
  }
  function m2l(source, target) {
    const x = target.x - source.x, y = target.y - source.y, rr = x * x + y * y;
    const [re, im] = powers(x / rr, -y / rr, 2 * order); stats.m2lTranslations++;
    for (let l = 0; l < order; l++) for (let k = 0; k < order; k++) {
      const b = (l & 1 ? -1 : 1) * C[k + l][l], r = re[k + l + 1], s = im[k + l + 1];
      target.lr[l] += b * (source.mr[k] * r - source.mi[k] * s); target.li[l] += b * (source.mr[k] * s + source.mi[k] * r); stats.coefficientProducts++;
    }
  }
  function interact(a, b) {
    stats.pairVisits++;
    if (a === b) {
      if (!a.children.length) { for (let i = 0; i < a.indices.length; i++) for (let j = i + 1; j < a.indices.length; j++) direct(a.indices[i], a.indices[j]); }
      else for (let i = 0; i < a.children.length; i++) { interact(a.children[i], a.children[i]); for (let j = i + 1; j < a.children.length; j++) interact(a.children[i], a.children[j]); }
      return;
    }
    const distance = Math.hypot(a.x - b.x, a.y - b.y), radii = Math.SQRT2 * (a.half + b.half);
    if (radii / distance <= theta && distance - radii > softening) { m2l(a, b); m2l(b, a); return; }
    if (!a.children.length && !b.children.length) { for (const i of a.indices) for (const j of b.indices) direct(i, j); return; }
    if (a.children.length && (!b.children.length || a.half >= b.half)) for (const child of a.children) interact(child, b);
    else for (const child of b.children) interact(a, child);
  }
  interact(tree, tree);
  function downward(node) {
    if (!node.children.length) for (const i of node.indices) {
      const point = points[i], [re, im] = powers(point.x - node.x, point.y - node.y, order);
      for (let l = 0; l < order; l++) { forces[i].x += point.q * (node.lr[l] * re[l] - node.li[l] * im[l]); forces[i].y -= point.q * (node.lr[l] * im[l] + node.li[l] * re[l]); stats.coefficientProducts++; }
    } else for (const child of node.children) {
      const [re, im] = powers(child.x - node.x, child.y - node.y, order); stats.l2lTranslations++;
      for (let n = 0; n < order; n++) for (let l = n; l < order; l++) {
        const b = C[l][n], r = re[l - n], s = im[l - n];
        child.lr[n] += b * (node.lr[l] * r - node.li[l] * s); child.li[n] += b * (node.lr[l] * s + node.li[l] * r); stats.coefficientProducts++;
      }
      downward(child);
    }
  }
  downward(tree);
  return { forces, stats };
}

export const FORCE_DEFAULTS = Object.freeze({ width: 1000, height: 650, padding: 30, repulsion: 60, attraction: .04, damping: .82, linkDistance: 105, center: .04, maxVelocity: 12, alphaDecay: .025, alphaMin: .002, order: 6, theta: .55, leafCapacity: 12, softening: 2 });
const ranges = { width: [100, 10000], height: [100, 10000], padding: [0, 1000], repulsion: [0, 20000], attraction: [0, 1], damping: [0, .99], linkDistance: [5, 1000], center: [0, .2], maxVelocity: [.1, 100], alphaDecay: [.001, .2], alphaMin: [.00001, .1], order: [2, 12], theta: [.15, .7], leafCapacity: [1, 64], softening: [1e-8, 1e4] };
/** Position-only simulation: graph facts/edge weights are never altered. */
export function createForceSimulation(nodes, edges = [], options = {}) {
  const positions = new Map(); let links = [], alpha = 1, settings = { ...FORCE_DEFAULTS }, lastStats = null;
  const clamp = (value, axis) => Math.max(Math.min(settings.padding, settings[axis] / 3), Math.min(settings[axis] - Math.min(settings.padding, settings[axis] / 3), value));
  function configure(values = {}) {
    const next = { ...settings };
    for (const [key, value] of Object.entries(values)) {
      if (!Object.hasOwn(ranges, key)) throw new Error('graph force: unsupported simulation option');
      next[key] = number(value, FORCE_DEFAULTS[key], ...ranges[key], key);
    }
    if (!Number.isInteger(next.order) || !Number.isInteger(next.leafCapacity)) throw new Error('graph force: integer expansion/leaf bounds required');
    settings = next;
    for (const point of positions.values()) { point.x = clamp(point.x, 'width'); point.y = clamp(point.y, 'height'); }
    reheat(); return api;
  }
  function reheat(value = 1) { alpha = Math.max(alpha, number(value, 1, 0, 1, 'alpha')); return api; }
  function setNodes(nextNodes, nextEdges = links) {
    if (!Array.isArray(nextNodes) || nextNodes.length > MAX_POINTS || !Array.isArray(nextEdges) || nextEdges.length > 65536) throw new Error('graph force: bounded nodes and links required');
    const active = new Set(), nextPositions = new Map();
    for (const node of nextNodes) {
      const id = String(typeof node === 'string' ? node : node.id);
      if (!id || id === 'undefined' || active.has(id)) throw new Error('graph force: distinct node identities required'); active.add(id);
      if (positions.has(id)) nextPositions.set(id, positions.get(id));
      else {
        let hash = 2166136261; for (let k = 0; k < id.length; k++) hash = Math.imul(hash ^ id.charCodeAt(k), 16777619);
        const angle = (hash >>> 0) / 4294967296 * 2 * Math.PI, radius = 40 + ((hash >>> 8) % 110);
        nextPositions.set(id, { x: clamp(Number.isFinite(node.x) ? node.x : settings.width / 2 + Math.cos(angle) * radius, 'width'), y: clamp(Number.isFinite(node.y) ? node.y : settings.height / 2 + Math.sin(angle) * radius, 'height'), vx: 0, vy: 0, pinned: false });
      }
    }
    const nextLinks = nextEdges.map(edge => ({ from: String(edge.from ?? edge.source?.id ?? edge.source), to: String(edge.to ?? edge.target?.id ?? edge.target) })).filter(edge => edge.from !== edge.to && active.has(edge.from) && active.has(edge.to));
    positions.clear(); for (const [id, point] of nextPositions) positions.set(id, point); links = nextLinks;
    reheat(); return api;
  }
  function pin(id, x, y) {
    const point = positions.get(String(id)); if (!point) return false;
    const nextX = clamp(number(x, undefined, -LIMIT, LIMIT, 'pin x'), 'width'), nextY = clamp(number(y, undefined, -LIMIT, LIMIT, 'pin y'), 'height');
    point.x = nextX; point.y = nextY; point.vx = point.vy = 0; point.pinned = true; reheat(); return true;
  }
  function release(id) { const point = positions.get(String(id)); if (!point) return false; point.pinned = false; reheat(.7); return true; }
  function isSettled() { return positions.size === 0 || alpha === 0 && [...positions.values()].every(point => point.pinned || Math.hypot(point.vx, point.vy) < .04); }
  function step(dt = 1) {
    dt = number(dt, 1, .05, 2, 'time step');
    if (isSettled()) return { settled: true, alpha, stats: lastStats };
    const ids = [...positions.keys()], points = ids.map(id => ({ id, ...positions.get(id) }));
    const result = repulsiveForces(points, settings); lastStats = result.stats;
    const accelerations = new Map(ids.map((id, i) => [id, { x: result.forces[i].x * settings.repulsion * alpha, y: result.forces[i].y * settings.repulsion * alpha }]));
    for (const link of links) {
      const a = positions.get(link.from), b = positions.get(link.to), x = b.x - a.x, y = b.y - a.y, length = Math.hypot(x, y);
      if (!length) continue;
      const scale = settings.attraction * alpha * (length - settings.linkDistance) / length;
      accelerations.get(link.from).x += x * scale; accelerations.get(link.from).y += y * scale;
      accelerations.get(link.to).x -= x * scale; accelerations.get(link.to).y -= y * scale;
    }
    for (const [id, point] of positions) {
      if (point.pinned) continue;
      const a = accelerations.get(id);
      point.vx = (point.vx + (a.x + (settings.width / 2 - point.x) * settings.center * alpha) * dt) * Math.pow(settings.damping, dt);
      point.vy = (point.vy + (a.y + (settings.height / 2 - point.y) * settings.center * alpha) * dt) * Math.pow(settings.damping, dt);
      const speed = Math.hypot(point.vx, point.vy);
      if (speed > settings.maxVelocity) { point.vx *= settings.maxVelocity / speed; point.vy *= settings.maxVelocity / speed; }
      const x = clamp(point.x + point.vx * dt, 'width'), y = clamp(point.y + point.vy * dt, 'height');
      if (x === point.x && (x <= settings.padding || x >= settings.width - settings.padding)) point.vx = 0;
      if (y === point.y && (y <= settings.padding || y >= settings.height - settings.padding)) point.vy = 0;
      point.x = x; point.y = y;
    }
    alpha *= Math.pow(1 - settings.alphaDecay, dt); if (alpha < settings.alphaMin) alpha = 0;
    return { settled: isSettled(), alpha, stats: lastStats };
  }
  const api = { positions, configure, setNodes, reheat, pin, release, step, isSettled, get alpha() { return alpha; }, get options() { return { ...settings }; } };
  configure(options); setNodes(nodes, edges); return api;
}
