// Copyright 2026 Kai Prince. SPDX-License-Identifier: Apache-2.0
// See the accompanying LICENSE and COPYRIGHT files for terms and attribution.
import { recordLabel, createSemanticLabels, search, query, prerequisites, shortestPath, createNavigationState,
  acceptRoute, beginDetour, returnFromDetour, advanceRoute, setKnowledge, restoreNavigationState } from './query.js';

// All generated elements use textContent/attribute setters. No HTML evaluation,
// remote dependencies, model calls, or uploads occur in this optional view.
const root = document.querySelector('[data-kg-view]');
const find = selector => root.querySelector(selector);
const status = message => { find('#kg-status').textContent = message; };
const make = (tag, text, attributes = {}) => {
  const element = document.createElement(tag); if (text !== undefined) element.textContent = String(text);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, String(value));
  return element;
};
const button = (text, action) => { const element = make('button', text, { type: 'button' }); element.addEventListener('click', action); return element; };
const svgElement = (tag, attributes = {}) => {
  const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, String(value)); return element;
};
const label = recordLabel;
let semanticLabel;
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const key = 'quarto-public-graph-navigation-v1';
let graph, objects, state, candidate = null, persistent = false, viewport = { x: 0, y: 0, scale: 1 };
let storageConflict = false, storageEnabled = true;
const positions = new Map();
let visible = [], lastSearch = null;
function safeDestination(value) {
  try { const decoded = decodeURIComponent(value);
    return value === value.trim() && !decoded.trim().startsWith('/') && !/[\u0000-\u001f\\]/.test(decoded) && !/^[A-Za-z][A-Za-z\d+.-]*:/.test(decoded.trim()) &&
      !decoded.split('#')[0].split('/').some(part => part === '.' || part === '..') ? value : null;
  } catch { return null; }
}
function scope() { return find('[data-search]').elements.scope.value || undefined; }
function currentViewQuery() { return { text: find('[data-search]').elements.text.value, scope: scope() ?? null }; }
function restoreViewQuery() {
  const form = find('[data-search]'), query = state.viewQuery;
  form.elements.text.value = query.text;
  if (query.scope !== null && ![...form.elements.scope.options].some(option => option.value === query.scope)) form.elements.scope.append(make('option', `${query.scope} (no observed domain records)`, { value: query.scope }));
  form.elements.scope.value = query.scope ?? '';
}
function knowledge(id) { return Object.hasOwn(state.knowledge, id) ? state.knowledge[id] : 'unreported'; }
function serialize() {
  state.viewport = { ...viewport };
  return JSON.stringify({ state, viewport, positions: Object.fromEntries(positions), persistent });
}
function save() {
  if (storageConflict || !storageEnabled) return;
  try {
    const saved = serialize(); sessionStorage.setItem(key, saved);
    if (persistent) localStorage.setItem(key, saved);
    else localStorage.removeItem(key);
    find('[data-storage-note]').textContent = persistent ? 'Reader choices retained locally in this browser. No data is sent to a server.' : 'Reader choices retained for this tab/session, if storage is available. No data is sent to a server.';
  } catch { find('[data-storage-note]').textContent = 'Browser storage is unavailable. Your current route remains in memory; returning or reopening may not restore it.'; }
}
function readSaved() {
  try {
    const saved = sessionStorage.getItem(key) ?? localStorage.getItem(key); if (!saved) return;
    if (saved.length > 1_000_000) throw new Error('saved navigation exceeds the storage limit');
    const value = JSON.parse(saved); persistent = value.persistent === true; state = restoreNavigationState(graph, value.state);
    const view = value.viewport;
    if (view && [view.x, view.y, view.scale].every(Number.isFinite) && view.scale >= .25 && view.scale <= 4) viewport = view;
    for (const [id, point] of Object.entries(value.positions ?? {})) if (objects.has(id) && point && Number.isFinite(point.x) && Number.isFinite(point.y) && Math.abs(point.x) < 1e6 && Math.abs(point.y) < 1e6) positions.set(id, point);
    find('[data-persistent]').checked = persistent;
  } catch (error) { storageConflict = true;
    find('[data-storage-note]').textContent = `Saved navigation was not mixed into this snapshot: ${error.message}. It remains stored until you explicitly accept a new route or forget it.`; }
}
function searchList(capture = false) {
  const form = find('[data-search]');
  const nextQuery = currentViewQuery();
  if (nextQuery.text.length > 10000 || (nextQuery.scope?.length ?? 0) > 10000) throw new Error('search/domain context exceeds the saved-state limit');
  if (capture && state.route && !state.detours.length && (nextQuery.text !== state.viewQuery.text || nextQuery.scope !== state.viewQuery.scope)) {
    state = beginDetour(state, { selectedId: state.selectedId, viewQuery: nextQuery,
      returnPosition: { x: window.scrollX, y: window.scrollY }, returnFocusKey: document.activeElement?.dataset?.focusKey ?? null, returnViewport: { ...viewport } });
  }
  state.viewQuery = nextQuery;
  lastSearch = search(graph, { text: form.elements.text.value, scope: scope(), limit: 200 });
  visible = lastSearch.answer?.map(item => item.object) ?? [];
  find('[data-search-summary]').textContent = `${visible.length} observed matches shown; ${lastSearch.status}, ${lastSearch.exhaustive ? graph.status === 'complete' ? 'exhaustive within this source scope' : 'all matches within the observed records' : 'bounded candidates'}. ${graph.status !== 'complete' ? 'Missing records remain unknown because source coverage is incomplete.' : ''}`;
  find('[data-list-note]').textContent = 'Select and open sources through this list. Matching words keep their separate identifiers and declared domains.';
  const list = find('[data-results]'); list.replaceChildren();
  for (const object of visible) {
    const item = make('li'), select = button(semanticLabel(object), () => selectNode(object.id));
    select.dataset.focusKey = `select:${object.id}`; select.setAttribute('aria-pressed', String(state.selectedId === object.id));
    item.append(select, make('span', ` Type: ${object.type}`), make('br'), make('code', object.id)); list.append(item);
  }
  if (!visible.length) list.append(make('li', graph.status === 'complete' ? 'No matching public records in the declared source scope.' : 'No matching records were observed; incomplete coverage does not prove absence.'));
  draw();
}
function sources(id, container) {
  const occurrences = graph.occurrences.filter(item => item.target === id);
  const list = make('ul');
  for (const occurrence of occurrences) {
    const destination = safeDestination(occurrence.destination); if (!destination) continue;
    const link = make('a', `${semanticLabel(id)} — ${occurrence.source.path}#${occurrence.source.anchor}`, {
      href: root.dataset.sourcePrefix + destination, target: '_blank', rel: 'noopener' });
    list.append(make('li')); list.lastChild.append(link);
  }
  container.append(make('p', 'Source links open a separate tab, preserving this navigator and its accepted route.'), list);
}
function showRequirements(target, container, known = state.known, supplied = null) {
  const checked = supplied ?? prerequisites(graph, { target, known }), answer = checked.answer;
  if (!answer) { container.append(make('p', `Prerequisite information for ${semanticLabel(target)} is unavailable (${checked.reason ?? checked.status}).`)); return; }
  container.append(make('p', `Declared prerequisite check for ${semanticLabel(target)}: ${answer.satisfied === null ? 'unknown because source coverage or the bounded check is incomplete' : answer.satisfied ? 'satisfied by your reported knowledge' : 'observed requirements are not yet reported complete'}.`));
  if (!checked.exhaustive) container.append(make('p', 'Only the bounded observed prerequisite groups are shown; unvisited requirements remain unknown.'));
  const list = make('ul');
  for (const group of answer.groups) {
    const item = make('li', `${semanticLabel(group.dependent)}: ${group.group === null ? 'requires' : 'requires one of'} `);
    group.alternatives.forEach((id, index) => {
      if (index) item.append(document.createTextNode(' OR '));
      const control = button(semanticLabel(id), () => selectNode(id)); control.dataset.focusKey = `requirement:${target}:${group.dependent}:${group.group ?? group.edges.join('|')}:${id}`; item.append(control);
    });
    item.append(document.createTextNode(group.satisfied ? ' — reported satisfied' : ' — not yet reported satisfied')); list.append(item);
  }
  container.append(list);
  if (answer.cycles.length) container.append(make('p', 'A required branch contains a cycle. Cycles do not establish a valid starting point; an explicitly satisfied alternative can break a branch.', { class: 'kg-note' }));
}
function detail() {
  const target = find('[data-detail]'); target.replaceChildren();
  const object = objects.get(state.selectedId);
  if (!object) { target.append(make('p', 'Select a public record.')); return; }
  target.append(make('h3', label(object)), make('p', `${object.type}; ${object.scope}; author-declared`), make('code', object.id));
  sources(object.id, target);
  const row = make('div', undefined, { class: 'kg-controls' });
  row.append(button(`Use ${semanticLabel(object)} as start`, () => { find('[data-route-form]').elements.start.value = object.id; }), button(`Use ${semanticLabel(object)} as goal`, () => { find('[data-route-form]').elements.goal.value = object.id; }));
  const knowledgeLabel = make('label', 'My knowledge of this record '), control = make('select', undefined, { 'aria-label': 'My reported knowledge' });
  for (const [value, text] of [['unreported', 'Not reported'], ['known', 'Known to me'], ['uncertain', 'Uncertain'], ['unknown', 'Unknown to me']]) control.append(make('option', text, { value }));
  const requirementsBox = make('div');
  control.value = knowledge(object.id); control.addEventListener('change', () => { state = setKnowledge(state, object.id, control.value);
    candidate = null; candidateView(); requirementsBox.replaceChildren(); showRequirements(object.id, requirementsBox); routeView(); showStatus(); save(); });
  knowledgeLabel.append(control); row.append(knowledgeLabel); target.append(row);
  const difficultyLabel = make('label', 'My entering-node difficulty cost '), difficulty = make('input', undefined, { type: 'number', min: '0', step: '.25', value: String(state.difficultyWeights?.[object.id] ?? object.properties?.difficulty ?? 0) });
  difficulty.addEventListener('change', () => { const value = Number(difficulty.value);
    if (!Number.isFinite(value) || value < 0) { difficulty.setCustomValidity('Use a finite nonnegative cost.'); return; }
    difficulty.setCustomValidity(''); state.difficultyWeights ??= {}; Object.defineProperty(state.difficultyWeights, object.id, { value, writable: true, enumerable: true, configurable: true });
    candidate = null; candidateView(); if (state.route) state.route.needsReview = true; routeView(); save(); });
  difficultyLabel.append(difficulty); target.append(difficultyLabel);
  target.append(requirementsBox); showRequirements(object.id, requirementsBox);
  const neighbours = query(graph, 'neighbours', object.id).answer ?? [], list = make('ul');
  target.append(make('h3', 'Declared neighbours and backlinks'));
  for (const edge of neighbours) {
    const other = edge.from === object.id ? edge.to : edge.from;
    const item = make('li', `${edge.from === object.id ? 'Outgoing' : 'Incoming'} ${edge.type}: `);
    const control = button(semanticLabel(other), () => selectNode(other)); control.dataset.focusKey = `neighbour:${object.id}:${edge.id}:${other}`; item.append(control); list.append(item);
  }
  target.append(list);
}
function selectNode(id) {
  if (!objects.has(id)) return;
  if (state.route && id !== state.selectedId) {
    try { state = beginDetour(state, { selectedId: id,
      returnPosition: { x: window.scrollX, y: window.scrollY }, returnFocusKey: document.activeElement?.dataset?.focusKey ?? null,
      returnViewport: { ...viewport } }); }
    catch (error) { status(`Inspection refused: ${error.message}. Return from an exploration step to continue.`); return; }
  }
  else state.selectedId = id;
  detail(); routeView(); draw();
  showStatus(); save();
  find('#kg-detail-heading').focus();
}
function showStatus() { status(`${graph.status} source coverage. ${state.selectedId ? `Selected ${semanticLabel(state.selectedId)}. ` : ''}${state.detours.length ? `Exploration depth ${state.detours.length}; the accepted route remains paused.` : state.route ? 'An accepted route is selected.' : 'No route has been accepted.'}`); }
function candidateView() {
  const container = find('[data-candidate]'); container.replaceChildren();
  if (!candidate?.answer) { container.append(make('p', candidate?.status === 'unknown' ? `Route existence is unknown (${candidate.reason}).` : `No candidate found (${candidate?.reason ?? 'not computed'}).`));
    if (candidate?.constraints) {
      const constrained = candidate.constraints.target ?? (candidate.reason === 'start-prerequisites-unmet' ? find('[data-route-form]').elements.start.value : find('[data-route-form]').elements.goal.value);
      showRequirements(constrained, container, state.known, candidate.constraints);
    } return; }
  const answer = candidate.answer;
  container.append(make('h3', 'Candidate route'), make('p', `Cost ${answer.cost}; ${candidate.status}; ${answer.optimal ? 'minimum cost under the recorded assumptions' : 'provisional: no global minimum claim'}. ${candidate.reason ?? ''}`));
  container.append(make('p', `Snapshot ${candidate.snapshotId}; domain filter ${candidate.requestedScope ?? 'all'}; direction ${answer.assumptions.direction}; relation types ${answer.assumptions.relationTypes?.join(', ') ?? 'all'}; difficulty multiplier ${answer.assumptions.difficultyMultiplier}. Reported known IDs: ${answer.assumptions.known.join(', ') || 'none'}.`));
  const list = make('ol'); for (const id of answer.nodes) list.append(make('li', semanticLabel(id))); container.append(list);
  const costs = make('ul'); for (const item of answer.costs) costs.append(make('li', `${item.edge}: edge ${item.edgeCost} + entering difficulty ${item.difficulty} = ${item.cost}${item.reversed ? ' (edge followed in reverse)' : ''}`)); container.append(costs);
  container.append(make('p', answer.assumptions.plannedSteps));
  container.append(button('Accept this route explicitly', () => { state = acceptRoute(state, candidate); storageConflict = false; detail(); routeView(); draw(); showStatus(); save(); find('#kg-route-heading').focus(); }));
}
function routeView() {
  const container = find('[data-route]'); container.replaceChildren();
  find('[data-return]').hidden = !state.detours.length; find('[data-return-route]').hidden = !state.detours.length;
  find('[data-clear-route]').hidden = !state.route;
  if (!state.route) { container.append(make('p', 'Compute and explicitly accept a candidate to select a route.')); return; }
  const route = state.route;
  container.append(make('h3', `Accepted route — step ${route.index + 1}/${route.nodes.length}`), make('p', `Original cost ${route.cost}; ${route.status}; snapshot ${state.snapshotId}.`));
  if (route.needsReview) container.append(make('p', 'Reader assumptions changed. This accepted route was preserved; compute a new candidate and accept it explicitly to replace it.', { class: 'kg-note kg-warning' }));
  const list = make('ol'); route.nodes.forEach((id, index) => {
    const item = make('li', `${index === route.index ? 'Current: ' : ''}${semanticLabel(id)}${route.completed.includes(id) ? ' — marked complete' : ''}`);
    const control = button(`Inspect ${semanticLabel(id)}`, () => selectNode(id)); control.dataset.focusKey = `route:${index}:${id}`; item.append(document.createTextNode(' '), control); list.append(item);
  }); container.append(list);
  const complete = button(route.index + 1 === route.nodes.length ? 'Mark final step complete' : 'Mark current step complete and continue', () => {
    const nextId = route.nodes[route.index + 1], nextKnown = [...new Set([...state.known, route.nodes[route.index]])];
    if (nextId) {
      const checked = prerequisites(graph, { target: nextId, known: nextKnown });
      if (checked.answer?.satisfied !== true) { status('The next step has unmet or unknown prerequisites. Inspect them or accept a new plan; this route remains selected.'); return; }
    }
    state = advanceRoute(state); detail(); routeView(); draw(); showStatus(); save(); find('#kg-route-heading').focus();
  }); complete.disabled = Boolean(state.detours.length); container.append(complete);
  const current = route.nodes[route.index]; showRequirements(current, container);
}
function returnExploration(all) {
  do { state = returnFromDetour(state); } while (all && state.detours.length);
  if (state.viewport) viewport = { ...state.viewport };
  restoreViewQuery(); searchList(); detail(); routeView(); draw(); showStatus(); save();
  requestAnimationFrame(() => { if (state.sourcePosition) window.scrollTo(state.sourcePosition.x, state.sourcePosition.y);
    const focus = [...root.querySelectorAll('[data-focus-key]')].find(element => element.dataset.focusKey === state.focusKey); (focus ?? find('#kg-detail-heading')).focus({ preventScroll: true }); });
}
function draw() {
  // Route acceptance, advancement and nested returns change selection without
  // calling selectNode. Reflect the same state in every displayed source button.
  for (const element of find('[data-results]').querySelectorAll('button')) element.setAttribute('aria-pressed', String(element.dataset.focusKey === `select:${state.selectedId}`));
  const scene = find('[data-scene]'); scene.replaceChildren();
  const drawn = visible.slice(0, 120), ids = new Set(drawn.map(object => object.id));
  drawn.forEach((object, index) => { if (!positions.has(object.id)) positions.set(object.id, { x: 120 + index % 4 * 240, y: 70 + Math.floor(index / 4) * 130 }); });
  const routeEdges = new Set(state.route?.edges ?? []);
  for (const edge of graph.relations) if (ids.has(edge.from) && ids.has(edge.to)) {
    const from = positions.get(edge.from), to = positions.get(edge.to);
    const line = svgElement('line', { x1: from.x, y1: from.y, x2: to.x, y2: to.y, class: routeEdges.has(edge.id) ? 'kg-edge kg-route-edge' : 'kg-edge' });
    const title = svgElement('title'); title.textContent = `${edge.type}: ${semanticLabel(edge.from)} → ${semanticLabel(edge.to)}`; line.append(title); scene.append(line);
  }
  for (const object of drawn) {
    const point = positions.get(object.id), group = svgElement('g', { 'data-node': object.id, class: object.id === state.selectedId ? 'kg-node kg-selected' : 'kg-node', transform: `translate(${point.x} ${point.y})` });
    const short = value => { const characters = Array.from(String(value)); return characters.length > 18 ? `${characters.slice(0, 17).join('')}…` : characters.join(''); };
    group.append(svgElement('circle', { r: 19 })); const text = svgElement('text', { y: 39 }); text.textContent = short(label(object)); group.append(text);
    const domain = svgElement('text', { y: 56, class: 'kg-node-domain' }); domain.textContent = short(object.scope); group.append(domain);
    const title = svgElement('title'); title.textContent = semanticLabel(object); group.append(title); scene.append(group);
    // Bound actual SVG glyph width, including wide Unicode letters, so initial
    // labels remain within their grid cells. Full context stays in title/list.
    for (const element of [text, domain]) {
      const length = element.getComputedTextLength();
      if (length > 210) { element.setAttribute('textLength', '210'); element.setAttribute('lengthAdjust', 'spacingAndGlyphs'); }
    }
  }
  scene.setAttribute('transform', `translate(${viewport.x} ${viewport.y}) scale(${viewport.scale})`);
  if (visible.length > 120) find('[data-list-note]').textContent = 'The diagram shows the first 120 observed matches. The searchable list and static report provide the other records.';
}
function move(direction, node) {
  const [x, y] = { left: [-40, 0], right: [40, 0], up: [0, -40], down: [0, 40] }[direction];
  if (node) { const point = positions.get(state.selectedId); if (!point) { status('Select a visible node before arranging it.'); return; } point.x += x / viewport.scale; point.y += y / viewport.scale; }
  else { viewport.x += x; viewport.y += y; } draw(); save();
}
function diagramEvents() {
  const svg = find('[data-diagram]'); let drag = null;
  const point = event => { const matrix = svg.getScreenCTM(); if (!matrix) return null; return new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse()); };
  svg.addEventListener('pointerdown', event => { if (event.button !== 0) return; const at = point(event); if (!at) return;
    const id = event.target.closest('[data-node]')?.dataset.node;
    drag = { id, start: at, old: id ? { ...positions.get(id) } : { ...viewport }, moved: false };
    svg.setPointerCapture(event.pointerId); svg.classList.add('kg-dragging'); });
  svg.addEventListener('pointermove', event => { if (!drag) return; const at = point(event); if (!at) return;
    const dx = at.x - drag.start.x, dy = at.y - drag.start.y; if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
    if (drag.id) positions.set(drag.id, { x: drag.old.x + dx / viewport.scale, y: drag.old.y + dy / viewport.scale });
    else { viewport.x = drag.old.x + dx; viewport.y = drag.old.y + dy; } draw(); });
  const finish = event => { if (!drag) return; const previous = drag; drag = null; svg.classList.remove('kg-dragging');
    if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
    if (event.type === 'pointerup' && !previous.moved && previous.id) selectNode(previous.id); else save(); };
  svg.addEventListener('pointerup', finish); svg.addEventListener('pointercancel', finish);
}
async function initialize() {
  const url = new URL(root.dataset.graphUrl, document.baseURI);
  if (url.origin !== window.location.origin) throw new Error('graph data must be same-origin');
  const response = await fetch(url, { credentials: 'same-origin' }); if (!response.ok) throw new Error(`graph unavailable (${response.status})`);
  graph = await response.json(); if (graph.snapshotId !== root.dataset.snapshotId) throw new Error('graph snapshot differs from this page');
  state = createNavigationState(graph); objects = new Map(graph.objects.map(object => [object.id, object])); semanticLabel = createSemanticLabels(graph.objects);
  const domains = [...new Set(graph.objects.map(object => object.scope))].sort(compare);
  for (const domain of domains) find('[data-search]').elements.scope.append(make('option', domain, { value: domain }));
  for (const type of [...new Set(graph.relations.map(edge => edge.type))].sort(compare)) find('[data-route-form]').elements.relationTypes.append(make('option', type, { value: type }));
  for (const object of [...graph.objects].sort((a, b) => compare(a.id, b.id))) for (const name of ['start', 'goal']) find('[data-route-form]').elements[name].append(make('option', semanticLabel(object), { value: object.id }));
  readSaved(); restoreViewQuery(); find('[data-controls]').hidden = false;
  find('[data-search]').addEventListener('submit', event => { event.preventDefault();
    try { searchList(true); routeView(); showStatus(); status(`${find('[data-search-summary]').textContent} ${find('#kg-status').textContent}`); save(); }
    catch (error) { restoreViewQuery(); status(`Search refused: ${error.message}`); }
  });
  find('[data-route-form]').addEventListener('submit', event => { event.preventDefault(); const form = event.currentTarget;
    const relationTypes = [...form.elements.relationTypes.selectedOptions].map(option => option.value);
    try { candidate = shortestPath(graph, { start: form.elements.start.value, goal: form.elements.goal.value, direction: form.elements.direction.value, relationTypes: relationTypes.length ? relationTypes : undefined,
      scope: scope(), known: state.known, difficultyWeights: state.difficultyWeights ?? {}, difficultyMultiplier: Number(form.elements.difficulty.value), maxStates: 2000, maxSteps: 40 }); candidateView(); }
    catch (error) { status(`Candidate refused: ${error.message}`); } });
  find('[data-return]').addEventListener('click', () => returnExploration(false)); find('[data-return-route]').addEventListener('click', () => returnExploration(true));
  find('[data-clear-route]').addEventListener('click', () => { state.route = null; state.detours = []; routeView(); draw(); showStatus(); save(); });
  find('[data-persistent]').addEventListener('change', event => { persistent = event.currentTarget.checked; storageEnabled = true; save(); });
  find('[data-forget]').addEventListener('click', () => {
    try { sessionStorage.removeItem(key); localStorage.removeItem(key); storageConflict = false; storageEnabled = false; persistent = false;
      find('[data-persistent]').checked = false; find('[data-storage-note]').textContent = 'Stored reader choices forgotten; saving is paused until you enable retention. The current in-memory route remains selected.';
    } catch { find('[data-storage-note]').textContent = 'Browser storage could not be cleared here. Use browser site-data controls; the in-memory route remains selected.'; }
  });
  for (const element of root.querySelectorAll('[data-pan]')) element.addEventListener('click', () => move(element.dataset.pan, false));
  for (const element of root.querySelectorAll('[data-move]')) element.addEventListener('click', () => move(element.dataset.move, true));
  for (const element of root.querySelectorAll('[data-zoom]')) element.addEventListener('click', () => { viewport.scale = Math.max(.25, Math.min(4, viewport.scale * (element.dataset.zoom === 'in' ? 1.25 : .8))); draw(); save(); });
  find('[data-reset-view]').addEventListener('click', () => { viewport = { x: 0, y: 0, scale: 1 }; positions.clear(); draw(); save(); });
  diagramEvents(); searchList(); detail(); routeView(); showStatus();
  window.addEventListener('pagehide', save);
}
if (root) initialize().catch(error => status(`Interactive navigation is unavailable: ${error.message}. Use the static source list and report; no missing record has been treated as absent.`));
