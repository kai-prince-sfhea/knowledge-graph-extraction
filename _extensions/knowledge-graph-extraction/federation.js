// Copyright 2026 Kai Prince. SPDX-License-Identifier: Apache-2.0
// See the accompanying LICENSE and COPYRIGHT files for terms and attribution.
/** An opt-in union with qualified claim identity, never a URI equality merge. */
const MAX_RECORDS = 100000, MAX_GRAPHS = 500, MAX_LINKS = 10000, MAX_BYTES = 32 * 1024 * 1024;
const fail = () => { throw new Error("knowledge-graph-extraction: invalid public federation input"); };
const mapping = value => value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value, limit = 8192) => typeof value === "string" && !!value.trim() && value.length <= limit && !/[\u0000-\u001f]/.test(value);
const graphId = value => text(value, 64) && /^[a-z][a-z0-9-]*$/.test(value) && !["constructor", "prototype", "__proto__"].includes(value);
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const sorted = values => [...new Set(values)].sort(compare);
const copy = value => JSON.parse(JSON.stringify(value));
const keys = (value, allowed) => { if (!mapping(value) || Object.keys(value).some(key => !allowed.includes(key))) fail(); };
const finite = value => typeof value === "number" && Number.isFinite(value) && value >= 0;
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : mapping(value) ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}` : JSON.stringify(value);
function path(value) {
  if (!text(value, 4096) || value.startsWith("/") || /[:\\?#]/.test(value) || value.split("/").some(part => !part || part === "." || part === "..")) fail();
  return value;
}
function source(value) {
  keys(value, ["path", "anchor", "precision"]);
  if (value.precision !== "anchor" || !text(value.anchor, 512)) fail();
  return { path: path(value.path), anchor: value.anchor, precision: "anchor" };
}
function destination(value, admittedSource) {
  if (!text(value, 8192) || value.startsWith("/") || /[\\\s]/.test(value)) fail();
  const hash = value.indexOf("#"); if (hash < 0) fail();
  const encodedPath = value.slice(0, hash), encodedAnchor = value.slice(hash + 1);
  let decoded, anchor; try { decoded = decodeURIComponent(encodedPath); anchor = decodeURIComponent(encodedAnchor); } catch { fail(); }
  if (!encodedPath || /[?:]/.test(encodedPath) || decoded.startsWith("/") || /[:\\\u0000-\u001f]/.test(decoded) || /%(?:25)*(?:2e|2f|5c|00)/i.test(decoded) || decoded.split("/").some(part => !part || part === "." || part === "..") || anchor !== admittedSource.anchor) fail();
  return value;
}
function scalarProperties(value) {
  if (!mapping(value) || Object.keys(value).length > 1000 || Object.values(value).some(item => !["string", "number", "boolean"].includes(typeof item) || typeof item === "number" && !Number.isFinite(item) || typeof item === "string" && (item.length > 200000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(item)))) fail();
}
function record(value, kind) {
  keys(value, ["id", "type", "scope", "source", "review", "origin", "properties", ...(kind === "object" ? ["labels", "aliases", "summary", "provenance"] : ["from", "to", "weight"])]);
  if (!text(value.id) || !text(value.type, 128) || !text(value.scope, 256)) fail();
  source(value.source);
  for (const field of ["review", "origin"]) if (value[field] !== undefined && !text(value[field], 256)) fail();
  if (value.properties !== undefined) {
    scalarProperties(value.properties);
    if (kind === "object" && value.properties.difficulty !== undefined && !finite(value.properties.difficulty)) fail();
  }
  if (kind === "object") {
    if (!mapping(value.labels) || !Object.keys(value.labels).length || Object.keys(value.labels).length > 1000 || Object.entries(value.labels).some(([language, label]) => !/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(language) || !text(label))) fail();
    if (value.aliases !== undefined && (!mapping(value.aliases) || Object.keys(value.aliases).length > 1000 || Object.entries(value.aliases).some(([language, aliases]) => !/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(language) || !Array.isArray(aliases) || aliases.length > 2000 || !aliases.every(alias => text(alias))))) fail();
    if (value.summary !== undefined && (typeof value.summary !== "string" || value.summary.length > 200000)) fail();
    if (value.provenance !== undefined) {
      keys(value.provenance, ["qualification", "review", "evidence"]);
      for (const field of ["qualification", "review"]) if (value.provenance[field] !== undefined && !text(value.provenance[field], 2048)) fail();
      if (value.provenance.evidence !== undefined && (!Array.isArray(value.provenance.evidence) || value.provenance.evidence.length > 10000 || !value.provenance.evidence.every(id => text(id)))) fail();
    }
  } else if (!text(value.from) || !text(value.to) || value.weight !== undefined && !finite(value.weight) || value.properties?.["prerequisite-group"] !== undefined && !text(value.properties["prerequisite-group"], 256)) fail();
  return copy(value);
}

/** Qualification keeps identical URI claims in independent graphs distinct.
 * The kind segment also prevents object/relation/occurrence identifier clashes. */
export function qualifiedFederationId(graph, id, kind = "object") {
  if (!graphId(graph) || !text(id) || !["object", "relation", "occurrence", "link", "membership"].includes(kind)) fail();
  return `urn:quarto-kg:federated:${kind}:${graph}:${encodeURIComponent(id)}`;
}

function endpoint(value) { keys(value, ["graph", "id"]); if (!graphId(value.graph) || !text(value.id)) fail(); return value; }
function list(value) { if (!Array.isArray(value) || value.length > MAX_GRAPHS || value.some(id => !graphId(id)) || new Set(value).size !== value.length) fail(); return value; }

/** `graphValues` uses coordinator `{definition,graph}` projections. `links` are
 * explicitly public, source-anchor-verified declarations, not raw author input.
 * Unknown candidates are omitted/count-only; they are never copied to output.
 *
 * Return routingSafe=false on unresolved declarations: removing an unavailable
 * hard prerequisite must not silently make a dependent record traversable. A
 * coordinator may publish the static report, but must withhold a route navigator
 * until those constraints are resolved. Ordinary incomplete-source status still
 * retains the query module's explicitly provisional-route semantics. */
export function buildFederation(graphValues, links, snapshotId, options = {}) {
  if (!Array.isArray(graphValues) || graphValues.length > MAX_GRAPHS || !Array.isArray(links) || links.length > MAX_LINKS || !/^[a-f0-9]{64}$/.test(snapshotId ?? "")) fail();
  keys(options, ["selectedGraphs", "memberships"]);
  let serialised;
  try { serialised = JSON.stringify({ graphValues, links, options }); } catch { fail(); }
  if (new TextEncoder().encode(serialised).byteLength > MAX_BYTES) fail();
  const available = new Map();
  for (const value of graphValues) {
    if (!mapping(value) || !mapping(value.definition) || !graphId(value.definition.id) || available.has(value.definition.id) || !mapping(value.graph) || value.graph.snapshotId !== snapshotId || value.graph.graph !== undefined && value.graph.graph?.id !== value.definition.id || !["complete", "incomplete"].includes(value.graph.status)) fail();
    if (!text(value.definition.label, 8192) || value.definition.navigation !== undefined && typeof value.definition.navigation !== "boolean") fail();
    available.set(value.definition.id, value);
  }
  const requested = options.selectedGraphs === undefined ? [...available.values()].filter(value => value.definition.navigation !== false).map(value => value.definition.id).sort(compare) : list(options.selectedGraphs).sort(compare);
  const selected = requested.filter(id => available.has(id) && available.get(id).definition.navigation !== false);
  const unresolved = { unresolvedLinks: 0, unresolvedMemberships: 0, missingGraphs: requested.length - selected.length };
  const graph = { contractVersion: 0, snapshotId, status: "complete", graph: { id: "federated", label: "Connected public graphs", navigation: true, search: false },
    scope: { sources: [], renderedSources: [], skippedSources: [] }, objects: [], relations: [], occurrences: [] };
  const mappingOutput = { objects: {}, relations: {}, occurrences: {} }, sourceGraphs = [];
  const inventories = new Map(), prerequisiteSignatures = new Map(); let count = 0;
  for (const id of selected) {
    const { definition, graph: original } = available.get(id);
    if (!Array.isArray(original.objects) || !Array.isArray(original.relations) || !Array.isArray(original.occurrences) || !mapping(original.scope)) fail();
    count += original.objects.length + original.relations.length + original.occurrences.length; if (count > MAX_RECORDS) fail();
    for (const name of ["sources", "renderedSources"]) if (!Array.isArray(original.scope[name]) || original.scope[name].some(value => { path(value); return false; })) fail();
    if (!Array.isArray(original.scope.skippedSources ?? [])) fail();
    const skipped = (original.scope.skippedSources ?? []).map(value => {
      keys(value, ["path", "reason"]); path(value.path);
      if (!["disabled", "unsupported-format"].includes(value.reason)) fail();
      return { path: value.path, reason: value.reason };
    });
    const scope = { sources: sorted(original.scope.sources), renderedSources: sorted(original.scope.renderedSources), skippedSources: [...new Map(skipped.map(value => [canonical(value), value])).values()].sort((a, b) => compare(canonical(a), canonical(b))) };
    const sourcePaths = new Set(scope.sources), renderedPaths = new Set(scope.renderedSources);
    const complete = original.status === "complete" && scope.sources.every(value => renderedPaths.has(value));
    if (!complete) graph.status = "incomplete";
    sourceGraphs.push({ id, label: definition.label, status: complete ? "complete" : "incomplete", scope: copy(scope) });
    for (const name of Object.keys(scope)) graph.scope[name].push(...scope[name]);
    const objects = new Map(), relations = new Set(), occurrences = new Set(), requirements = new Map(); inventories.set(id, objects);
    for (const raw of original.objects) {
      const item = record(raw, "object"); if (objects.has(item.id) || !sourcePaths.has(item.source.path)) fail(); objects.set(item.id, item);
      const qualified = qualifiedFederationId(id, item.id);
      graph.objects.push({ ...item, id: qualified }); mappingOutput.objects[qualified] = { graph: id, id: item.id };
    }
    for (const raw of original.relations) {
      const item = record(raw, "relation"); if (relations.has(item.id) || !objects.has(item.from) || !objects.has(item.to) || !sourcePaths.has(item.source.path)) fail(); relations.add(item.id);
      if (item.type === "requires") { const values = requirements.get(item.from) ?? []; values.push(item); requirements.set(item.from, values); }
      const qualified = qualifiedFederationId(id, item.id, "relation");
      graph.relations.push({ ...item, id: qualified, from: qualifiedFederationId(id, item.from), to: qualifiedFederationId(id, item.to) });
      mappingOutput.relations[qualified] = { graph: id, id: item.id };
    }
    for (const raw of original.occurrences) {
      keys(raw, ["id", "target", "source", "destination"]);
      if (!text(raw.id) || !objects.has(raw.target) || occurrences.has(raw.id) || !sourcePaths.has(raw.source?.path)) fail(); occurrences.add(raw.id);
      const qualified = qualifiedFederationId(id, raw.id, "occurrence");
      const admittedSource = source(raw.source);
      graph.occurrences.push({ id: qualified, target: qualifiedFederationId(id, raw.target), source: admittedSource, destination: destination(raw.destination, admittedSource) });
      mappingOutput.occurrences[qualified] = { graph: id, id: raw.id };
    }
    prerequisiteSignatures.set(id, new Map([...requirements].map(([target, values]) => [target, canonical(values.sort((a, b) => compare(a.id, b.id)))])));
  }
  const linkIds = new Set();
  for (const value of links) {
    keys(value, ["id", "from", "to", "weight", "source", "type", "scope", "properties"]);
    if (!text(value.id) || linkIds.has(value.id) || value.weight !== undefined && !finite(value.weight) || value.type !== undefined && !text(value.type, 128) || value.scope !== undefined && !text(value.scope, 256)) fail();
    linkIds.add(value.id); endpoint(value.from); endpoint(value.to); source(value.source);
    if (value.properties !== undefined) { keys(value.properties, ["prerequisite-group"]); if (value.properties["prerequisite-group"] !== undefined && !text(value.properties["prerequisite-group"], 256)) fail(); }
    if (!inventories.get(value.from.graph)?.has(value.from.id) || !inventories.get(value.to.graph)?.has(value.to.id)) { unresolved.unresolvedLinks++; continue; }
    const qualified = qualifiedFederationId("federated", value.id, "link");
    graph.relations.push({ id: qualified, from: qualifiedFederationId(value.from.graph, value.from.id), to: qualifiedFederationId(value.to.graph, value.to.id), type: value.type ?? "navigation-link", scope: value.scope ?? "federated", weight: value.weight ?? 1, source: source(value.source), review: "declared", origin: "author-declared", ...(value.properties ? { properties: copy(value.properties) } : {}) });
    mappingOutput.relations[qualified] = { graph: "federated", id: value.id };
    graph.scope.sources.push(value.source.path); graph.scope.renderedSources.push(value.source.path);
  }
  const memberships = options.memberships ?? {}; if (!mapping(memberships) || Object.keys(memberships).length > MAX_RECORDS) fail();
  for (const [id, raw] of Object.entries(memberships).sort(([a], [b]) => compare(a, b))) {
    if (!text(id)) fail(); const declared = list(raw).filter(value => requested.includes(value));
    if (declared.length < 2) continue;
    const present = declared.filter(value => inventories.get(value)?.has(id));
    if (present.length !== declared.length) { unresolved.unresolvedMemberships++; continue; }
    const canonicalRecord = inventories.get(present[0]).get(id);
    if (present.some(value => canonical(inventories.get(value).get(id)) !== canonical(canonicalRecord))) fail();
    // A view must not weaken a canonical claim's hard requirements. Keep author
    // groups untouched; differing public constraints need explicit resolution
    // before a combined navigator can be admitted.
    const requirements = graphId => prerequisiteSignatures.get(graphId).get(id) ?? "[]";
    if (present.some(value => requirements(value) !== requirements(present[0]))) { unresolved.unresolvedMemberships++; continue; }
    // Keep distinct projected IDs. These explicit, bidirectional bridges merely
    // connect author-declared views of the exact same canonical projection.
    for (const other of present.slice(1)) for (const [from, to] of [[present[0], other], [other, present[0]]]) {
      const qualified = `${qualifiedFederationId(from, id, "membership")}:${to}`;
      graph.relations.push({ id: qualified, from: qualifiedFederationId(from, id), to: qualifiedFederationId(to, id), type: "shared-membership", scope: canonicalRecord.scope, weight: 0, source: copy(canonicalRecord.source), review: "declared", origin: "author-declared" });
      mappingOutput.relations[qualified] = { graph: "federated", id, fromGraph: from, toGraph: to, kind: "explicit-shared-membership" };
    }
  }
  if (graph.objects.length + graph.relations.length + graph.occurrences.length > MAX_RECORDS) fail();
  const routingSafe = !Object.values(unresolved).some(Boolean);
  if (!routingSafe || !selected.length) graph.status = "incomplete";
  for (const name of ["sources", "renderedSources"]) graph.scope[name] = sorted(graph.scope[name]);
  graph.scope.skippedSources = [...new Map(graph.scope.skippedSources.map(value => [canonical(value), value])).values()].sort((a, b) => compare(canonical(a), canonical(b)));
  for (const name of ["objects", "relations", "occurrences"]) graph[name].sort((a, b) => compare(a.id, b.id));
  return { graph, mapping: mappingOutput, sourceGraphs, diagnostics: { status: graph.status, ...unresolved }, routingSafe: routingSafe && selected.length > 0 };
}
