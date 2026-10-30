// Copyright 2026 Kai Prince. SPDX-License-Identifier: Apache-2.0
// See the accompanying LICENSE and COPYRIGHT files for terms and attribution.
import { recordLabel, createSemanticLabels, search, query, prerequisites, shortestPath, shortestPagePath, pageIndex,
  hierarchyClosure, evidenceLookup, scopedCounts, filterByTime, createNavigationState,
  acceptRoute, beginDetour, returnFromDetour, advanceRoute, setKnowledge, restoreNavigationState, navigationStorageKey } from './query.js';
import { createForceSimulation } from './graph-force.js';
import { layoutGraphLabels } from './graph-label-layout.js';
import { openDelivery } from './delivery.js';
import { validateReadingRouteConfig, createReadingRouteStore, startReadingRoute, restoreReadingRoute, resumeReadingNavigator } from './reading-route.js';

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
let key = navigationStorageKey();
let graph, objects, state, queryProfiles = [], candidate = null, persistent = false, viewport = { x: 0, y: 0, scale: 1 };
let storageConflict = false, storageEnabled = true;
function forgetReadingJourney() {
  if (!readingConfig || !readingStore) return;
  const result = readingStore.forget(readingConfig);
  if (result.status !== 'forgotten') find('[data-storage-note]').textContent = 'The reading handoff could not be fully forgotten; clear this website’s browser data before reopening an older tab.';
}
let readingConfig = null, readingStore = null;
function wireSource(link) {
  link.addEventListener('click', async event => {
    if (!readingConfig || !state.route || event.button || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    try {
      await loadDetails();
      const journey = startReadingRoute(graph, readingConfig, {graphId: graph.graph?.id ?? 'website', state,
        context:{url:link.href,position:{x:0,y:0},focusId:null},
        navigatorContext:{position:{x:Math.max(0,window.scrollX),y:Math.max(0,window.scrollY)},focusKey:document.activeElement?.dataset?.focusKey??null},persistent});
      if (readingStore.write(readingConfig,journey).status !== 'saved') throw new Error('browser storage unavailable; the navigator remains open');
      save();
      if (root.dataset.sourceTarget === '_top') {
        try { window.top.dispatchEvent(new window.top.CustomEvent('quarto-kg-reading-route-updated')); } catch {}
        window.top.location.assign(link.href);
      } else window.location.assign(link.href);
    } catch (error) { status(`Reading route could not be retained: ${error.message}. Use the ordinary source link in a separate tab or enable browser storage.`); }
  }); return link;
}
let delivery = null, discovery = null, loadSequence = Promise.resolve();
function deliveryStatus() {
  const note = find('[data-delivery-status]'); if (!note || !delivery) return;
  const coverage = delivery.status(); note.textContent = `Complete discovery index; ${coverage.loadedParts} of ${coverage.requiredParts} detail parts verified. ${coverage.status === 'loaded' ? 'All declared graph details are loaded.' : 'Unloaded or unavailable details remain unknown.'}${coverage.reason ? ' A requested topic is unavailable; discovery remains searchable and other topics can be tried.' : ''}`;
}
async function loadDetails(domain) {
  if (!delivery) return;
  // Serialise UI loads so a slower previous selection cannot replace a newer
  // graph view. Verified immutable parts are retained by the delivery client.
  const task = loadSequence.then(async () => {
    const loaded = domain ? await delivery.loadScopes([domain]) : await delivery.loadAll();
    deliveryStatus(); if (!loaded.graph) throw new Error(loaded.reason ?? 'graph details unavailable');
    graph = loaded.graph; objects = new Map(graph.objects.map(object => [object.id, object]));
    semanticLabel = createSemanticLabels(discovery.objects); layoutKey = '';
    refreshRelationTypes();
    return graph;
  });
  loadSequence = task.catch(() => {}); return task;
}
function refreshRelationTypes() {
  const control = find('[data-route-form]').elements.relationTypes;
  const selected = new Set([...control.selectedOptions].map(option=>option.value));
  const types = [...new Set([...control.options].map(option=>option.value).concat(graph.relations.map(edge=>edge.type)))].sort(compare);
  control.replaceChildren();
  for (const type of types) { const option = make('option',type,{value:type}); option.selected=selected.has(type); control.append(option); }
}
const positions = new Map();
let visible = [], lastSearch = null;
let simulation, layoutKey = '', frame = null, lastFrame = null, hoverId = null, drag = null;
let nodeElements = new Map(), edgeElements = [], drawnObjects = [], drawnEdges = [], restoredViewport = false;
let viewSize = { width: 1000, height: 650 };
const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
let layoutPaused = motionPreference.matches || root.dataset.initialMotion === 'paused';
const forceOptions = { repulsion: Number(find('[data-force="repulsion"]').value), attraction: Number(find('[data-force="attraction"]').value) };
const labelMeasureContext = document.createElement('canvas').getContext('2d');
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
  // Velocity and temporary drag pins are never retained as reader choices.
  return JSON.stringify({ state, viewport, positions: Object.fromEntries([...positions].map(([id, point]) => [id, { x: point.x, y: point.y }])), persistent });
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
    if (view && [view.x, view.y, view.scale].every(Number.isFinite) && view.scale >= .25 && view.scale <= 4) { viewport = view; restoredViewport = true; }
    for (const [id, point] of Object.entries(value.positions ?? {})) if (objects.has(id) && point && Number.isFinite(point.x) && Number.isFinite(point.y) && Math.abs(point.x) < 1e6 && Math.abs(point.y) < 1e6) positions.set(id, { x: point.x, y: point.y });
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
  lastSearch = delivery ? delivery.search({ text: form.elements.text.value, scope: scope(), limit: 200 }) : search(graph, { text: form.elements.text.value, scope: scope(), limit: 200 });
  visible = lastSearch.answer?.map(item => item.object) ?? [];
  find('[data-search-summary]').textContent = `${visible.length} observed matches shown; ${lastSearch.status}, ${lastSearch.exhaustive ? discovery?.status === 'complete' || graph.status === 'complete' ? 'exhaustive within this source scope' : 'all matches within the observed records' : 'bounded candidates'}. ${delivery ? 'Discovery covers the declared public index; record details and relations load on request.' : graph.status !== 'complete' ? 'Missing records remain unknown because source coverage is incomplete.' : ''}`;
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
      href: root.dataset.sourcePrefix + destination, target: root.dataset.sourceTarget === '_top' ? '_top' : '_blank', rel: 'noopener' });
    list.append(make('li')); list.lastChild.append(wireSource(link));
  }
  container.append(make('p', readingConfig && state.route ? 'Open a source to continue your accepted reading route on that page. Concepts are completed only through an explicit action; ordinary new-tab browser controls remain available.' : root.dataset.sourceTarget === '_top' ? 'Source links open in the containing page. Reader choices remain local to this graph when browser storage is available.' : 'Source links open a separate tab, preserving this navigator and its accepted route.'), list);
}
function sourceLink(destination, text) {
  const safe = safeDestination(destination);
  return safe ? wireSource(make('a', text, { href: root.dataset.sourcePrefix + safe,
    target: root.dataset.sourceTarget === '_top' ? '_top' : '_blank', rel: 'noopener' })) : make('span', text);
}
function queryRecord(id, description = '') {
  const item = make('li'), inspect = button(semanticLabel(id), () => selectNode(id));
  item.append(inspect, document.createTextNode(description));
  const occurrence = graph.occurrences.find(entry => entry.target === id && safeDestination(entry.destination));
  if (occurrence) item.append(document.createTextNode(' — '), sourceLink(occurrence.destination, `Open source ${occurrence.source.path}#${occurrence.source.anchor}`));
  return item;
}
function queryProfile() {
  const value = find('[data-query-form]').elements.profile.value;
  return value.startsWith('profile:') ? queryProfiles.find(profile => `profile:${profile.id}` === value) : null;
}
function queryControls() {
  const time = queryProfile()?.operation === 'time-filter', window = find('[data-time-window]');
  window.hidden = !time; window.disabled = !time;
  find('[data-query-status]').textContent = 'Question changed; run it explicitly to replace the result below. Reader knowledge and the accepted route are unchanged.';
}
async function runQuestion() {
  await loadDetails();
  const form = find('[data-query-form]'), profile = queryProfile(), common = { scope: scope() };
  let answer;
  if (form.elements.profile.value === 'counts') answer = scopedCounts(graph, common);
  else if (form.elements.profile.value === 'pages') answer = pageIndex(graph, common);
  else if (!profile) throw new Error('choose a question declared by this graph');
  else if (profile.operation === 'hierarchy' || profile.operation === 'evidence') {
    if (!state.selectedId) throw new Error('select a record before running a hierarchy or evidence question');
    answer = profile.operation === 'hierarchy'
      ? hierarchyClosure(graph, { ...common, start: state.selectedId, relations: profile.relations, direction: profile.direction, maxNodes: 200, maxDepth: 8, maxEdges: 10000 })
      : evidenceLookup(graph, { ...common, target: state.selectedId, relations: profile.relations, types: profile.types, limit: 200, maxEdges: 10000 });
  } else answer = filterByTime(graph, { ...common, fields: profile.fields, types: profile.types, match: profile.match,
    window: { start: form.elements.windowStart.value, end: form.elements.windowEnd.value }, maxRecords: 10000 });
  const container = find('[data-query-result]'); container.replaceChildren();
  find('[data-query-status]').textContent = `${form.elements.profile.selectedOptions[0].textContent}: ${answer.status}; ${answer.exhaustive ? 'all observed records considered within the question scope' : 'bounded or undetermined results'}. Domain: ${answer.requestedScope ?? 'all'}. Snapshot: ${answer.snapshotId}. ${answer.reason ?? ''}${answer.status === 'complete' ? '' : ' Missing or undetermined records do not establish absence.'}`;
  if (!answer.answer) { container.append(make('p', `The question could not be answered (${answer.reason ?? answer.status}).`)); return; }
  const value = answer.answer;
  if (answer.operation === 'counts') {
    container.append(make('p', value.exact ? `Exact totals in the declared scope: ${value.totals.objects} records and ${value.totals.relations} relations.` : `Observed lower bounds: ${value.observed.objects} records and ${value.observed.relations} relations. Exact totals are unknown.`));
    for (const [title, values] of [['Records by type', value.objectsByType], ['Records by domain', value.objectsByScope], ['Relations by type', value.relationsByType], ['Relations by domain', value.relationsByScope]]) {
      const table = make('table'), head = make('thead'), row = make('tr'), body = make('tbody');
      table.append(make('caption', title)); row.append(make('th', 'Declared group', { scope: 'col' }), make('th', value.exact ? 'Count' : 'Observed lower bound', { scope: 'col' })); head.append(row);
      for (const group of values) { const row = make('tr'); row.append(make('th', group.key, { scope: 'row' }), make('td', group.observed)); body.append(row); }
      table.append(head, body); container.append(table);
    }
  } else if (answer.operation === 'page-index') {
    const list = make('ul'); for (const page of value.pages.slice(0, 200)) {
      const item = make('li'); item.append(sourceLink(page.url, page.url), document.createTextNode(` — ${page.records.length} observed records`)); list.append(item);
    } container.append(list);
    if (value.pages.length > 200) container.append(make('p', `Showing the first 200 of ${value.pages.length} observed pages.`));
    if (value.unmappedRecords.length) container.append(make('p', `${value.unmappedRecords.length} records have no admitted output-page mapping; these records remain unknown to page routing.`));
  } else if (answer.operation === 'hierarchy') {
    container.append(make('p', `${profile.direction} of ${semanticLabel(state.selectedId)} under the explicitly declared relation directions.`));
    const list = make('ul'); for (const id of value.nodes) list.append(queryRecord(id, ` — ${value.depths[id]} hierarchy steps`)); container.append(list);
    if (value.cycles.length) container.append(make('p', `${value.cycles.length} observed hierarchy cycles; a cycle does not establish a valid foundational order.`, { class: 'kg-note' }));
    if (value.frontier.length) container.append(make('p', `${value.frontier.length} frontier records were not expanded because a bound was reached.`));
  } else if (answer.operation === 'evidence') {
    container.append(make('p', `Author-declared associations for ${semanticLabel(value.target)}. These do not independently verify the record.`));
    const list = make('ul'); for (const association of value.associations) list.append(queryRecord(association.evidence.id, ` — ${association.relation.type}; ${association.direction}; relation ${association.relation.id}`)); container.append(list);
  } else if (answer.operation === 'time-filter') {
    container.append(make('p', `Closed inclusive window ${value.assumptions.window.start} through ${value.assumptions.window.end}; ${value.assumptions.match}. ${value.matches.length} observed matches; ${value.nonmatches.length} determined nonmatches; ${value.undetermined.length} undetermined records; ${value.unexaminedRecords} unexamined records.`));
    const list = make('ul'); for (const record of value.matches.slice(0, 200)) list.append(queryRecord(record.id)); container.append(list);
    if (value.matches.length > 200) container.append(make('p', `Showing the first 200 of ${value.matches.length} observed matches.`));
    if (value.undetermined.length) {
      container.append(make('h3', 'Undetermined dates')); const unknown = make('ul');
      for (const record of value.undetermined.slice(0, 200)) unknown.append(queryRecord(record.id, ` — ${record.reason}`)); container.append(unknown);
      if (value.undetermined.length > 200) container.append(make('p', `Showing the first 200 of ${value.undetermined.length} undetermined records.`));
    }
  }
}
function routeEndpoints() {
  const form = find('[data-route-form]'), pageMode = form.elements.mode.value === 'pages';
  const indexed = pageMode ? pageIndex(graph, { scope: scope() }) : null;
  const endpoints = pageMode ? (indexed.answer?.pages ?? []).map(page => ({ id: page.id, label: `${page.url} (${page.records.length} observed records)` }))
    : [...(discovery?.objects ?? graph.objects)].sort((a, b) => compare(a.id, b.id)).map(object => ({ id: object.id, label: semanticLabel(object) }));
  for (const name of ['start', 'goal']) {
    const control = form.elements[name], previous = control.value; control.replaceChildren();
    for (const endpoint of endpoints) control.append(make('option', endpoint.label, { value: endpoint.id }));
    if (endpoints.some(endpoint => endpoint.id === previous)) control.value = previous;
  }
  if (indexed && (indexed.status !== 'complete' || !indexed.exhaustive)) status(`Page endpoints: ${indexed.status}; ${indexed.reason ?? 'incomplete source coverage'}. Observed pages are available, but missing mappings cannot establish a route.`);
}
function useRecordEndpoint(name, id) {
  const form = find('[data-route-form]');
  if (form.elements.mode.value !== 'records') { form.elements.mode.value = 'records'; routeEndpoints(); }
  form.elements[name].value = id;
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
  row.append(button(`Use ${semanticLabel(object)} as start`, () => useRecordEndpoint('start', object.id)), button(`Use ${semanticLabel(object)} as goal`, () => useRecordEndpoint('goal', object.id)));
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
async function selectNode(id) {
  if (delivery) {
    const row = discovery.objects.find(object => object.id === id); if (!row) return;
    try { await loadDetails(row.scope); } catch (error) { status(`Details unavailable: ${error.message}. Missing prerequisites remain unknown.`); return; }
  }
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
function showStatus() { status(`${discovery?.status ?? graph.status} source coverage.${delivery ? ` ${graph.status === 'complete' ? 'All' : 'Partial'} graph details loaded.` : ''} ${state.selectedId ? `Selected ${semanticLabel(state.selectedId)}. ` : ''}${state.detours.length ? `Exploration depth ${state.detours.length}; the accepted route remains paused.` : state.route ? 'An accepted route is selected.' : 'No route has been accepted.'}`); }
function candidateView() {
  const container = find('[data-candidate]'); container.replaceChildren();
  if (!candidate?.answer) { container.append(make('p', candidate?.status === 'unknown' ? `Route existence is unknown (${candidate.reason}).` : `No candidate found (${candidate?.reason ?? 'not computed'}).`));
    if (candidate?.constraints) {
      const constrained = candidate.constraints.target ?? (candidate.reason === 'start-prerequisites-unmet' ? find('[data-route-form]').elements.start.value : find('[data-route-form]').elements.goal.value);
      showRequirements(constrained, container, state.known, candidate.constraints);
    } return; }
  const semantic = candidate.semanticRoute ?? candidate, answer = semantic.answer;
  container.append(make('h3', candidate.semanticRoute ? 'Candidate page route with semantic witness' : 'Candidate route'), make('p', `Cost ${answer.cost}; ${candidate.status}; ${candidate.answer.optimal ? 'minimum cost under the recorded assumptions' : 'provisional: no global minimum claim'}. ${candidate.reason ?? ''}`));
  if (candidate.semanticRoute) {
    container.append(make('p', `${candidate.answer.assumptions.objective}. Each page step retains its source occurrences and semantic records. Accepting the route does not mark every record on a page as known.`));
    const itinerary = make('ol'); for (const step of candidate.answer.steps) {
      const item = make('li'); item.append(sourceLink(step.page, step.page));
      const occurrences = make('ul'); for (const entry of step.occurrences) { const occurrence = make('li'); occurrence.append(sourceLink(entry.destination, `${semanticLabel(entry.record)} — ${entry.source.path}#${entry.source.anchor}`)); occurrences.append(occurrence); }
      item.append(occurrences); itinerary.append(item);
    } container.append(itinerary, make('h4', 'Semantic record steps retained for prerequisites and completion'));
    if (candidate.answer.occurrenceTransfer) container.append(make('p', 'Both pages contain the same semantic record. This zero-cost source-occurrence transfer does not invent a semantic relation.'));
  }
  container.append(make('p', `Snapshot ${candidate.snapshotId}; domain filter ${candidate.requestedScope ?? 'all'}; direction ${answer.assumptions.direction}; relation types ${answer.assumptions.relationTypes?.join(', ') ?? 'all'}; difficulty multiplier ${answer.assumptions.difficultyMultiplier}. Reported known IDs: ${answer.assumptions.known.join(', ') || 'none'}.`));
  const list = make('ol'); for (const id of answer.nodes) list.append(make('li', semanticLabel(id))); container.append(list);
  const costs = make('ul'); for (const item of answer.costs) costs.append(make('li', `${item.edge}: edge ${item.edgeCost} + entering difficulty ${item.difficulty} = ${item.cost}${item.reversed ? ' (edge followed in reverse)' : ''}`)); container.append(costs);
  container.append(make('p', answer.assumptions.plannedSteps));
  container.append(button('Accept this route explicitly', () => { state = acceptRoute(state, semantic); forgetReadingJourney(); storageConflict = false; detail(); routeView(); draw(); showStatus(); save(); find('#kg-route-heading').focus(); }));
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
    if (state.route.needsReview) { status('Reader assumptions changed. Review and explicitly accept a current route before continuing.'); return; }
    const nextId = route.nodes[route.index + 1], nextKnown = [...new Set([...state.known, route.nodes[route.index]])];
    if (nextId) {
      const checked = prerequisites(graph, { target: nextId, known: nextKnown });
      if (checked.answer?.satisfied !== true) { status('The next step has unmet or unknown prerequisites. Inspect them or accept a new plan; this route remains selected.'); return; }
    }
    state = advanceRoute(state); detail(); routeView(); draw(); showStatus(); save(); find('#kg-route-heading').focus();
  }); complete.disabled = Boolean(state.detours.length || state.route.needsReview); container.append(complete);
  const current = route.nodes[route.index]; showRequirements(current, container);
}
function returnExploration(all) {
  do { state = returnFromDetour(state); } while (all && state.detours.length);
  if (state.viewport) { viewport = { ...state.viewport }; restoredViewport = true; }
  restoreViewQuery(); searchList(); detail(); routeView(); draw(); showStatus(); save();
  requestAnimationFrame(() => { if (state.sourcePosition) window.scrollTo(state.sourcePosition.x, state.sourcePosition.y);
    const focus = [...root.querySelectorAll('[data-focus-key]')].find(element => element.dataset.focusKey === state.focusKey); (focus ?? find('#kg-detail-heading')).focus({ preventScroll: true }); });
}
function draw() {
  // Route acceptance, advancement and nested returns change selection without
  // calling selectNode. Reflect the same state in every displayed source button.
  for (const element of find('[data-results]').querySelectorAll('button')) element.setAttribute('aria-pressed', String(element.dataset.focusKey === `select:${state.selectedId}`));
  prepareDiagram();
  paintDiagram();
}
function layoutStatus() {
  const settled = simulation?.isSettled() ?? true;
  find('[data-simulation-toggle]').textContent = layoutPaused || settled ? 'Resume layout' : 'Pause layout';
  find('[data-simulation-state]').dataset.state = layoutPaused ? 'paused' : settled ? 'settled' : 'running';
  find('[data-simulation-state]').textContent = layoutPaused
    ? motionPreference.matches ? 'Layout paused. Reduced motion is preferred; resume only if you want animation.' : 'Layout paused. You can still select, pan, zoom and arrange nodes.'
    : settled ? 'Layout settled. Drag a node or resume to let the forces arrange it again.' : 'Layout running. Links attract connected nodes; the fast multipole calculation repels nearby and distant nodes.';
}
function animate(now) {
  frame = null;
  if (layoutPaused || !simulation) { lastFrame = null; return; }
  const dt = lastFrame === null ? 1 : Math.max(.05, Math.min(2, (now - lastFrame) / (1000 / 60)));
  lastFrame = now;
  const result = simulation.step(dt);
  paintDiagram();
  if (!result.settled) frame = requestAnimationFrame(animate);
  else { lastFrame = null; layoutStatus(); save(); }
}
function wakeLayout(alpha = .7) {
  simulation?.reheat(alpha);
  layoutStatus();
  if (!layoutPaused && simulation && frame === null) frame = requestAnimationFrame(animate);
}
function fitView() {
  if (!drawnObjects.length) { viewport = { x: viewSize.width / 2, y: viewSize.height / 2, scale: 1 }; return; }
  const points = drawnObjects.map(object => positions.get(object.id));
  const minX = Math.min(...points.map(point => point.x)), maxX = Math.max(...points.map(point => point.x));
  const minY = Math.min(...points.map(point => point.y)), maxY = Math.max(...points.map(point => point.y));
  const scale = Math.max(.25, Math.min(2, (viewSize.width - 90) / Math.max(100, maxX - minX), (viewSize.height - 90) / Math.max(100, maxY - minY)));
  viewport = { x: viewSize.width / 2 - (minX + maxX) / 2 * scale, y: viewSize.height / 2 - (minY + maxY) / 2 * scale, scale };
}
function prepareDiagram() {
  const drawn = visible.slice(0, 120), ids = new Set(drawn.map(object => object.id));
  const nextKey = drawn.map(object => object.id).join('\u0000');
  if (nextKey === layoutKey && simulation) return;
  layoutKey = nextKey; drawnObjects = drawn;
  drawnEdges = graph.relations.filter(edge => ids.has(edge.from) && ids.has(edge.to));
  const nodes = drawn.map(object => ({ id: object.id, ...positions.get(object.id) }));
  if (simulation) simulation.setNodes(nodes, drawnEdges);
  else simulation = createForceSimulation(nodes, drawnEdges, forceOptions);
  for (const object of drawn) positions.set(object.id, simulation.positions.get(object.id));
  // Arrange a bounded static starting frame before showing motion. Reduced
  // motion readers receive this same layout without an animation loop.
  for (let index = 0; index < 70 && !simulation.isSettled(); index++) simulation.step(1);
  if (!restoredViewport) fitView();
  const scene = find('[data-scene]'); scene.replaceChildren();
  nodeElements = new Map(); edgeElements = [];
  const types = [...new Set(graph.objects.map(object => object.type))].sort(compare);
  const legend = find('[data-type-legend]'); legend.replaceChildren();
  for (const [index, type] of types.entries()) if (drawn.some(object => object.type === type)) legend.append(make('li', type, { class: `kg-type-${index % 12}` }));
  const degrees = new Map();
  for (const edge of drawnEdges) { degrees.set(edge.from, (degrees.get(edge.from) ?? 0) + 1); degrees.set(edge.to, (degrees.get(edge.to) ?? 0) + 1); }
  for (const edge of drawnEdges) {
    const line = svgElement('line', { class: 'kg-edge', 'vector-effect': 'non-scaling-stroke' });
    const title = svgElement('title'); title.textContent = `${edge.type}: ${semanticLabel(edge.from)} → ${semanticLabel(edge.to)}`;
    line.append(title); scene.append(line); edgeElements.push({ edge, line });
  }
  for (const object of drawn) {
    const group = svgElement('g', { 'data-node': object.id, class: 'kg-node' });
    const hit = svgElement('rect', { class: 'kg-node-hit' });
    const circle = svgElement('circle', { 'vector-effect': 'non-scaling-stroke' });
    const text = svgElement('text', { class: 'kg-node-label', 'font-size': 12, 'vector-effect': 'non-scaling-stroke' });
    const title = svgElement('title'); title.textContent = `${semanticLabel(object)}; type ${object.type}`;
    group.append(hit, circle, text, title); scene.append(group);
    nodeElements.set(object.id, { object, group, hit, circle, text, color: types.indexOf(object.type) % 12, radius: 7 + Math.min(6, Math.sqrt(degrees.get(object.id) ?? 0) * 1.5), fontState: null, measurements: new Map() });
  }
  find('[data-diagram-note]').textContent = `${drawn.length} of ${visible.length} observed matches in this diagram. Node colour identifies its declared type; larger nodes have more displayed links. Labels appear when space permits and around the record you inspect.`;
  if (visible.length > 120) find('[data-list-note]').textContent = 'The diagram shows the first 120 observed matches. The searchable list and complete static report provide the other records.';
  wakeLayout(.3);
}
function paintDiagram() {
  const proposedFocus = hoverId ?? state.selectedId;
  const focusId = nodeElements.has(proposedFocus) ? proposedFocus : null, neighbours = new Set();
  if (focusId) for (const edge of drawnEdges) {
    if (edge.from === focusId) neighbours.add(edge.to);
    if (edge.to === focusId) neighbours.add(edge.from);
  }
  const routeEdges = new Set(state.route?.edges ?? []);
  for (const { edge, line } of edgeElements) {
    const from = positions.get(edge.from), to = positions.get(edge.to);
    for (const [name, value] of Object.entries({ x1: from.x, y1: from.y, x2: to.x, y2: to.y })) line.setAttribute(name, value);
    const connected = edge.from === focusId || edge.to === focusId;
    line.setAttribute('class', `kg-edge${routeEdges.has(edge.id) ? ' kg-route-edge' : ''}${connected ? ' kg-connected' : focusId && !routeEdges.has(edge.id) ? ' kg-muted' : ''}`);
  }
  const labelNodes = [];
  for (const entry of nodeElements.values()) {
    const { object, group, hit, circle, text, color, radius } = entry;
    const point = positions.get(object.id), focused = object.id === focusId, neighbour = neighbours.has(object.id), selected = object.id === state.selectedId;
    group.setAttribute('transform', `translate(${point.x} ${point.y})`);
    group.setAttribute('class', `kg-node kg-type-${color}${selected ? ' kg-selected' : ''}${focused ? ' kg-focused' : neighbour ? ' kg-neighbour' : focusId ? ' kg-muted' : ''}`);
    if (point.pinned) group.setAttribute('data-pinned', 'true'); else group.removeAttribute('data-pinned');
    const r = radius / Math.sqrt(viewport.scale); circle.setAttribute('r', r);
    const hitSize = Math.max(28 / viewport.scale, r * 2 + 6 / viewport.scale);
    for (const [name, value] of Object.entries({ x: -hitSize / 2, y: -hitSize / 2, width: hitSize, height: hitSize })) hit.setAttribute(name, value);
    text.setAttribute('font-size', 12 / viewport.scale); text.setAttribute('text-anchor', 'start');
    const fontState = selected || focused ? 'emphasised' : 'ordinary';
    if (entry.fontState !== fontState) {
      const computed = getComputedStyle(text);
      entry.font = `${computed.fontStyle} ${computed.fontWeight} 12px ${computed.fontFamily}`;
      entry.nativeMeasure = computed.letterSpacing !== 'normal' && computed.letterSpacing !== '0px';
      entry.fontState = fontState; entry.measurements.clear();
    }
    labelNodes.push({id:object.id,label:label(object),x:point.x*viewport.scale+viewport.x,y:point.y*viewport.scale+viewport.y,radius:r*viewport.scale});
  }
  const labelNeighbours = new Set(neighbours); if (focusId && focusId !== state.selectedId) labelNeighbours.add(focusId);
  const placements = layoutGraphLabels(labelNodes, {width:viewSize.width,height:viewSize.height,selectedId:state.selectedId,neighbourIds:[...labelNeighbours],inset:8,scale:viewport.scale}, (value,node) => {
    const entry = nodeElements.get(node.id), key = entry.nativeMeasure ? `${viewport.scale}:${value}` : value;
    if (!entry.measurements.has(key)) {
      let width;
      if (labelMeasureContext && !entry.nativeMeasure) { labelMeasureContext.font = entry.font; width = labelMeasureContext.measureText(value).width; }
      else { entry.text.textContent = value; width = entry.text.getComputedTextLength() * viewport.scale; }
      entry.measurements.set(key,width);
    }
    return entry.measurements.get(key);
  });
  for (const placement of placements) {
    const entry=nodeElements.get(placement.id),point=positions.get(placement.id),text=entry.text;
    text.textContent=placement.text; text.setAttribute('visibility',placement.visible?'visible':'hidden');
    text.dataset.labelState=placement.visible?'visible':'hidden'; text.dataset.labelReason=placement.reason; text.dataset.labelTruncated=String(placement.truncated);
    if (placement.visible) { text.setAttribute('x',(placement.x-viewport.x)/viewport.scale-point.x); text.setAttribute('y',(placement.y-viewport.y)/viewport.scale-point.y); }
  }
  find('[data-scene]').setAttribute('transform', `translate(${viewport.x} ${viewport.y}) scale(${viewport.scale})`);
}
function move(direction, node) {
  const [x, y] = { left: [-40, 0], right: [40, 0], up: [0, -40], down: [0, 40] }[direction];
  if (node) {
    const point = simulation?.positions.get(state.selectedId); if (!point) { status('Select a visible node before arranging it.'); return; }
    restoredViewport = true;
    simulation.pin(state.selectedId, point.x + x / viewport.scale, point.y + y / viewport.scale);
    simulation.release(state.selectedId); wakeLayout(.8);
  }
  else { viewport.x += x; viewport.y += y; restoredViewport = true; } draw(); save();
}
function diagramEvents() {
  const svg = find('[data-diagram]');
  const point = event => { const matrix = svg.getScreenCTM(); if (!matrix) return null; return new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse()); };
  svg.addEventListener('pointerdown', event => { if (event.button !== 0 || drag) return; const at = point(event); if (!at) return;
    const id = event.target.closest('[data-node]')?.dataset.node;
    restoredViewport = true;
    drag = { id, pointerId: event.pointerId, start: at, old: id ? { ...positions.get(id) } : { ...viewport }, moved: false };
    if (id) { simulation.pin(id, drag.old.x, drag.old.y); hoverId = id; wakeLayout(.8); }
    svg.setPointerCapture(event.pointerId); svg.classList.add('kg-dragging'); });
  svg.addEventListener('pointermove', event => { if (!drag || drag.pointerId !== event.pointerId) return; const at = point(event); if (!at) return;
    const dx = at.x - drag.start.x, dy = at.y - drag.start.y; if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
    if (drag.id) simulation.pin(drag.id, drag.old.x + dx / viewport.scale, drag.old.y + dy / viewport.scale);
    else { viewport.x = drag.old.x + dx; viewport.y = drag.old.y + dy; restoredViewport = true; } draw(); });
  const finish = event => { if (!drag || event.pointerId !== undefined && event.pointerId !== drag.pointerId) return; const previous = drag; drag = null; svg.classList.remove('kg-dragging');
    if (previous.id) { simulation.release(previous.id); hoverId = null; wakeLayout(.9); paintDiagram(); }
    if (svg.hasPointerCapture(previous.pointerId)) svg.releasePointerCapture(previous.pointerId);
    if (event.type === 'pointerup' && !previous.moved && previous.id) selectNode(previous.id); else save(); };
  svg.addEventListener('pointerup', finish); svg.addEventListener('pointercancel', finish); svg.addEventListener('lostpointercapture', finish);
  window.addEventListener('blur', finish); window.addEventListener('pagehide', finish);
  svg.addEventListener('pointerover', event => { if (!drag) { hoverId = event.target.closest('[data-node]')?.dataset.node ?? null; paintDiagram(); } });
  svg.addEventListener('pointerleave', () => { if (!drag) { hoverId = null; paintDiagram(); } });
  svg.addEventListener('wheel', event => {
    event.preventDefault(); const at = point(event); if (!at) return;
    zoom(Math.exp(-Math.max(-100, Math.min(100, event.deltaY)) * .005), at); save();
  }, { passive: false });
  const resize = () => {
    const next = { width: svg.clientWidth || 1000, height: svg.clientHeight || 650 };
    viewSize = next; svg.setAttribute('viewBox', `0 0 ${next.width} ${next.height}`);
    for (const entry of nodeElements.values()) entry.fontState=null;
    // Only a pristine initial/reset view may refit; reader pan/zoom, saved
    // viewport and dragged node arrangements stay in their chosen coordinates.
    if (simulation) { if (!restoredViewport && !drag) fitView(); paintDiagram(); }
  };
  resize(); new ResizeObserver(resize).observe(svg);
  document.fonts?.ready.then(() => { for (const entry of nodeElements.values()) entry.fontState=null; if(simulation)paintDiagram(); });
}
function zoom(factor, at = { x: viewSize.width / 2, y: viewSize.height / 2 }) {
  const scale = Math.max(.25, Math.min(4, viewport.scale * factor)), ratio = scale / viewport.scale;
  viewport.x = at.x - (at.x - viewport.x) * ratio; viewport.y = at.y - (at.y - viewport.y) * ratio; viewport.scale = scale; restoredViewport = true; draw();
}
async function initialize() {
  if (root.dataset.deliveryUrl) {
    delivery = await openDelivery(root.dataset.deliveryUrl, {baseURL: document.baseURI, expectedSnapshot: root.dataset.snapshotId});
    discovery = delivery.discovery();
    const first = [...new Set(discovery.objects.map(object => object.scope))].sort(compare)[0];
    const loaded = first ? await delivery.loadScopes([first]) : await delivery.loadAll();
    graph = loaded.graph ?? delivery.emptyGraph(); deliveryStatus();
  } else {
    const url = new URL(root.dataset.graphUrl, document.baseURI);
    if (url.origin !== window.location.origin) throw new Error('graph data must be same-origin');
    const response = await fetch(url, { credentials: 'same-origin' }); if (!response.ok) throw new Error(`graph unavailable (${response.status})`);
    graph = await response.json(); if (graph.snapshotId !== root.dataset.snapshotId) throw new Error('graph snapshot differs from this page');
  }
  queryProfiles = JSON.parse(root.dataset.queryProfiles ?? '[]');
  key = navigationStorageKey(graph.graph?.id ?? 'website');
  // A restored route may span several topics. Validate it only against a full
  // coherent graph rather than treating an unloaded step as deleted/known.
  if (delivery) { try { if (sessionStorage.getItem(key) || localStorage.getItem(key)) await loadDetails(); } catch (error) { status(`Saved route details unavailable: ${error.message}`); } }
  state = createNavigationState(graph); objects = new Map(graph.objects.map(object => [object.id, object])); semanticLabel = createSemanticLabels(graph.objects);
  if (discovery) semanticLabel = createSemanticLabels(discovery.objects);
  const domains = [...new Set((discovery?.objects ?? graph.objects).map(object => object.scope))].sort(compare);
  for (const domain of domains) find('[data-search]').elements.scope.append(make('option', domain, { value: domain }));
  refreshRelationTypes();
  readSaved(); restoreViewQuery(); find('[data-controls]').hidden = false;
  if (root.dataset.readingConfig) {
    readingConfig = validateReadingRouteConfig(JSON.parse(root.dataset.readingConfig), location.href);
    let session, local; try { session = sessionStorage; } catch {} try { local = localStorage; } catch {}
    readingStore = createReadingRouteStore({sessionStorage:session,localStorage:local});
    const saved = readingStore.read(readingConfig);
    if (saved.status === 'available' && saved.value.graphId === (graph.graph?.id ?? 'website')) {
      try { await loadDetails(); const journey = resumeReadingNavigator(graph,readingConfig,restoreReadingRoute(graph,readingConfig,saved.value));
        state = journey.state; persistent = journey.persistent; storageConflict = false; restoreViewQuery();
        find('[data-persistent]').checked = persistent; save(); forgetReadingJourney();
        requestAnimationFrame(()=>{const target = [...root.querySelectorAll('[data-focus-key]')].find(item=>item.dataset.focusKey===state.focusKey);(target??find('#kg-route-heading')).focus({preventScroll:true});window.scrollTo(state.sourcePosition.x,state.sourcePosition.y);});
      } catch { status('The saved reading route belongs to another or unavailable snapshot. Choose a current route explicitly.'); }
    }
  }
  routeEndpoints();
  find('[data-search]').addEventListener('submit', async event => { event.preventDefault();
    try { if (scope()) await loadDetails(scope()); searchList(true); if (find('[data-route-form]').elements.mode.value === 'pages') routeEndpoints(); routeView(); showStatus(); status(`${find('[data-search-summary]').textContent} ${find('#kg-status').textContent}`); save(); }
    catch (error) { restoreViewQuery(); status(`Search refused: ${error.message}`); }
  });
  find('[data-query-form]').elements.profile.addEventListener('change', queryControls);
  find('[data-query-form]').addEventListener('submit', async event => { event.preventDefault();
    try { await runQuestion(); } catch (error) { find('[data-query-status]').textContent = `Question refused: ${error.message}. Previous results, knowledge and accepted route are unchanged.`; }
  });
  find('[data-route-form]').elements.mode.addEventListener('change', () => { routeEndpoints(); candidate = null; candidateView(); status('Route endpoints changed. The accepted route remains selected until you explicitly accept a new candidate.'); });
  find('[data-route-form]').addEventListener('submit', async event => { event.preventDefault(); const form = event.currentTarget;
    const relationTypes = [...form.elements.relationTypes.selectedOptions].map(option => option.value);
    try { await loadDetails(); const options = { direction: form.elements.direction.value, relationTypes: relationTypes.length ? relationTypes : undefined,
      scope: scope(), known: state.known, difficultyWeights: state.difficultyWeights ?? {}, difficultyMultiplier: Number(form.elements.difficulty.value), maxStates: 2000, maxSteps: 40 };
      candidate = form.elements.mode.value === 'pages'
        ? shortestPagePath(graph, { ...options, startPage: form.elements.start.value, goalPage: form.elements.goal.value, maxPairs: 200 })
        : shortestPath(graph, { ...options, start: form.elements.start.value, goal: form.elements.goal.value }); candidateView(); }
    catch (error) { status(`Candidate refused: ${error.message}`); } });
  find('[data-return]').addEventListener('click', () => returnExploration(false)); find('[data-return-route]').addEventListener('click', () => returnExploration(true));
  find('[data-load-all]')?.addEventListener('click', async () => {
    try { await loadDetails(); routeEndpoints(); searchList(); detail(); routeView(); showStatus(); }
    catch (error) { status(`Details unavailable: ${error.message}. Existing reader choices are retained.`); }
  });
  find('[data-clear-route]').addEventListener('click', () => { state.route = null; state.detours = []; forgetReadingJourney(); routeView(); draw(); showStatus(); save(); });
  find('[data-persistent]').addEventListener('change', event => { persistent = event.currentTarget.checked; storageEnabled = true; save(); });
  find('[data-forget]').addEventListener('click', () => {
    forgetReadingJourney();
    try { sessionStorage.removeItem(key); localStorage.removeItem(key); storageConflict = false; storageEnabled = false; persistent = false;
      find('[data-persistent]').checked = false; find('[data-storage-note]').textContent = 'Stored reader choices forgotten; saving is paused until you enable retention. The current in-memory route remains selected.';
    } catch { find('[data-storage-note]').textContent = 'Browser storage could not be cleared here. Use browser site-data controls; the in-memory route remains selected.'; }
  });
  for (const element of root.querySelectorAll('[data-pan]')) element.addEventListener('click', () => move(element.dataset.pan, false));
  for (const element of root.querySelectorAll('[data-move]')) element.addEventListener('click', () => move(element.dataset.move, true));
  for (const element of root.querySelectorAll('[data-zoom]')) element.addEventListener('click', () => { zoom(element.dataset.zoom === 'in' ? 1.25 : .8); save(); });
  find('[data-fit-view]').addEventListener('click', () => { fitView(); restoredViewport = true; draw(); save(); });
  find('[data-reset-view]').addEventListener('click', () => { positions.clear(); simulation = undefined; layoutKey = ''; restoredViewport = false; hoverId = null; draw(); save(); });
  find('[data-simulation-toggle]').addEventListener('click', () => {
    if (layoutPaused || simulation.isSettled()) { layoutPaused = false; wakeLayout(1); }
    else { layoutPaused = true; if (frame !== null) cancelAnimationFrame(frame); frame = null; lastFrame = null; layoutStatus(); save(); }
  });
  for (const control of root.querySelectorAll('[data-force]')) control.addEventListener('input', () => {
    const value = Number(control.value); if (!Number.isFinite(value)) return;
    forceOptions[control.dataset.force] = value; simulation.configure(forceOptions);
    find(`[data-force-value="${control.dataset.force}"]`).textContent = String(value); wakeLayout(.8);
  });
  motionPreference.addEventListener('change', event => {
    if (event.matches) { layoutPaused = true; if (frame !== null) cancelAnimationFrame(frame); frame = null; lastFrame = null; }
    // Returning to no-preference never overrides an explicit reader pause.
    layoutStatus();
  });
  diagramEvents(); searchList(); detail(); routeView(); showStatus();
  window.addEventListener('pagehide', save);
}
if (root) initialize().catch(error => status(`Interactive navigation is unavailable: ${error.message}. Use the static source list and report; no missing record has been treated as absent.`));
