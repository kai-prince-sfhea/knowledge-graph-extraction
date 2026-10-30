// Copyright 2026 Kai Prince. SPDX-License-Identifier: Apache-2.0
// See the accompanying LICENSE and COPYRIGHT files for terms and attribution.
/** Snapshot-bound reading continuity. Storage and activity messages are reader
 * proposals, never publication authority, proof results or implicit mastery. */
import { restoreNavigationState, beginDetour, returnFromDetour, advanceRoute, prerequisites, recordLabel } from './query.js';
const MAX_STATE = 1_000_000, MAX_FRAMES = 32, MAX_GRAPH_BYTES = 32 * 1024 * 1024;
const fail = () => { throw new Error('knowledge-graph-extraction: reading route is unavailable or incompatible; use the current graph to choose a route explicitly'); };
const map = value => value && typeof value === 'object' && !Array.isArray(value);
const text = (value, max = 8192) => typeof value === 'string' && value.length > 0 && value.length <= max && value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value);
const fields = (value, allowed) => { if (!map(value) || Object.keys(value).some(key => !allowed.includes(key))) fail(); };
const copy = value => JSON.parse(JSON.stringify(value));
const graphId = value => text(value, 64) && /^[a-z][a-z0-9-]*$/.test(value) && !['constructor', 'prototype', '__proto__'].includes(value);
function bounded(value) { let serialized; try { serialized = JSON.stringify(value); } catch { fail(); } if (typeof serialized !== 'string' || serialized.length > MAX_STATE) fail(); return value; }
function url(value, base, site, { directory = false, artifact = false } = {}) {
  if (!text(value) || /[\\\u0000-\u001f]/.test(value)) fail();
  let parsed; try { parsed = new URL(value, base); } catch { fail(); }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || site && (parsed.origin !== site.origin || !parsed.pathname.startsWith(site.pathname))) fail();
  let decoded; try { decoded = decodeURIComponent(parsed.pathname); } catch { fail(); }
  if (/[\\\u0000-\u001f]/.test(decoded) || /%(?:25)*(?:2f|5c)/i.test(parsed.pathname) || /%(?:25)*(?:2e|2f|5c|3a|00)/i.test(decoded) || decoded.split('/').some(segment => segment === '.' || segment === '..' || ['.quarto', '.git', '_extensions'].includes(segment.toLowerCase()))) fail();
  if (directory && (!parsed.pathname.endsWith('/') || parsed.search || parsed.hash) || artifact && (parsed.search || parsed.hash)) fail();
  return parsed;
}
export function validateReadingRouteConfig(value, baseUrl) {
  bounded(value); fields(value, ['version', 'snapshotId', 'siteUrl', 'graphs', 'activities']);
  if (value.version !== 1 || !/^[a-f0-9]{64}$/.test(value.snapshotId ?? '') || !Array.isArray(value.graphs) || !value.graphs.length || value.graphs.length > 500 || !Array.isArray(value.activities ?? []) || (value.activities ?? []).length > 64) fail();
  const document = url(baseUrl, baseUrl), site = url(value.siteUrl, document, undefined, { directory: true });
  if (site.origin !== document.origin || !document.pathname.startsWith(site.pathname)) fail();
  const ids = new Set(), activities = new Set();
  const graphs = value.graphs.map(entry => {
    fields(entry, ['id', 'label', 'graphUrl', 'navigationUrl']);
    if (!graphId(entry.id) || ids.has(entry.id) || !text(entry.label, 8192)) fail(); ids.add(entry.id);
    const graph = url(entry.graphUrl, site, site, { artifact: true }), navigation = url(entry.navigationUrl, site, site, { artifact: true });
    const generation = site.pathname + 'knowledge-graph/generations/' + value.snapshotId + '/';
    if (!graph.pathname.startsWith(generation) || !graph.pathname.endsWith('/graph.json') || !navigation.pathname.startsWith(generation) || !navigation.pathname.endsWith('/navigation.html')) fail();
    return { id: entry.id, label: entry.label, graphUrl: graph.href, navigationUrl: navigation.href };
  });
  return { version: 1, snapshotId: value.snapshotId, siteUrl: site.href, graphs, activities: (value.activities ?? []).map(entry => {
    fields(entry, ['id', 'label', 'url']); if (!graphId(entry.id) || activities.has(entry.id) || !text(entry.label, 256)) fail(); activities.add(entry.id);
    return { id: entry.id, label: entry.label, url: url(entry.url, site, site).href };
  }) };
}
function normalized(config) { return validateReadingRouteConfig(config, config.siteUrl); }
function point(value) { fields(value, ['x', 'y']); if (![value.x, value.y].every(item => Number.isFinite(item) && item >= 0 && item <= 10_000_000)) fail(); return { x: value.x, y: value.y }; }
function context(value, config) {
  fields(value, ['url', 'position', 'focusId']); if (value.focusId !== null && !text(value.focusId, 256)) fail();
  const site = new URL(config.siteUrl), destination = url(value.url, site, site);
  return { url: destination.href, position: point(value.position), focusId: value.focusId };
}
function navigatorContext(value) {
  fields(value, ['position', 'focusKey']); if (value.focusKey !== null && !text(value.focusKey, 8192)) fail();
  return { position: point(value.position), focusKey: value.focusKey };
}
function assertGraph(graph, config, id) {
  if (graph?.snapshotId !== config.snapshotId || (graph.graph?.id ?? 'website') !== id || !config.graphs.some(entry => entry.id === id)) fail();
}
export function startReadingRoute(graph, config, options) {
  config = normalized(config); fields(options, ['graphId', 'state', 'context', 'navigatorContext', 'persistent']); assertGraph(graph, config, options.graphId);
  const state = restoreNavigationState(graph, bounded(options.state)); if (!state.route || options.persistent !== undefined && typeof options.persistent !== 'boolean') fail();
  return { readingVersion: 1, siteUrl: config.siteUrl, snapshotId: graph.snapshotId, graphId: options.graphId, state,
    current: context(options.context, config), navigatorContext: navigatorContext(options.navigatorContext ?? { position: { x: 0, y: 0 }, focusKey: null }),
    frames: [], persistent: options.persistent === true, restoreTarget: null };
}
export function restoreReadingRoute(graph, config, value) {
  config = normalized(config); bounded(value); fields(value, ['readingVersion', 'siteUrl', 'snapshotId', 'graphId', 'state', 'current', 'navigatorContext', 'frames', 'persistent', 'restoreTarget']);
  if (value.readingVersion !== 1 || value.siteUrl !== config.siteUrl || value.snapshotId !== config.snapshotId || typeof value.persistent !== 'boolean' || !Array.isArray(value.frames) || value.frames.length > MAX_FRAMES) fail();
  assertGraph(graph, config, value.graphId); const state = restoreNavigationState(graph, value.state); if (!state.route || value.frames.length > state.detours.length) fail();
  const frames = value.frames.map(frame => {
    fields(frame, ['kind', 'context', 'activityId', 'nonce']); if (!['source', 'activity'].includes(frame.kind)) fail();
    if (frame.kind === 'activity' && (!config.activities.some(item => item.id === frame.activityId) || !/^[A-Za-z0-9_-]{16,128}$/.test(frame.nonce ?? '')) || frame.kind === 'source' && (frame.activityId !== undefined || frame.nonce !== undefined)) fail();
    return { kind: frame.kind, context: context(frame.context, config), ...(frame.kind === 'activity' ? { activityId: frame.activityId, nonce: frame.nonce } : {}) };
  });
  return { readingVersion: 1, siteUrl: config.siteUrl, snapshotId: config.snapshotId, graphId: value.graphId, state, current: context(value.current, config), navigatorContext: navigatorContext(value.navigatorContext), frames,
    persistent: value.persistent, restoreTarget: value.restoreTarget === null ? null : context(value.restoreTarget, config) };
}
export function updateReadingContext(graph, config, value, nextContext) {
  const journey = restoreReadingRoute(graph, config, value); journey.current = context(nextContext, normalized(config)); journey.restoreTarget = null; return journey;
}
function push(graph, config, value, selectedId, nextContext, frame) {
  const journey = restoreReadingRoute(graph, config, value); if (journey.frames.length >= MAX_FRAMES || journey.state.detours.length >= 50) fail();
  journey.frames.push({ ...frame, context: copy(journey.current) });
  journey.state = beginDetour(journey.state, { selectedId }); journey.current = context(nextContext, normalized(config)); journey.restoreTarget = null;
  return restoreReadingRoute(graph, config, journey);
}
function recordDestination(graph, config, id) {
  if (!graph.objects.some(item => item.id === id)) fail();
  const occurrence = graph.occurrences.find(item => item.target === id); if (!occurrence) fail();
  if (!text(occurrence.destination) || /^(?:\/|[A-Za-z][A-Za-z0-9+.-]*:)/.test(occurrence.destination)) fail();
  let decoded; try { decoded = decodeURIComponent(occurrence.destination.split('#')[0]); } catch { fail(); }
  if (decoded.split('/').some(segment => segment === '.' || segment === '..') || /[\\?]/.test(decoded)) fail();
  return url(occurrence.destination, config.siteUrl, new URL(config.siteUrl)).href;
}
export function beginReadingDetour(graph, config, value, options) {
  fields(options, ['recordId', 'context']); config = normalized(config);
  const current = updateReadingContext(graph, config, value, options.context);
  return push(graph, config, current, options.recordId, { url: recordDestination(graph, config, options.recordId), position: { x: 0, y: 0 }, focusId: null }, { kind: 'source' });
}
export function beginReadingActivity(graph, config, value, options) {
  fields(options, ['activityId', 'nonce', 'context']); config = normalized(config);
  const activity = config.activities.find(item => item.id === options.activityId); if (!activity || !/^[A-Za-z0-9_-]{16,128}$/.test(options.nonce ?? '')) fail();
  const journey = updateReadingContext(graph, config, value, options.context);
  return push(graph, config, journey, journey.state.selectedId, { url: activity.url, position: { x: 0, y: 0 }, focusId: null }, { kind: 'activity', activityId: activity.id, nonce: options.nonce });
}
export function returnReadingDetour(graph, config, value) {
  const journey = restoreReadingRoute(graph, config, value), frame = journey.frames.pop(); if (!frame) fail();
  journey.state = returnFromDetour(journey.state); journey.current = frame.context; journey.restoreTarget = copy(frame.context); return journey;
}
export function resumeReadingNavigator(graph, config, value) {
  let journey = restoreReadingRoute(graph, config, value); while (journey.frames.length) journey = returnReadingDetour(graph, config, journey);
  journey.state.sourcePosition = copy(journey.navigatorContext.position); journey.state.focusKey = journey.navigatorContext.focusKey; journey.restoreTarget = null;
  return journey;
}
export function advanceReadingRoute(graph, config, value, options) {
  fields(options, ['completeCurrent']); if (options.completeCurrent !== true) fail();
  const journey = restoreReadingRoute(graph, config, value), route = journey.state.route;
  if (journey.frames.length || journey.state.detours.length || route.needsReview) fail();
  const current = route.nodes[route.index], here = new URL(journey.current.url).pathname;
  if (!graph.occurrences.some(item => item.target === current && new URL(recordDestination({ ...graph, occurrences: [item] }, normalized(config), current)).pathname === here)) fail();
  const next = route.nodes[route.index + 1], known = [...new Set([...journey.state.known, current])];
  if (next && prerequisites(graph, { target: next, known }).answer?.satisfied !== true) fail();
  journey.state = advanceRoute(journey.state, { completeCurrent: true });
  journey.current = { url: recordDestination(graph, normalized(config), journey.state.selectedId), position: { x: 0, y: 0 }, focusId: null }; journey.restoreTarget = null;
  return restoreReadingRoute(graph, config, journey);
}
export function setReadingPersistence(graph, config, value, enabled, { consent = false } = {}) {
  if (typeof enabled !== 'boolean' || enabled && consent !== true) fail(); const journey = restoreReadingRoute(graph, config, value); journey.persistent = enabled; return journey;
}
export function readingRouteStorageKey(siteUrl) { return 'quarto-kg:reading-route:v1:' + encodeURIComponent(siteUrl); }
export function createReadingRouteStore({ sessionStorage, localStorage } = {}) {
  let paused = false;
  return {
    read(config) {
      if (paused) return { status: 'missing', value: null };
      const key = readingRouteStorageKey(normalized(config).siteUrl); let raw;
      try { raw = sessionStorage?.getItem(key); if (raw == null) raw = localStorage?.getItem(key); if (raw == null) return { status: 'missing', value: null }; if (raw.length > MAX_STATE) fail(); const value = JSON.parse(raw); if (value?.readingVersion === 1 && value.forgotten === true) return { status: 'missing', value: null }; bounded(value); return { status: 'available', value }; }
      catch { return { status: 'unavailable', value: null }; }
    },
    write(config, journey) {
      config = normalized(config); const key = readingRouteStorageKey(config.siteUrl); bounded(journey);
      if (journey?.siteUrl !== config.siteUrl || journey.snapshotId !== config.snapshotId || journey.readingVersion !== 1 || typeof journey.persistent !== 'boolean') fail(); paused = false;
      let session = false, persistent = false, removed = !localStorage; const raw = JSON.stringify(journey);
      try { sessionStorage.setItem(key, raw); session = true; } catch {}
      try { if (journey.persistent === true) { localStorage.setItem(key, raw); persistent = true; } else { localStorage?.removeItem(key); removed = true; } } catch {}
      return { status: session && (journey.persistent ? persistent : removed) ? 'saved' : 'unavailable', session, persistent, removed };
    },
    forget(config) {
      const key = readingRouteStorageKey(normalized(config).siteUrl); paused = true; let session = false, persistent = !localStorage;
      // Tombstone outranks an older persistent copy even if removal fails.
      try { sessionStorage.setItem(key, JSON.stringify({ readingVersion: 1, forgotten: true })); session = true; } catch {}
      try { localStorage?.removeItem(key); persistent = true; } catch {}
      return { status: session && persistent ? 'forgotten' : 'unavailable', session, persistent };
    },
  };
}
/** Versioned generic activity contract. It deliberately has no field for proof,
 * claims, route edits, learner knowledge or imported activity configuration. */
export function createActivityBridge(config, journey, { activityId, nonce, source }) {
  config = normalized(config); bounded(journey); const frame = journey.frames?.at(-1);
  if (!config.activities.some(item => item.id === activityId) || frame?.kind !== 'activity' || frame.activityId !== activityId || frame.nonce !== nonce || !source || !['object', 'function'].includes(typeof source) || !/^[A-Za-z0-9_-]{16,128}$/.test(nonce ?? '') || journey.snapshotId !== config.snapshotId || journey.siteUrl !== config.siteUrl || !config.graphs.some(entry => entry.id === journey.graphId)) fail();
  const request = { type: 'quarto-kg.activity-context', version: 1, snapshotId: config.snapshotId, graphId: journey.graphId, activityId, nonce, returnUrl: context(frame.context, config).url };
  let consumed = false;
  return { request, dispose() { consumed = true; }, receive(event) {
    if (consumed || event?.origin !== new URL(config.siteUrl).origin || event?.source !== source) return { accepted: false };
    const value = event.data;
    try { if (JSON.stringify(value).length > 4096) return { accepted: false }; } catch { return { accepted: false }; }
    if (!map(value) || Object.keys(value).some(key => !['type', 'version', 'snapshotId', 'graphId', 'activityId', 'nonce', 'status'].includes(key)) || value.type !== 'quarto-kg.activity-return' || value.version !== 1 || value.snapshotId !== request.snapshotId || value.graphId !== request.graphId || value.activityId !== activityId || value.nonce !== nonce || !['returned', 'cancelled'].includes(value.status)) return { accepted: false };
    consumed = true; return { accepted: true, status: value.status };
  } };
}

async function fetchGraph(href, environment, signal) {
  const controller = new AbortController(), timer = environment.setTimeout(() => controller.abort(), 12000);
  const abort = () => controller.abort(); if (signal?.aborted) controller.abort(); else signal?.addEventListener('abort', abort, { once: true });
  try {
    const response = await environment.fetch(href, { signal: controller.signal, credentials: 'same-origin', redirect: 'error' }); if (!response.ok || Number(response.headers.get('content-length')) > MAX_GRAPH_BYTES) fail();
    const chunks = [], reader = response.body?.getReader(); let size = 0;
    if (!reader) fail();
    while (true) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength; if (size > MAX_GRAPH_BYTES) { await reader.cancel(); fail(); } chunks.push(value); }
    const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } finally { environment.clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}
export async function initializeReadingRoute(element, environment = window, { signal, onPanel } = {}) {
  const document = environment.document, config = validateReadingRouteConfig(JSON.parse(element.textContent), environment.location.href);
  let session, local; try { session = environment.sessionStorage; } catch {} try { local = environment.localStorage; } catch {}
  const store = createReadingRouteStore({ sessionStorage: session, localStorage: local }), retained = store.read(config);
  if (retained.status === 'missing') return null;
  const panel = document.createElement('aside'), heading = document.createElement('h2'), status = document.createElement('p');
  panel.className = 'kg-reading-route border rounded p-3 my-3'; panel.setAttribute('aria-label', 'Your reading route'); panel.setAttribute('data-kg-reading-route', ''); heading.textContent = 'Your reading route'; heading.tabIndex = -1; status.setAttribute('role', 'status'); panel.append(heading, status);
  (document.querySelector('main') ?? document.body).prepend(panel);
  let journey, graph, departing = false, disposed = false, onHide = null;
  const dispose = () => { disposed = true; if (onHide) environment.removeEventListener('pagehide', onHide); panel.remove(); };
  onPanel?.({ config, store, panel, dispose });
  const say = text => { status.textContent = text; };
  const capture = () => ({ url: environment.location.href, position: { x: Math.max(0, environment.scrollX), y: Math.max(0, environment.scrollY) }, focusId: document.activeElement?.id || null });
  const save = () => { const result = store.write(config, journey); if (result.status !== 'saved') say('Browser storage is unavailable or could not be updated completely. The current in-memory route remains usable; browser site-data controls may be needed to remove older saved data.'); return result; };
  const move = next => {
    journey = next; if (save().status !== 'saved') return;
    const here = new URL(environment.location.href), target = new URL(journey.current.url), sameDocument = here.pathname === target.pathname && here.search === target.search;
    departing = true; environment.location.assign(journey.current.url);
    // Hash-only navigation has no document/module reload. Refresh the owned
    // panel without an unnecessary page render or duplicate event handlers.
    if (sameDocument) environment.dispatchEvent(new environment.CustomEvent('quarto-kg-reading-route-updated'));
  };
  const control = (label, action, id = label.toLowerCase().replace(/[^a-z0-9]+/g, '-')) => { const button = document.createElement('button'); button.className = 'btn btn-secondary m-1'; button.id = 'kg-reading-' + id; button.type = 'button'; button.textContent = label; button.addEventListener('click', () => { try { action(); } catch { departing = false; say('This action could not use the current route. Choose a current graph route explicitly; no knowledge or proof was changed.'); } }); panel.append(button); return button; };
  const forget = () => { const result = store.forget(config); panel.replaceChildren(heading, status); say(result.status === 'forgotten' ? 'Reading route forgotten locally. No reader knowledge was uploaded.' : 'The current page has forgotten the route, but browser storage could not be fully cleared. Use browser site-data controls.'); journey = null; };
  try {
    if (retained.status !== 'available' || retained.value.snapshotId !== config.snapshotId) fail();
    const selected = config.graphs.find(item => item.id === retained.value.graphId); if (!selected) fail();
    graph = await fetchGraph(selected.graphUrl, environment, signal); if (disposed || signal?.aborted) fail(); journey = restoreReadingRoute(graph, config, retained.value);
    const target = journey.restoreTarget;
    journey = updateReadingContext(graph, config, journey, capture());
    say(`Step ${journey.state.route.index + 1} of ${journey.state.route.nodes.length} in ${selected.label}. Visiting a page does not mark its concepts known. ${graph.status === 'complete' ? '' : 'Graph coverage is incomplete; this route is provisional.'}`);
    const currentId = journey.state.route.nodes[journey.state.route.index], currentLabel = recordLabel(graph.objects.find(item => item.id === currentId));
    const currentSummary = document.createElement('p'); currentSummary.textContent = `Current route concept: ${currentLabel}.`; panel.append(currentSummary);
    control('Return to graph navigator', () => { journey = resumeReadingNavigator(graph, config, journey); if (save().status !== 'saved') return; departing = true; environment.location.assign(selected.navigationUrl); });
    if (journey.frames.length) control('Return from this exploration', () => move(returnReadingDetour(graph, config, updateReadingContext(graph, config, journey, capture()))));
    control('Open current route concept', () => move({ ...journey, current: { url: recordDestination(graph, config, currentId), position: { x: 0, y: 0 }, focusId: null }, restoreTarget: null }));
    const complete = control(`Mark ${currentLabel} complete and continue`, () => move(advanceReadingRoute(graph, config, updateReadingContext(graph, config, journey, capture()), { completeCurrent: true })), 'complete-current-concept');
    const currentPath = new URL(environment.location.href).pathname;
    complete.disabled = Boolean(journey.frames.length || journey.state.detours.length || journey.state.route.needsReview || !graph.occurrences.some(entry => entry.target === currentId && new URL(entry.destination, config.siteUrl).pathname === currentPath));
    const choices = document.createElement('select'), choiceLabel = document.createElement('label'); choiceLabel.textContent = 'Explore a concept '; choiceLabel.append(choices); panel.append(choiceLabel);
    const targets = new Set(graph.occurrences.map(entry => entry.target));
    for (const item of graph.objects.slice(0, 10000)) { if (!targets.has(item.id)) continue; const option = document.createElement('option'); option.value = item.id; option.textContent = recordLabel(item); choices.append(option); }
    if (graph.objects.length > 10000) say('The source-page concept picker is bounded to 10,000 records. Use the graph navigator for complete discovery; omitted records are unknown here.');
    control('Open selected concept as a detour', () => move(beginReadingDetour(graph, config, journey, { recordId: choices.value, context: capture() })));
    for (const activity of config.activities) control(`Explore activity: ${activity.label}`, () => move(beginReadingActivity(graph, config, journey, { activityId: activity.id, nonce: environment.crypto.randomUUID(), context: capture() })), 'activity-' + activity.id);
    const persistence = document.createElement('input'), persistentLabel = document.createElement('label'); persistence.type = 'checkbox'; persistence.checked = journey.persistent; persistentLabel.append(persistence, document.createTextNode(' Retain this reading route on this browser after the session')); panel.append(persistentLabel);
    persistence.addEventListener('change', () => { journey = setReadingPersistence(graph, config, journey, persistence.checked, { consent: persistence.checked }); save(); });
    control('Forget reading route', forget);
    onHide = () => { if (journey && !departing && !disposed) { journey = updateReadingContext(graph, config, journey, capture()); save(); } }; environment.addEventListener('pagehide', onHide);
    if (target && new URL(target.url).href === new URL(environment.location.href).href) environment.requestAnimationFrame(() => {
      if (disposed) return;
      const focus = target.focusId ? document.getElementById(target.focusId) : null; (focus ?? heading).focus({ preventScroll: true }); environment.scrollTo(target.position.x, target.position.y);
    });
    return { get journey() { return journey; }, config, graph, store, panel, dispose };
  } catch {
    say('A stored reading route could not be matched to this public snapshot. It has not changed reader knowledge or been mixed into current content. Choose and accept a new route in the current graph, or forget the old reading route.');
    control('Forget old reading route', forget); return { config, store, panel, dispose, unavailable: true };
  }
}
export function mountReadingRoute(element, environment = window) {
  let epoch = 0, current = null, stopped = false, inFlight = null;
  const refresh = async () => {
    if (stopped) return;
    const request = ++epoch; inFlight?.abort(); current?.dispose(); current = null; const controller = new AbortController(); inFlight = controller;
    try { const result = await initializeReadingRoute(element, environment, { signal: controller.signal, onPanel(handle) { if (stopped || request !== epoch) handle.dispose(); else current = handle; } }); if (stopped || request !== epoch) result?.dispose(); else current = result; }
    catch { /* Malformed optional configuration leaves ordinary authored content. */ }
    finally { if (request === epoch) inFlight = null; }
  };
  const changed = event => {
    if (event.type === 'pageshow' && !event.persisted) return;
    if (event.type === 'storage') {
      let config; try { config = validateReadingRouteConfig(JSON.parse(element.textContent), environment.location.href); } catch { return; }
      if (event.key !== readingRouteStorageKey(config.siteUrl)) return;
    }
    refresh();
  };
  environment.addEventListener('storage', changed); environment.addEventListener('pageshow', changed); environment.addEventListener('quarto-kg-reading-route-updated', changed); refresh();
  return { refresh, get current() { return current; }, dispose() { stopped = true; epoch++; inFlight?.abort(); current?.dispose(); environment.removeEventListener('storage', changed); environment.removeEventListener('pageshow', changed); environment.removeEventListener('quarto-kg-reading-route-updated', changed); } };
}
if (typeof document !== 'undefined') for (const element of document.querySelectorAll('script[data-kg-reading-config]')) mountReadingRoute(element);
