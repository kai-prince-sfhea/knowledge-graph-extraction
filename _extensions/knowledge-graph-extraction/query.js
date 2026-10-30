// Copyright 2026 Kai Prince. SPDX-License-Identifier: Apache-2.0
// See the accompanying LICENSE and COPYRIGHT files for terms and attribution.
/** Named queries over one coherent public snapshot. `scope` filters domains;
 * `requiredSources` checks source coverage. Reader choices never alter facts. */
export const QUERY_VERSION = 1;
/** Graph identity separates reader state; snapshot identity still validates it. */
export function navigationStorageKey(graphId = 'website') {
  if (typeof graphId !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(graphId) || ['constructor', 'prototype'].includes(graphId)) throw new Error('a safe graph identity is required for reader storage');
  return `quarto-public-graph-navigation-v1:${graphId}`;
}
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
  if (next.route.needsReview) throw new Error('review changed reader assumptions and explicitly accept a route before advancing');
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

// Extended named operations deliberately take explicit semantic mappings.
// A relation called "references" is not automatically evidence, and two
// concepts printed on one page are not automatically connected or learned.
function extendedOptions(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('named query options must be a mapping');
  const allowed = new Set(['scope', 'requiredSources', 'snapshotId', ...fields]);
  if (Object.keys(value).some(key => !allowed.has(key))) throw new Error('unsupported named query option');
  return value;
}
function stringList(value, name, optional = false) {
  if (value === undefined && optional) return undefined;
  if (!Array.isArray(value) || value.length > 1000 || value.some(item => typeof item !== 'string' || !item || item.length > 8192) || new Set(value).size !== value.length) throw new Error(`${name} must be a bounded list of distinct nonempty strings`);
  return value;
}
function relationSemantics(value, directions) {
  if (!Array.isArray(value) || !value.length || value.length > 32) throw new Error('explicit relation semantics are required');
  const seen = new Set();
  return value.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).some(key => !['type', 'direction'].includes(key)) || typeof item.type !== 'string' || !item.type || item.type.length > 128 || !directions.includes(item.direction) || seen.has(item.type)) throw new Error('relation semantics require distinct types and a supported explicit direction');
    seen.add(item.type); return { type: item.type, direction: item.direction };
  }).sort((a, b) => compare(a.type, b.type));
}
function selectedObjects(ctx, options) {
  const types = stringList(options.types, 'types', true);
  return [...ctx.objects.values()].filter(item => inScope(item, options.scope) && (!types || types.includes(item.type))).sort((a, b) => compare(a.id, b.id));
}
/** Iterative SCCs distinguish an actual cycle from a diamond/shared ancestor.
 * Only the already bounded, observed closure is inspected. */
function cyclicComponents(nodes, links) {
  const ids = [...nodes].sort(compare), forward = new Map(ids.map(id => [id, []])), reverse = new Map(ids.map(id => [id, []]));
  for (const { from, to } of links) if (forward.has(from) && forward.has(to)) { forward.get(from).push(to); reverse.get(to).push(from); }
  const seen = new Set(), order = [];
  for (const id of ids) if (!seen.has(id)) {
    seen.add(id); const stack = [{ id, next: 0 }];
    while (stack.length) { const frame = stack[stack.length - 1], adjacent = forward.get(frame.id);
      if (frame.next === adjacent.length) { order.push(frame.id); stack.pop(); continue; }
      const next = adjacent[frame.next++]; if (!seen.has(next)) { seen.add(next); stack.push({ id: next, next: 0 }); }
    }
  }
  seen.clear(); const result = [];
  for (const id of order.reverse()) if (!seen.has(id)) {
    const component = [], stack = [id]; seen.add(id);
    while (stack.length) { const current = stack.pop(); component.push(current); for (const next of reverse.get(current)) if (!seen.has(next)) { seen.add(next); stack.push(next); } }
    if (component.length > 1 || forward.get(id).includes(id)) result.push(component.sort(compare));
  }
  return result.sort((a, b) => compare(a[0], b[0]));
}
/** Ancestor/descendant closure under caller-declared hierarchy directions.
 * Missing fragments and reached bounds never establish global absence. */
export function hierarchyClosure(graph, options = {}) {
  extendedOptions(options, ['start', 'relations', 'direction', 'includeSelf', 'maxDepth', 'maxNodes', 'maxEdges']);
  const ctx = context(graph, 'hierarchy', options), failure = coverageFailure(ctx); if (failure) return failure;
  const semantics = relationSemantics(options.relations, ['child-to-parent', 'parent-to-child']);
  const direction = options.direction ?? 'ancestors';
  if (!['ancestors', 'descendants'].includes(direction) || options.includeSelf !== undefined && typeof options.includeSelf !== 'boolean') throw new Error('hierarchy direction/includeSelf is invalid');
  if (!ctx.objects.has(options.start) || !inScope(ctx.objects.get(options.start), options.scope)) return result(ctx, null, true, graph.status === 'complete' ? 'no-match-in-declared-scope' : 'incomplete-source-coverage');
  const maxDepth = integer(options.maxDepth, 8, 100, 'maxDepth'), maxNodes = integer(options.maxNodes, 200, 10000, 'maxNodes'), maxEdges = integer(options.maxEdges, 10000, 100000, 'maxEdges');
  const mapping = new Map(semantics.map(item => [item.type, item.direction])), adjacency = new Map(), ordered = [...ctx.edges.values()].sort((a, b) => compare(a.id, b.id));
  let truncated = ordered.length > maxEdges;
  for (const edge of ordered.slice(0, maxEdges)) {
    const sense = mapping.get(edge.type); if (!sense || !inScope(edge, options.scope) || !inScope(ctx.objects.get(edge.from), options.scope) || !inScope(ctx.objects.get(edge.to), options.scope)) continue;
    const child = sense === 'child-to-parent' ? edge.from : edge.to, parent = sense === 'child-to-parent' ? edge.to : edge.from;
    const from = direction === 'ancestors' ? child : parent, to = direction === 'ancestors' ? parent : child;
    const values = adjacency.get(from) ?? []; values.push({ edge: edge.id, from, to }); adjacency.set(from, values);
  }
  const queue = [options.start], depths = new Map([[options.start, 0]]), frontier = new Set(), observed = new Map();
  for (let index = 0; index < queue.length; index++) for (const link of adjacency.get(queue[index]) ?? []) {
    if (!depths.has(link.to)) {
      if (depths.get(link.from) === maxDepth || depths.size === maxNodes) { truncated = true; frontier.add(link.to); continue; }
      depths.set(link.to, depths.get(link.from) + 1); queue.push(link.to);
    }
    observed.set(link.edge, link);
  }
  const nodes = queue.filter(id => options.includeSelf === true || id !== options.start), links = [...observed.values()];
  const output = result(ctx, { nodes, edges: sorted(observed.keys()), depths: Object.fromEntries(nodes.map(id => [id, depths.get(id)])), frontier: sorted(frontier),
    cycles: cyclicComponents(depths.keys(), links), assumptions: { direction, relations: semantics, includeSelf: options.includeSelf === true, closure: 'within-requested-domain-and-loaded-public-snapshot' } }, !truncated, truncated ? 'hierarchy-limit' : undefined);
  if (!nodes.length && (truncated || graph.status !== 'complete')) output.status = 'unknown';
  return output;
}
/** Return explicitly mapped evidence associations, never a truth/support verdict.
 * Citation/reference edges participate only when the caller selects their type. */
export function evidenceLookup(graph, options = {}) {
  extendedOptions(options, ['target', 'relations', 'types', 'limit', 'maxEdges']);
  const ctx = context(graph, 'evidence', options), failure = coverageFailure(ctx); if (failure) return failure;
  const semantics = relationSemantics(options.relations, ['target-to-evidence', 'evidence-to-target']);
  const types = stringList(options.types, 'types', true), limit = integer(options.limit, 200, 10000, 'limit'), maxEdges = integer(options.maxEdges, 10000, 100000, 'maxEdges');
  if (!ctx.objects.has(options.target) || !inScope(ctx.objects.get(options.target), options.scope)) return result(ctx, null, true, graph.status === 'complete' ? 'no-match-in-declared-scope' : 'incomplete-source-coverage');
  const mappings = new Map(semantics.map(item => [item.type, item.direction])), ordered = [...ctx.edges.values()].sort((a, b) => compare(a.id, b.id)), associations = [];
  let truncated = ordered.length > maxEdges;
  for (const edge of ordered.slice(0, maxEdges)) {
    const direction = mappings.get(edge.type); if (!direction || !inScope(edge, options.scope)) continue;
    const target = direction === 'target-to-evidence' ? edge.from : edge.to, evidenceId = direction === 'target-to-evidence' ? edge.to : edge.from;
    const evidence = ctx.objects.get(evidenceId);
    if (target !== options.target || !inScope(evidence, options.scope) || types && !types.includes(evidence.type)) continue;
    if (associations.length === limit) { truncated = true; break; }
    associations.push({ evidence: copy(evidence), relation: copy(edge), direction,
      occurrences: copy(graph.occurrences.filter(item => item.target === evidenceId)) });
  }
  const output = result(ctx, { target: options.target, associations, assumptions: { relations: semantics, qualification: 'author-declared-association; no independent support or proof verdict' } }, !truncated, truncated ? 'evidence-limit' : undefined);
  if (!associations.length && (truncated || graph.status !== 'complete')) output.status = 'unknown';
  return output;
}
/** Counts are exact only on exhaustive complete coverage. Otherwise observed
 * values are lower bounds and the exact totals deliberately remain null. */
export function scopedCounts(graph, options = {}) {
  extendedOptions(options, ['types', 'relationTypes', 'maxRecords']);
  const ctx = context(graph, 'counts', options), failure = coverageFailure(ctx); if (failure) return failure;
  const types = stringList(options.types, 'types', true), relationTypes = stringList(options.relationTypes, 'relationTypes', true), maxRecords = integer(options.maxRecords, 100000, 1000000, 'maxRecords');
  const objects = [...ctx.objects.values()].sort((a, b) => compare(a.id, b.id)), edges = [...ctx.edges.values()].sort((a, b) => compare(a.id, b.id));
  const selected = new Set(), objectTypes = new Map(), objectScopes = new Map(), edgeTypes = new Map(), edgeScopes = new Map();
  const increment = (values, key) => values.set(key, (values.get(key) ?? 0) + 1);
  let scanned = 0, objectCount = 0, edgeCount = 0;
  for (const object of objects) { if (scanned === maxRecords) break; scanned++;
    if (!inScope(object, options.scope) || types && !types.includes(object.type)) continue;
    selected.add(object.id); objectCount++; increment(objectTypes, object.type); increment(objectScopes, object.scope);
  }
  for (const edge of edges) { if (scanned === maxRecords) break; scanned++;
    if (!selected.has(edge.from) || !selected.has(edge.to) || !inScope(edge, options.scope) || relationTypes && !relationTypes.includes(edge.type)) continue;
    edgeCount++; increment(edgeTypes, edge.type); increment(edgeScopes, edge.scope);
  }
  const exhaustive = scanned === objects.length + edges.length, exact = exhaustive && graph.status === 'complete';
  const groups = values => [...values].sort(([a], [b]) => compare(a, b)).map(([key, observed]) => ({ key, observed, value: exact ? observed : null }));
  return result(ctx, { exact, totals: exact ? { objects: objectCount, relations: edgeCount } : null, observed: { objects: objectCount, relations: edgeCount },
    objectsByType: groups(objectTypes), objectsByScope: groups(objectScopes), relationsByType: groups(edgeTypes), relationsByScope: groups(edgeScopes),
    assumptions: { relationEndpoints: 'both endpoints belong to selected objects', observedCounts: 'lower bounds unless exact is true' } }, exhaustive, !exhaustive ? 'count-limit' : graph.status !== 'complete' ? 'incomplete-source-coverage' : undefined, { scannedRecords: scanned });
}
function day(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, date] = value.split('-').map(Number), leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const length = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || date < 1 || date > length[month - 1]) return null;
  // setUTCFullYear avoids Date.UTC's special interpretation of years 00–99.
  const parsed = new Date(0); parsed.setUTCHours(0, 0, 0, 0); parsed.setUTCFullYear(year, month - 1, date); return parsed.getTime();
}
/** A day-level closed-interval filter, not OWL-Time, Allen/Prolog reasoning,
 * timezone inference, uncertain-date reasoning or an interpretation of Present.
 * Missing/unsupported values remain explicitly undetermined. */
export function filterByTime(graph, options = {}) {
  extendedOptions(options, ['fields', 'window', 'match', 'types', 'maxRecords']);
  const ctx = context(graph, 'time-filter', options), failure = coverageFailure(ctx); if (failure) return failure;
  const fields = options.fields, window = options.window;
  if (!fields || typeof fields !== 'object' || Array.isArray(fields) || Object.keys(fields).some(key => !['instant', 'start', 'end'].includes(key)) ||
      !(Object.keys(fields).length === 1 && typeof fields.instant === 'string' && fields.instant || Object.keys(fields).length === 2 && typeof fields.start === 'string' && fields.start && typeof fields.end === 'string' && fields.end) ||
      Object.values(fields).some(value => value.length > 128)) throw new Error('time fields require one instant property or explicit start/end properties');
  if (!window || typeof window !== 'object' || Array.isArray(window) || Object.keys(window).some(key => !['start', 'end'].includes(key)) || day(window.start) === null || day(window.end) === null || day(window.start) > day(window.end)) throw new Error('time window requires ordered valid YYYY-MM-DD start/end dates');
  const match = options.match ?? 'overlaps'; if (!['overlaps', 'contained', 'starts-within'].includes(match)) throw new Error('unsupported closed-interval time match');
  const maxRecords = integer(options.maxRecords, 10000, 100000, 'maxRecords'), objects = selectedObjects(ctx, options), matches = [], nonmatches = [], undetermined = [];
  for (const object of objects.slice(0, maxRecords)) {
    const rawStart = object.properties?.[fields.instant ?? fields.start], rawEnd = object.properties?.[fields.instant ?? fields.end];
    const start = day(rawStart), end = day(rawEnd);
    if (start === null || end === null || start > end) { undetermined.push({ id: object.id, reason: rawStart === undefined || rawEnd === undefined ? 'missing-time-property' : start === null || end === null ? 'unsupported-or-invalid-calendar-date' : 'reversed-time-interval' }); continue; }
    const low = day(window.start), high = day(window.end), accepted = match === 'overlaps' ? start <= high && end >= low : match === 'contained' ? start >= low && end <= high : start >= low && start <= high;
    if (accepted) matches.push(copy(object)); else nonmatches.push(object.id);
  }
  const enumerationComplete = objects.length <= maxRecords, exhaustive = enumerationComplete && !undetermined.length;
  const output = result(ctx, { matches, nonmatches, undetermined, enumerationComplete,
    unexaminedRecords: Math.max(0, objects.length - maxRecords), assumptions: { fields: { ...fields }, window: { ...window }, match, calendar: 'proleptic-Gregorian YYYY-MM-DD, closed inclusive day bounds; no inferred open or uncertain endpoints' } }, exhaustive,
    !enumerationComplete ? 'time-filter-limit' : undetermined.length ? 'undetermined-time-values' : graph.status !== 'complete' ? 'incomplete-source-coverage' : undefined);
  if (!matches.length && (!exhaustive || graph.status !== 'complete')) output.status = 'unknown';
  return output;
}
function pageName(value) {
  if (typeof value !== 'string' || !value || value.length > 8192 || value !== value.trim() || /[\u0000-\u001f\\?#]/.test(value) || value.startsWith('/') || /^[A-Za-z][A-Za-z\d+.-]*:/.test(value)) throw new Error('page must be a safe project-relative output URL without query or fragment');
  let decoded; try { decoded = decodeURIComponent(value); } catch { throw new Error('page URL has invalid encoding'); }
  if (/[\u0000-\u001f\\?#]/.test(decoded) || decoded.startsWith('/') || /^[A-Za-z][A-Za-z\d+.-]*:/.test(decoded) || decoded.split('/').some((part, index, parts) => !part && index !== parts.length - 1 || part === '.' || part === '..') || /%2f|%5c/i.test(value)) throw new Error('page URL contains an unsafe or ambiguous path');
  return new URL(value, 'https://quarto.invalid/').pathname.slice(1);
}
function pageInventory(ctx, options) {
  const maxRecords = integer(options.maxRecords, 100000, 1000000, 'maxRecords');
  const available = selectedObjects(ctx, options), records = available.slice(0, maxRecords), selected = new Set(records.map(record => record.id)), occurrences = new Map(), pages = new Map();
  const ordered = [...ctx.graph.occurrences].sort((a, b) => compare(`${a.target}\n${a.destination}\n${a.id ?? ''}`, `${b.target}\n${b.destination}\n${b.id ?? ''}`));
  let scanned = records.length;
  for (const occurrence of ordered) { if (scanned === maxRecords) break; scanned++;
    if (!ctx.objects.has(occurrence.target)) throw new Error('page occurrence has an unavailable semantic target');
    if (!selected.has(occurrence.target)) continue;
    if (typeof occurrence.destination !== 'string' || !occurrence.source || typeof occurrence.source.path !== 'string' || typeof occurrence.source.anchor !== 'string') throw new Error('page occurrence requires source/anchor and a destination');
    const split = occurrence.destination.indexOf('#'); if (split < 1) throw new Error('page occurrence requires an anchored output URL');
    const page = pageName(occurrence.destination.slice(0, split)); let anchor;
    try { anchor = decodeURIComponent(occurrence.destination.slice(split + 1)); } catch { throw new Error('page occurrence fragment has invalid encoding'); }
    if (anchor !== occurrence.source.anchor || !anchor) throw new Error('page occurrence fragment differs from its authored source anchor');
    const object = ctx.objects.get(occurrence.target), canonical = object.source?.path === occurrence.source.path && object.source?.anchor === occurrence.source.anchor;
    const entry = { record: occurrence.target, page, destination: occurrence.destination, source: copy(occurrence.source), canonical, ...(typeof occurrence.id === 'string' ? { occurrenceId: occurrence.id } : {}) };
    const values = occurrences.get(entry.record) ?? []; if (!values.some(value => value.destination === entry.destination && value.source.path === entry.source.path && value.source.anchor === entry.source.anchor)) values.push(entry); occurrences.set(entry.record, values);
    const members = pages.get(page) ?? new Set(); members.add(entry.record); pages.set(page, members);
  }
  for (const values of occurrences.values()) values.sort((a, b) => Number(b.canonical) - Number(a.canonical) || compare(a.destination, b.destination));
  return { records, occurrences, pages, unmapped: records.filter(record => !occurrences.has(record.id)).map(record => record.id), exhaustive: scanned === available.length + ordered.length, scanned };
}
/** Page identity comes only from admitted output occurrences, never a source
 * filename rewrite. Membership is not a semantic edge or evidence of learning. */
export function pageIndex(graph, options = {}) {
  extendedOptions(options, ['types', 'maxRecords']);
  const ctx = context(graph, 'page-index', options), failure = coverageFailure(ctx); if (failure) return failure;
  const index = pageInventory(ctx, options), exhaustive = index.exhaustive && !index.unmapped.length;
  const pages = [...index.pages].sort(([a], [b]) => compare(a, b)).map(([page, members]) => ({ id: page, url: page,
    records: [...members].sort(compare).map(id => ({ id, label: recordLabel(ctx.objects.get(id)), scope: ctx.objects.get(id).scope, occurrences: copy(index.occurrences.get(id).filter(item => item.page === page)) })) }));
  const output = result(ctx, { pages, unmappedRecords: index.unmapped, assumptions: { source: 'validated public output occurrences; no inferred directory/index aliases or page-wide knowledge' } }, exhaustive, !index.exhaustive ? 'page-index-limit' : index.unmapped.length ? 'page-mapping-incomplete' : undefined, { scannedRecords: index.scanned });
  if (!pages.length && (!exhaustive || graph.status !== 'complete')) output.status = 'unknown';
  return output;
}
/** Least semantic-cost route between records appearing on two chosen pages.
 * The page itinerary is a projection with a complete record/edge witness; it is
 * not a quotient-graph shortcut through unrelated co-resident records, nor a
 * claim to the fewest pages. One global pair/state budget bounds all searches. */
export function shortestPagePath(graph, options = {}) {
  extendedOptions(options, ['startPage', 'goalPage', 'startRecord', 'goalRecord', 'direction', 'relationTypes', 'known', 'earlier', 'edgeWeights', 'difficultyWeights', 'difficultyMultiplier', 'defaultEdgeWeight', 'prerequisiteRelations', 'maxStates', 'maxSteps', 'maxPairs', 'maxRecords']);
  const ctx = context(graph, 'shortest-page-path', options), failure = coverageFailure(ctx); if (failure) return failure;
  const startPage = pageName(options.startPage), goalPage = pageName(options.goalPage), index = pageInventory(ctx, options);
  if (!index.exhaustive || index.unmapped.length) return result(ctx, null, false, !index.exhaustive ? 'page-index-limit' : 'page-mapping-incomplete', { unmappedRecords: index.unmapped });
  const choose = (page, explicit) => { const ids = [...index.pages.get(page) ?? []].sort(compare); if (explicit !== undefined && (typeof explicit !== 'string' || !ids.includes(explicit))) throw new Error('explicit page endpoint record must have an occurrence on that page'); return explicit === undefined ? ids : [explicit]; };
  const starts = choose(startPage, options.startRecord), goals = choose(goalPage, options.goalRecord);
  if (!starts.length || !goals.length) return result(ctx, null, true, graph.status === 'complete' ? 'no-page-in-declared-scope' : 'incomplete-source-coverage');
  const maxStates = integer(options.maxStates, 5000, 100000, 'maxStates'), maxPairs = integer(options.maxPairs, 200, 10000, 'maxPairs');
  const { startPage: _startPage, goalPage: _goalPage, startRecord: _startRecord, goalRecord: _goalRecord, maxPairs: _maxPairs, maxRecords: _maxRecords, ...routeOptions } = options;
  let consumed = 0, attempted = 0, truncated = false, best = null;
  outer: for (const start of starts) for (const goal of goals) {
    if (attempted === maxPairs || consumed === maxStates) { truncated = true; break outer; }
    const candidate = shortestPath(graph, { ...routeOptions, start, goal, maxStates: maxStates - consumed }); attempted++;
    consumed += candidate.generatedStates ?? 0;
    if (!candidate.exhaustive) truncated = true;
    if (!candidate.answer) continue;
    if (!best || candidate.answer.cost < best.answer.cost || candidate.answer.cost === best.answer.cost && (candidate.answer.nodes.length < best.answer.nodes.length || candidate.answer.nodes.length === best.answer.nodes.length && compare(JSON.stringify(candidate.answer.nodes), JSON.stringify(best.answer.nodes)) < 0)) best = candidate;
  }
  if (!best) return result(ctx, null, !truncated, truncated ? 'page-route-search-limit' : graph.status === 'complete' ? 'no-page-route-in-declared-scope' : 'incomplete-source-coverage', { attemptedPairs: attempted, generatedStates: consumed });
  const witness = best.answer, chosen = witness.nodes.map((id, at) => {
    const values = index.occurrences.get(id), page = at === 0 ? startPage : at === witness.nodes.length - 1 ? goalPage : null;
    return values.find(value => page !== null && value.page === page) ?? values[0];
  });
  if (witness.nodes.length === 1 && startPage !== goalPage) chosen.push(index.occurrences.get(witness.nodes[0]).find(value => value.page === goalPage));
  const steps = [];
  chosen.forEach((entry, at) => {
    let step = steps[steps.length - 1]; if (!step || step.page !== entry.page) { step = { page: entry.page, records: [], occurrences: [], recordIndices: [] }; steps.push(step); }
    const recordIndex = Math.min(at, witness.nodes.length - 1); step.records.push(entry.record); step.occurrences.push(copy(entry)); step.recordIndices.push(recordIndex);
  });
  const exhaustive = !truncated, optimal = graph.status === 'complete' && exhaustive;
  const semanticRoute = copy(best); semanticRoute.answer.optimal = optimal; semanticRoute.optimal = optimal;
  if (!exhaustive) { semanticRoute.status = 'incomplete'; semanticRoute.exhaustive = false; semanticRoute.reason = 'page-route-search-limit'; }
  return result(ctx, { pages: steps.map(step => step.page), steps, cost: witness.cost, optimal,
    semanticNodes: [...witness.nodes], semanticEdges: [...witness.edges], costs: copy(witness.costs), prerequisites: copy(witness.prerequisites),
    transitions: witness.edges.map((id, at) => ({ relation: copy(ctx.edges.get(id)), from: copy(chosen[at]), to: copy(chosen[at + 1]), cost: copy(witness.costs[at]) })),
    ...(witness.nodes.length === 1 && chosen.length === 2 ? { occurrenceTransfer: { kind: 'same-semantic-record-different-source-occurrence', record: witness.nodes[0], from: copy(chosen[0]), to: copy(chosen[1]), semanticCost: 0 } } : {}),
    assumptions: { startPage, goalPage, startRecord: options.startRecord ?? null, goalRecord: options.goalRecord ?? null,
      objective: 'minimum semantic edge-plus-entering-record-difficulty cost across eligible endpoint records, not fewest pages',
      intermediateOccurrences: 'authored canonical occurrence when available, otherwise first stable admitted destination', pageCompletion: 'never implies all page records known' } }, exhaustive,
    truncated ? 'page-route-search-limit' : graph.status !== 'complete' ? 'provisional-page-route' : undefined,
    { semanticRoute, attemptedPairs: attempted, generatedStates: consumed, optimal });
}
