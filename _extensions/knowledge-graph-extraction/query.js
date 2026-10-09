// Copyright 2026 Kai Prince. SPDX-License-Identifier: Apache-2.0
// See the accompanying LICENSE and COPYRIGHT files for terms and attribution.
/** Named queries over one coherent public snapshot. `scope` filters domains;
 * `requiredSources` checks source coverage. Reader choices never alter facts. */
export const QUERY_VERSION = 1;
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const sorted = values => [...new Set(values)].sort(compare);
const copy = value => JSON.parse(JSON.stringify(value));
/** Short presentation label; this never substitutes a label for an identity. */
export function recordLabel(object) {
  if (!object || typeof object.id !== 'string') throw new Error('a public record is required for its display label');
  return String(object.labels?.en ?? Object.entries(object.labels ?? {}).sort(([a], [b]) => compare(a, b))[0]?.[1] ?? object.id);
}
/** Every semantic choice includes its domain. Same-domain visible homonyms also
 * include type and full ID; normalization affects presentation only, never IDs. */
export function createSemanticLabels(records) {
  if (!Array.isArray(records)) throw new Error('public records must be an array');
  const byId = new Map(records.map(object => [object.id, object])), groups = new Map();
  const key = object => JSON.stringify([recordLabel(object).normalize('NFC').toLowerCase(), object.scope]);
  for (const object of byId.values()) { const value = key(object); groups.set(value, (groups.get(value) ?? 0) + 1); }
  return value => {
    const object = typeof value === 'string' ? byId.get(value) : value;
    const label = recordLabel(object);
    return `${label} (${object.scope}${groups.get(key(object)) > 1 ? `, ${object.type}; ${object.id}` : ''})`;
  };
}
function validate(graph) {
  if (!graph || typeof graph.snapshotId !== 'string' || !graph.snapshotId ||
      !['complete', 'incomplete'].includes(graph.status) || !Array.isArray(graph.objects) ||
      !Array.isArray(graph.relations) || !Array.isArray(graph.occurrences)) throw new Error('a coherent public graph snapshot is required');
  const objects = new Map(), edges = new Map();
  for (const object of graph.objects) {
    if (typeof object.id !== 'string' || objects.has(object.id)) throw new Error('duplicate or invalid object ID');
    objects.set(object.id, object);
  }
  for (const edge of graph.relations) {
    if (typeof edge.id !== 'string' || edges.has(edge.id) || !objects.has(edge.from) || !objects.has(edge.to)) throw new Error('duplicate relation ID or unavailable relation endpoint');
    edges.set(edge.id, edge);
  }
  if (graph.status === 'complete' && Array.isArray(graph.scope?.sources) && Array.isArray(graph.scope?.renderedSources) &&
      graph.scope.sources.some(source => !graph.scope.renderedSources.includes(source))) throw new Error('complete graph has incomplete source coverage');
  return { objects, edges };
}
function inScope(item, scope) { return scope === undefined || scope === null || (Array.isArray(scope) ? scope.includes(item.scope) : item.scope === scope); }
function context(graph, operation, options = {}) {
  const { objects, edges } = validate(graph), scope = options.scope ?? null, required = options.requiredSources ?? [];
  if (scope !== null && typeof scope !== 'string' && (!Array.isArray(scope) || scope.some(value => typeof value !== 'string'))) throw new Error('scope must be a domain name or array');
  if (!Array.isArray(required) || required.some(value => typeof value !== 'string')) throw new Error('requiredSources must contain source paths');
  return { graph, objects, edges, options, unavailable: required.filter(source => !graph.scope?.sources?.includes(source)),
    mismatched: options.snapshotId !== undefined && options.snapshotId !== graph.snapshotId, base: {
      operation, version: QUERY_VERSION, snapshotId: graph.snapshotId, scope: graph.scope,
      requestedScope: scope, requiredSources: sorted(required), graphStatus: graph.status } };
}
function result(ctx, answer, exhaustive = true, reason, extra = {}) {
  const unknown = ctx.unavailable.length || ctx.mismatched;
  const absent = answer === null || Array.isArray(answer) && !answer.length;
  const status = unknown || absent && (ctx.graph.status !== 'complete' || !exhaustive) ? 'unknown'
    : ctx.graph.status === 'complete' && exhaustive ? 'complete' : 'incomplete';
  return { ...ctx.base, status, exhaustive: Boolean(exhaustive && !unknown), answer: unknown ? null : answer,
    ...(reason ? { reason } : {}), ...extra };
}
function coverageFailure(ctx) {
  if (ctx.mismatched) return result(ctx, null, false, 'snapshot-mismatch');
  if (ctx.unavailable.length) return result(ctx, null, false, 'requested-source-outside-declared-scope', { unavailableSources: sorted(ctx.unavailable) });
  return null;
}
function integer(value, fallback, maximum, name) {
  const number = value ?? fallback;
  if (!Number.isInteger(number) || number < 1 || number > maximum) throw new Error(`${name} must be an integer from 1 to ${maximum}`);
  return number;
}
function nonnegative(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error(`${name} must be finite and nonnegative`);
  return value;
}
/** Existing three operations retain their result version and truth semantics. */
export function query(graph, operation, id, scope = undefined) {
  if (!['lookup', 'neighbours', 'definitions'].includes(operation)) throw new Error('unsupported named graph query');
  validate(graph);
  const context = { operation, version: 0, snapshotId: graph.snapshotId, scope: graph.scope, requestedScope: scope ?? null };
  const object = graph.objects.find(item => item.id === id && inScope(item, scope));
  if (!object) return { ...context, status: graph.status === 'complete' ? 'complete' : 'unknown', answer: null,
    reason: graph.status === 'complete' ? 'no-match-in-declared-scope' : 'incomplete-source-coverage' };
  const answer = operation === 'lookup' ? object : operation === 'definitions'
    ? graph.relations.filter(edge => edge.type === 'defines' && edge.to === id && inScope(edge, scope)).map(edge => graph.objects.find(item => item.id === edge.from)).filter(Boolean)
    : graph.relations.filter(edge => (edge.from === id || edge.to === id) && inScope(edge, scope));
  return { ...context, status: graph.status, answer };
}
const folded = value => String(value).normalize('NFC').toLowerCase();
function* searchValues(object) {
  yield object.id;
  for (const value of Object.values(object.labels ?? {})) if (typeof value === 'string') yield value;
  const aliases = object.properties?.aliases ?? object.aliases ?? [];
  if (Array.isArray(aliases)) { for (const value of aliases) if (typeof value === 'string') yield value; }
  else if (aliases && typeof aliases === 'object') for (const value of Object.values(aliases)) {
    if (Array.isArray(value)) { for (const item of value) if (typeof item === 'string') yield item; }
    else if (typeof value === 'string') yield value;
  }
}
/** String matching is deterministic; it does not merge senses or infer meaning. */
export function search(graph, options = {}) {
  const ctx = context(graph, 'search', options), failure = coverageFailure(ctx); if (failure) return failure;
  const text = folded(options.text ?? '').trim(), tokens = text.split(/\s+/).filter(Boolean), limit = integer(options.limit, 50, 1000, 'limit'), candidates = [];
  for (const object of graph.objects) {
    if (!inScope(object, options.scope) || options.types && !options.types.includes(object.type)) continue;
    // Score one value at a time: valid large alias collections must not become
    // function arguments or temporary arrays with engine-dependent size limits.
    let score = !text ? 1 : 0;
    if (text) for (const raw of searchValues(object)) {
      const value = folded(raw), candidate = value === text ? 100 : value.startsWith(text) ? 80 : value.includes(text) ? 60 : tokens.every(token => value.includes(token)) ? 40 : 0;
      score = Math.max(score, candidate); if (score === 100) break;
    }
    if (score) candidates.push({ object, score });
  }
  candidates.sort((a, b) => b.score - a.score || compare(a.object.id, b.object.id));
  const exhaustive = candidates.length <= limit;
  return result(ctx, candidates.slice(0, limit), exhaustive, !exhaustive ? 'ranked-limit' : !candidates.length ? graph.status === 'complete' ? 'no-match-in-declared-scope' : 'incomplete-source-coverage' : undefined, { observedMatches: candidates.length });
}
function adjacency(ctx, options) {
  const direction = options.direction ?? 'outgoing', types = options.relationTypes;
  if (!['outgoing', 'incoming', 'both'].includes(direction)) throw new Error('unsupported traversal direction');
  if (types !== undefined && (!Array.isArray(types) || types.some(value => typeof value !== 'string'))) throw new Error('relationTypes must be an array');
  const links = new Map();
  for (const edge of [...ctx.edges.values()].sort((a, b) => compare(a.id, b.id))) {
    if (!inScope(edge, options.scope) || types && !types.includes(edge.type) || !inScope(ctx.objects.get(edge.from), options.scope) || !inScope(ctx.objects.get(edge.to), options.scope)) continue;
    const add = (from, to, reversed) => { const values = links.get(from) ?? []; values.push({ edge, to, reversed }); links.set(from, values); };
    if (direction !== 'incoming') add(edge.from, edge.to, false);
    if (direction !== 'outgoing') add(edge.to, edge.from, true);
  }
  return links;
}
export function traverse(graph, options = {}) {
  const ctx = context(graph, 'traverse', options), failure = coverageFailure(ctx); if (failure) return failure;
  if (!ctx.objects.has(options.start) || !inScope(ctx.objects.get(options.start), options.scope)) return result(ctx, null, true, graph.status === 'complete' ? 'no-match-in-declared-scope' : 'incomplete-source-coverage');
  const maxDepth = integer(options.maxDepth, 8, 100, 'maxDepth'), maxNodes = integer(options.maxNodes, 200, 10000, 'maxNodes');
  const links = adjacency(ctx, options), depths = new Map([[options.start, 0]]), edges = new Set(), frontier = new Set(), queue = [options.start]; let truncated = false;
  for (let index = 0; index < queue.length; index += 1) {
    const from = queue[index], depth = depths.get(from);
    for (const link of links.get(from) ?? []) {
      if (depth === maxDepth && !depths.has(link.to) || !depths.has(link.to) && depths.size === maxNodes) { truncated = true; frontier.add(link.to); continue; }
      edges.add(link.edge.id); if (!depths.has(link.to)) { depths.set(link.to, depth + 1); queue.push(link.to); }
    }
  }
  return result(ctx, { nodes: queue, edges: sorted(edges), depths: Object.fromEntries(depths), frontier: sorted(frontier) }, !truncated, truncated ? 'traversal-limit' : undefined);
}
function knownSet(ctx, options) {
  if (!Array.isArray(options.known ?? []) || !Array.isArray(options.earlier ?? [])) throw new Error('known/earlier must be arrays of explicit IDs');
  const values = [...(options.known ?? []), ...(options.earlier ?? [])];
  if (values.some(value => typeof value !== 'string' || !ctx.objects.has(value))) throw new Error('known/earlier IDs must belong to this public snapshot');
  return new Set(values);
}
function requirementGroups(ctx, target, options) {
  const semantics = options.prerequisiteRelations ?? [{ type: 'requires', direction: 'dependent-to-prerequisite' }];
  if (!Array.isArray(semantics) || semantics.some(item => !item || typeof item.type !== 'string' || !['dependent-to-prerequisite', 'prerequisite-to-dependent'].includes(item.direction))) throw new Error('explicit prerequisite relation semantics required');
  const cache = ctx.requirementCache ??= new Map(), cacheKey = JSON.stringify(semantics);
  if (cache.has(cacheKey)) return cache.get(cacheKey).get(target) ?? [];
  const targets = new Map();
  for (const edge of [...ctx.edges.values()].sort((a, b) => compare(a.id, b.id))) {
    // A view/domain filter cannot waive a selected record's hard requirements.
    const semantic = semantics.find(item => item.type === edge.type); if (!semantic) continue;
    const dependent = semantic.direction === 'dependent-to-prerequisite' ? edge.from : edge.to;
    const required = semantic.direction === 'dependent-to-prerequisite' ? edge.to : edge.from;
    const groups = targets.get(dependent) ?? new Map(); targets.set(dependent, groups);
    const supplied = edge.properties?.['prerequisite-group'];
    if (supplied !== undefined && (typeof supplied !== 'string' || !supplied.trim())) throw new Error('prerequisite-group must be a nonempty string');
    const key = supplied === undefined ? `edge:${edge.id}` : `group:${supplied}`, group = groups.get(key) ?? { dependent, group: supplied ?? null, alternatives: [], edges: [] };
    group.alternatives.push(required); group.edges.push(edge.id); groups.set(key, group);
  }
  const values = new Map([...targets].map(([id, groups]) => [id, [...groups.values()].map(group => ({ ...group, alternatives: sorted(group.alternatives), edges: sorted(group.edges) }))]));
  cache.set(cacheKey, values); return values.get(target) ?? [];
}
function requirementsMet(ctx, target, known, options) { return requirementGroups(ctx, target, options).every(group => group.alternatives.some(id => known.has(id))); }
export function prerequisites(graph, options = {}) {
  const ctx = context(graph, 'prerequisites', options);
  ctx.base.target = options.target;
  const failure = coverageFailure(ctx); if (failure) return failure;
  if (!ctx.objects.has(options.target) || !inScope(ctx.objects.get(options.target), options.scope)) return result(ctx, null, true, graph.status === 'complete' ? 'no-match-in-declared-scope' : 'incomplete-source-coverage');
  const known = knownSet(ctx, options), groups = [], cycles = [], visited = new Set(), maxNodes = integer(options.maxNodes, 200, 10000, 'maxNodes'); let truncated = false;
  // Schema uses a deterministic visited dependency walk. Explicit frames here
  // preserve this module's AND/OR group reporting order while making its node
  // bound independent of the JavaScript call stack. A visited node on the active
  // path is a cycle; a previously completed shared dependency is not.
  const frames = [], path = [], active = new Map();
  function enter(id) {
    if (known.has(id)) return;
    if (active.has(id)) { cycles.push([...path.slice(active.get(id)), id]); return; }
    if (visited.has(id)) return;
    if (visited.size === maxNodes) { truncated = true; return; } visited.add(id);
    active.set(id, path.length); path.push(id);
    frames.push({ id, groups: requirementGroups(ctx, id, options), groupIndex: 0, alternatives: [], alternativeIndex: 0 });
  }
  enter(options.target);
  while (frames.length) {
    const frame = frames[frames.length - 1];
    if (frame.alternativeIndex < frame.alternatives.length) { enter(frame.alternatives[frame.alternativeIndex++]); continue; }
    if (frame.groupIndex === frame.groups.length) {
      frames.pop(); path.pop(); active.delete(frame.id); continue;
    }
    const group = frame.groups[frame.groupIndex++], satisfied = group.alternatives.some(value => known.has(value));
    groups.push({ ...group, satisfied, missing: group.alternatives.filter(value => !known.has(value)) });
    frame.alternatives = satisfied ? [] : group.alternatives; frame.alternativeIndex = 0;
  }
  const observedSatisfied = known.has(options.target) || requirementsMet(ctx, options.target, known, options);
  return result(ctx, { groups, cycles, observedSatisfied, satisfied: graph.status !== 'complete' || truncated ? null : observedSatisfied }, !truncated,
    truncated ? 'prerequisite-limit' : graph.status !== 'complete' ? 'incomplete-source-coverage' : undefined);
}

class Heap {
  values = [];
  constructor(compareValues) { this.compare = compareValues; }
  push(value) { const a = this.values; a.push(value); let i = a.length - 1;
    while (i) { const parent = (i - 1) >> 1; if (this.compare(a[parent], value) <= 0) break; a[i] = a[parent]; i = parent; } a[i] = value; }
  pop() { const a = this.values, first = a[0], last = a.pop(); if (!a.length) return first; let i = 0;
    while (i * 2 + 1 < a.length) { let child = i * 2 + 1; if (child + 1 < a.length && this.compare(a[child + 1], a[child]) < 0) child += 1;
      if (this.compare(last, a[child]) <= 0) break; a[i] = a[child]; i = child; } a[i] = last; return first; }
  get size() { return this.values.length; }
}
function costMaps(ctx, options) {
  const edgeWeights = options.edgeWeights ?? {}, difficultyWeights = options.difficultyWeights ?? {};
  for (const [name, values, inventory] of [['edgeWeights', edgeWeights, ctx.edges], ['difficultyWeights', difficultyWeights, ctx.objects]]) {
    if (!values || typeof values !== 'object' || Array.isArray(values)) throw new Error(`${name} must be an ID/cost map`);
    for (const [id, value] of Object.entries(values)) { if (!inventory.has(id)) throw new Error(`${name} has an ID outside the snapshot`); nonnegative(value, name); }
  }
  return { edgeWeights, difficultyWeights, multiplier: nonnegative(options.difficultyMultiplier ?? 1, 'difficultyMultiplier'),
    defaultWeight: nonnegative(options.defaultEdgeWeight ?? 1, 'defaultEdgeWeight') };
}
/** Bounded stateful Dijkstra. maxStates limits retained/generated candidates as
 * well as expanded states; reaching a bound prevents an optimality claim.
 * Earlier planned steps satisfy requirements under
 * an explicit completion assumption; future steps never do. Partial snapshots
 * yield provisional routes rather than a global optimality claim. */
export function shortestPath(graph, options = {}) {
  const ctx = context(graph, 'shortest-path', options), failure = coverageFailure(ctx); if (failure) return failure;
  const start = options.start, goal = options.goal;
  if (![start, goal].every(id => ctx.objects.has(id) && inScope(ctx.objects.get(id), options.scope))) return result(ctx, null, true, graph.status === 'complete' ? 'no-match-in-declared-scope' : 'incomplete-source-coverage');
  const known = knownSet(ctx, options), maps = costMaps(ctx, options), links = adjacency(ctx, options);
  const maxStates = integer(options.maxStates, 5000, 100000, 'maxStates'), maxSteps = integer(options.maxSteps, 40, 200, 'maxSteps');
  if (!known.has(start) && !requirementsMet(ctx, start, known, options)) return result(ctx, null, true,
    graph.status === 'complete' ? 'start-prerequisites-unmet' : 'incomplete-source-coverage', { constraints: prerequisites(graph, { ...options, target: start }) });
  for (const items of links.values()) for (const { edge, to } of items) {
    nonnegative(Object.hasOwn(maps.edgeWeights, edge.id) ? maps.edgeWeights[edge.id] : edge.weight ?? maps.defaultWeight, 'edge weight');
    nonnegative(Object.hasOwn(maps.difficultyWeights, to) ? maps.difficultyWeights[to] : ctx.objects.get(to).properties?.difficulty ?? 0, 'node difficulty');
  }
  const assumptions = { direction: options.direction ?? 'outgoing', relationTypes: options.relationTypes ?? null,
    known: sorted(known), edgeWeights: copy(maps.edgeWeights), difficultyWeights: copy(maps.difficultyWeights), defaultEdgeWeight: maps.defaultWeight,
    difficultyMultiplier: maps.multiplier, costRule: 'edge cost plus entering-node difficulty; starting node cost excluded',
    plannedSteps: 'earlier planned steps must be completed before later steps', prerequisiteRelations: options.prerequisiteRelations ?? [{ type: 'requires', direction: 'dependent-to-prerequisite' }] };
  const initial = { node: start, nodes: [start], edges: [], costs: [], learned: new Set(known), cost: 0, signature: start };
  const queue = new Heap((a, b) => a.cost - b.cost || a.nodes.length - b.nodes.length || compare(a.signature, b.signature)); queue.push(initial);
  // Equal learned sets can have different remaining step budgets: a cheaper
  // longer prefix must not suppress a shorter feasible route to the goal.
  const stateKey = state => JSON.stringify([state.node, sorted(state.learned), state.nodes.length]);
  const best = new Map([[stateKey(initial), { cost: 0, length: 1, signature: start }]]);
  let visitedStates = 0, generatedStates = 1, truncated = false, found = null;
  while (queue.size) {
    if (visitedStates === maxStates) { truncated = true; break; }
    const state = queue.pop(), previous = best.get(stateKey(state));
    if (previous.cost !== state.cost || previous.length !== state.nodes.length || previous.signature !== state.signature) continue;
    visitedStates += 1;
    if (state.node === goal) { found = state; break; }
    if (state.nodes.length === maxSteps) { if ((links.get(state.node) ?? []).length) truncated = true; continue; }
    const learned = new Set([...state.learned, state.node]);
    for (const { edge, to, reversed } of links.get(state.node) ?? []) {
      if (!learned.has(to) && !requirementsMet(ctx, to, learned, options)) continue;
      const edgeCost = Object.hasOwn(maps.edgeWeights, edge.id) ? maps.edgeWeights[edge.id] : edge.weight ?? maps.defaultWeight;
      const baseDifficulty = Object.hasOwn(maps.difficultyWeights, to) ? maps.difficultyWeights[to] : ctx.objects.get(to).properties?.difficulty ?? 0;
      const difficulty = baseDifficulty * maps.multiplier, increment = edgeCost + difficulty, cost = state.cost + increment;
      nonnegative(cost, 'total route cost');
      const candidate = { node: to, nodes: [...state.nodes, to], edges: [...state.edges, edge.id], learned, cost,
        costs: [...state.costs, { edge: edge.id, edgeCost, difficulty, cost: increment, reversed }], signature: `${state.signature}\n${edge.id}\n${to}` };
      const key = stateKey(candidate), old = best.get(key);
      if (!old || cost < old.cost || cost === old.cost && (candidate.nodes.length < old.length || candidate.nodes.length === old.length && compare(candidate.signature, old.signature) < 0)) {
        if (generatedStates === maxStates) { truncated = true; continue; }
        generatedStates += 1; best.set(key, { cost, length: candidate.nodes.length, signature: candidate.signature }); queue.push(candidate);
      }
    }
  }
  const exhaustive = !truncated;
  const answer = found ? { nodes: found.nodes, edges: found.edges, cost: found.cost, costs: found.costs, assumptions,
    prerequisites: found.nodes.map((target, index) => ({ target, groups: requirementGroups(ctx, target, options), earlier: found.nodes.slice(0, index) })),
    optimal: graph.status === 'complete' && exhaustive } : null;
  return result(ctx, answer, exhaustive, truncated ? 'route-search-limit' : !found ? graph.status === 'complete' ? 'no-route-in-declared-scope' : 'incomplete-source-coverage' : graph.status !== 'complete' ? 'provisional-route' : undefined,
    { visitedStates, generatedStates, optimal: Boolean(answer?.optimal), ...(!found ? { constraints: prerequisites(graph, { ...options, target: goal }) } : {}) });
}

function viewQuery(value) {
  if (value === undefined) return { text: '', scope: null };
  if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.text !== 'string' || value.text.length > 10000 || /[\r\n]/.test(value.text) ||
      value.scope !== null && (typeof value.scope !== 'string' || !value.scope || value.scope.length > 10000 || /[\u0000-\u001f]/.test(value.scope))) throw new Error('invalid saved search/domain context');
  return { text: value.text, scope: value.scope };
}
function navigation(state) {
  if (!state || state.version !== QUERY_VERSION || typeof state.snapshotId !== 'string' || !Array.isArray(state.detours) || !Array.isArray(state.known) ||
      !state.knowledge || typeof state.knowledge !== 'object' || Array.isArray(state.knowledge)) throw new Error('invalid navigation state');
  const next = copy(state);
  next.viewQuery = viewQuery(next.viewQuery);
  next.detours = next.detours.map(frame => {
    if (!frame || typeof frame !== 'object' || Array.isArray(frame)) throw new Error('invalid saved detour frame');
    return { ...frame, viewQuery: viewQuery(frame.viewQuery) };
  });
  return next;
}
export function createNavigationState(graph, options = {}) {
  const ctx = context(graph, 'navigation', options), known = knownSet(ctx, options);
  if (options.selectedId !== undefined && options.selectedId !== null && !ctx.objects.has(options.selectedId)) throw new Error('selected ID must belong to this public snapshot');
  return { version: QUERY_VERSION, snapshotId: graph.snapshotId, route: null, selectedId: options.selectedId ?? null,
    known: sorted(known), knowledge: Object.fromEntries([...known].map(id => [id, 'known'])), detours: [], sourcePosition: null, focusKey: null, viewport: null,
    viewQuery: viewQuery(options.viewQuery) };
}
export function acceptRoute(state, proposal) {
  const next = navigation(state);
  if (!proposal || proposal.snapshotId !== next.snapshotId || proposal.version !== QUERY_VERSION || !proposal.answer || !Array.isArray(proposal.answer.nodes) || !proposal.answer.nodes.length) throw new Error('route must belong to this snapshot and query version');
  const route = copy(proposal.answer);
  route.index = 0; route.completed = []; route.status = proposal.status; route.requestedScope = proposal.requestedScope; route.needsReview = false;
  next.route = route; next.selectedId = route.nodes[0]; next.detours = []; return next;
}
export function beginDetour(state, options = {}) {
  const next = navigation(state);
  if (next.detours.length >= 50) throw new Error('nested detour limit reached');
  next.detours.push({ selectedId: next.selectedId, routeIndex: next.route?.index ?? null,
    sourcePosition: copy(options.returnPosition ?? next.sourcePosition), focusKey: options.returnFocusKey ?? next.focusKey, viewport: copy(options.returnViewport ?? next.viewport),
    viewQuery: viewQuery(options.returnViewQuery === undefined ? next.viewQuery : options.returnViewQuery) });
  next.selectedId = options.selectedId ?? null; next.sourcePosition = copy(options.sourcePosition ?? null);
  next.focusKey = options.focusKey ?? null; next.viewport = copy(options.viewport ?? next.viewport); next.viewQuery = viewQuery(options.viewQuery === undefined ? next.viewQuery : options.viewQuery); return next;
}
export function returnFromDetour(state) {
  const next = navigation(state), frame = next.detours.pop(); if (!frame) return next;
  next.selectedId = frame.selectedId; next.sourcePosition = frame.sourcePosition; next.focusKey = frame.focusKey; next.viewport = frame.viewport;
  next.viewQuery = viewQuery(frame.viewQuery);
  if (next.route && frame.routeIndex !== null) next.route.index = frame.routeIndex; return next;
}
export function advanceRoute(state, options = {}) {
  const next = navigation(state);
  if (!next.route) throw new Error('no accepted route');
  if (next.detours.length) throw new Error('return from exploration before advancing the accepted route');
  const current = next.route.nodes[next.route.index];
  if (options.completeCurrent !== false) { next.route.completed = sorted([...next.route.completed, current]); next.known = sorted([...next.known, current]); Object.defineProperty(next.knowledge, current, { value: 'known', writable: true, enumerable: true, configurable: true }); }
  if (next.route.index + 1 < next.route.nodes.length) next.route.index += 1;
  next.selectedId = next.route.nodes[next.route.index]; return next;
}
export function setKnowledge(state, id, value) {
  const next = navigation(state);
  if (typeof id !== 'string' || !['known', 'unknown', 'uncertain', 'unreported'].includes(value)) throw new Error('explicit reader knowledge state required');
  if (value === 'unreported') delete next.knowledge[id]; else Object.defineProperty(next.knowledge, id, { value, writable: true, enumerable: true, configurable: true });
  next.known = sorted(value === 'known' ? [...next.known, id] : next.known.filter(known => known !== id));
  if (next.route) next.route.needsReview = true; return next;
}
export function setKnown(state, id, value = true) { return setKnowledge(state, id, value ? 'known' : 'unknown'); }
export function restoreNavigationState(graph, saved) {
  validate(graph); const state = navigation(typeof saved === 'string' ? JSON.parse(saved) : saved);
  if (state.snapshotId !== graph.snapshotId) throw new Error('saved navigation snapshot changed; explicit replanning required');
  const ids = new Set(graph.objects.map(object => object.id)), edges = new Set(graph.relations.map(edge => edge.id));
  if (Object.entries(state.knowledge).some(([id, value]) => !ids.has(id) || !['known', 'unknown', 'uncertain', 'unreported'].includes(value)) ||
      state.known.some(id => typeof id !== 'string' || state.knowledge[id] !== 'known') ||
      Object.entries(state.knowledge).some(([id, value]) => value === 'known' && !state.known.includes(id))) throw new Error('invalid saved reader knowledge');
  if (state.difficultyWeights !== undefined && (!state.difficultyWeights || typeof state.difficultyWeights !== 'object' || Array.isArray(state.difficultyWeights) ||
      Object.entries(state.difficultyWeights).some(([id, value]) => !ids.has(id) || typeof value !== 'number' || !Number.isFinite(value) || value < 0))) throw new Error('invalid saved reader difficulty');
  const validPosition = value => value === null || value && [value.x, value.y].every(Number.isFinite);
  const validViewport = value => value === null || value && [value.x, value.y, value.scale].every(Number.isFinite) && value.scale >= .25 && value.scale <= 4;
  if (!validPosition(state.sourcePosition) || !validViewport(state.viewport) || state.focusKey !== null && typeof state.focusKey !== 'string' ||
      state.detours.some(frame => !frame || !validPosition(frame.sourcePosition) || !validViewport(frame.viewport) || frame.focusKey !== null && typeof frame.focusKey !== 'string' ||
        frame.routeIndex !== null && (!state.route || !Number.isInteger(frame.routeIndex) || frame.routeIndex < 0 || frame.routeIndex >= state.route.nodes.length))) throw new Error('invalid saved return position');
  if ([...state.known, ...(state.route?.nodes ?? []), ...state.detours.map(frame => frame.selectedId).filter(Boolean), state.selectedId].filter(Boolean).some(id => !ids.has(id)) ||
      (state.route?.edges ?? []).some(id => !edges.has(id)) || state.detours.length > 50) throw new Error('saved navigation contains unavailable IDs');
  if (state.route && (!Number.isInteger(state.route.index) || state.route.index < 0 || state.route.index >= state.route.nodes.length)) throw new Error('invalid saved route position');
  if (state.route) {
    const route = state.route, options = { ...route.assumptions, scope: route.requestedScope }, ctx = context(graph, 'restore-route', options);
    if (!route.assumptions || route.nodes.length > 200 || route.edges.length !== route.nodes.length - 1 || !Array.isArray(route.completed) || route.completed.some(id => !route.nodes.slice(0, route.index + 1).includes(id)) ||
        options.relationTypes !== null && options.relationTypes !== undefined && (!Array.isArray(options.relationTypes) || options.relationTypes.some(value => typeof value !== 'string'))) throw new Error('invalid saved route contract');
    if (!['complete', 'incomplete'].includes(route.status) || typeof route.optimal !== 'boolean' || typeof route.needsReview !== 'boolean' ||
        route.optimal !== (route.status === 'complete' && graph.status === 'complete') || graph.status === 'incomplete' && route.status !== 'incomplete' ||
        !Array.isArray(route.costs) || route.costs.length !== route.edges.length) throw new Error('invalid saved route summary');
    const maps = costMaps(ctx, options), known = knownSet(ctx, options); let cost = 0;
    if (!['outgoing', 'incoming', 'both'].includes(options.direction ?? 'outgoing') ||
        route.nodes.some(id => !inScope(ctx.objects.get(id), options.scope))) throw new Error('invalid saved route scope or direction');
    for (let index = 0; index < route.nodes.length; index += 1) {
      const id = route.nodes[index];
      if (!known.has(id) && !requirementsMet(ctx, id, known, options)) throw new Error('saved route violates its prerequisite assumptions');
      if (index) {
        const edge = ctx.edges.get(route.edges[index - 1]), previous = route.nodes[index - 1], direction = options.direction ?? 'outgoing';
        if (!inScope(edge, options.scope) || options.relationTypes && !options.relationTypes.includes(edge.type)) throw new Error('saved route uses a filtered relation');
        if (!(direction !== 'incoming' && edge.from === previous && edge.to === id || direction !== 'outgoing' && edge.to === previous && edge.from === id)) throw new Error('saved route has inconsistent directed steps');
        const edgeCost = Object.hasOwn(maps.edgeWeights, edge.id) ? maps.edgeWeights[edge.id] : edge.weight ?? maps.defaultWeight;
        const difficulty = (Object.hasOwn(maps.difficultyWeights, id) ? maps.difficultyWeights[id] : ctx.objects.get(id).properties?.difficulty ?? 0) * maps.multiplier;
        const summary = route.costs[index - 1], increment = nonnegative(edgeCost, 'saved edge cost') + nonnegative(difficulty, 'saved difficulty');
        const reversed = !(direction !== 'incoming' && edge.from === previous && edge.to === id);
        if (!summary || typeof summary !== 'object' || Array.isArray(summary) || summary.edge !== edge.id || summary.edgeCost !== edgeCost ||
            summary.difficulty !== difficulty || summary.cost !== increment || summary.reversed !== reversed ||
            Object.keys(summary).some(name => !['edge', 'edgeCost', 'difficulty', 'cost', 'reversed'].includes(name))) throw new Error('saved route cost summary differs from its recorded assumptions');
        cost += increment;
      }
      known.add(id);
    }
    if (!Number.isFinite(cost) || route.cost !== cost) throw new Error('saved route cost differs from its recorded assumptions');
  }
  return state;
}
