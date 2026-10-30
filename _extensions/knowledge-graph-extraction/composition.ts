// Public-only graph composition contract. Producers own domain/privacy decisions;
// the coordinator validates this narrow data boundary and real HTML destinations.
export type GraphDefinition = { id: string; label: string; navigation: boolean; search: boolean };
type Value = Record<string, any>;
function fail(message: string): never { throw new Error(`knowledge-graph-extraction: ${message}`); }
/** Bind immutable named-graph views to their renderer/assets without changing
 * the historic no-composition digest preimage or the public graph schema. */
export function compositionIdentity(declaredGraphs: Value[], producer: Value, runtimeDigest?: string, capabilities?: Value): Value {
  const composed = declaredGraphs.length > 0 || producer.parts.length > 0 || producer.stale.length > 0 || capabilities !== undefined;
  if (composed && (typeof runtimeDigest !== "string" || !/^[a-f0-9]{64}$/.test(runtimeDigest))) fail("composed graph publication requires its runtime digest");
  return { declaredGraphs, producers: producer.parts.map((part: Value) => ({ graph: part.graph, objects: part.objects, relations: part.relations, occurrences: part.occurrences })), stale: producer.stale,
    ...(composed ? { runtimeDigest } : {}), ...(capabilities === undefined ? {} : {capabilities}) };
}
function map(value: any, field: string): Value {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${field} must be a mapping`);
  return value;
}
function fields(value: Value, allowed: string[], field: string): void {
  if (Object.keys(value).some(key => !allowed.includes(key))) fail(`${field} contains an unsupported field`);
}
function text(value: any, field: string, maximum = 10000): string {
  if (typeof value !== "string" || !value.trim() || value.length > maximum || /[\u0000-\u001f]/.test(value)) fail(`${field} must be bounded nonempty text`);
  return value;
}
export const PRODUCER_PROPERTY_FIELDS = Object.freeze(['difficulty','start','end','date','as-of']);
function temporalLiteral(value: any, field: string): string {
  if (typeof value !== 'string') fail('producer temporal properties require original date text');
  if (field !== 'as-of' && ['Present','Unknown'].includes(value)) return value;
  const match=/^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(value);
  if (!match || Number(match[1])<1 || field==='as-of'&&!match[3]) fail('producer temporal property requires an explicit supported calendar precision');
  const year=Number(match[1]),month=match[2]===undefined?undefined:Number(match[2]),day=match[3]===undefined?undefined:Number(match[3]);
  if (month!==undefined&&(month<1||month>12)) fail('producer temporal property has an invalid month');
  const days=[31,year%400===0||year%4===0&&year%100!==0?29:28,31,30,31,30,31,31,30,31,30,31];
  if (day!==undefined&&(day<1||day>days[month!-1])) fail('producer temporal property has an invalid day');
  return value;
}
function uri(value: any): string {
  const result = text(value, "semantic identity", 8192);
  if (!/^(?:https?:\/\/[^\s/?#]+(?:[/?#][^\s]*)?|urn:[^\s:]+:[^\s]+)$/.test(result)) fail("semantic identity must be an absolute HTTP(S) or URN identifier");
  return result;
}
export function localPath(value: any): string {
  const path = text(value, "project path", 4096).replaceAll("\\", "/");
  if (path.includes(":") || path.startsWith("/") || path.split("/").some(part => !part || part === "." || part === "..")) fail("producer paths must remain inside the project");
  return path;
}
export function graphDefinition(value: any, id?: string): GraphDefinition {
  const item = map(value, "graph definition");
  fields(item, ["id", "label", "navigation", "search"], "graph definition");
  const identifier = id ?? item.id;
  if (id !== undefined && item.id !== undefined && item.id !== id) fail("graph mapping key and explicit id disagree");
  if (typeof identifier !== "string" || !/^[a-z][a-z0-9-]{0,63}$/.test(identifier) || ["constructor", "prototype"].includes(identifier)) fail("graph id needs lowercase letters, digits and hyphens, starting with a letter");
  for (const field of ["navigation", "search"]) if (item[field] !== undefined && typeof item[field] !== "boolean") fail(`graph ${field} must be boolean`);
  return { id: identifier, label: text(item.label ?? identifier, "graph label", 8192), navigation: item.navigation !== false, search: item.search !== false };
}
function source(value: any, expected: string): Value {
  const item = map(value, "record source");
  fields(item, ["path", "anchor", "precision"], "record source");
  if (localPath(item.path) !== expected || item.precision !== "anchor") fail("producer records must reference the containing source with anchor precision");
  return { path: expected, anchor: text(item.anchor, "source anchor", 512), precision: "anchor" };
}
function labels(value: any, aliases = false): Value {
  const result = map(value, aliases ? "aliases" : "labels");
  if (!Object.keys(result).length) fail("public records require language-labelled text");
  const parsed: Value = {};
  for (const [language, raw] of Object.entries(result)) {
    if (!/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(language)) fail("invalid public record language");
    if (aliases) {
      if (!Array.isArray(raw) || !raw.length || raw.length > 2000) fail("aliases must be a bounded text sequence");
      parsed[language] = [...new Set(raw.map(value => text(value, "alias", 8192)))].sort();
    } else parsed[language] = text(raw, "public label", 8192);
  }
  return parsed;
}
export function producerEnvelope(value: any, runId?: string): Value {
  const item = map(value, "public producer envelope");
  fields(item, ["producerVersion", "producer", "runId", "source", "output", "graph", "objects", "relations", "dependencies", "dependencyDigests"], "public producer envelope");
  if (item.producerVersion !== 1 || (runId !== undefined && item.runId !== runId)) fail("producer envelope has an unsupported version or stale render run");
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(item.producer)) fail("invalid producer identity");
  const path = localPath(item.source), graph = graphDefinition(item.graph);
  if (graph.id === "website") fail("producer graphs need a separate graph id; 'website' is reserved for declarations");
  if (!Array.isArray(item.objects) || !Array.isArray(item.relations) || item.objects.length + item.relations.length > 100000) fail("producer records require bounded arrays");
  const objects = item.objects.map((raw: any) => {
    const object = map(raw, "public producer object");
    fields(object, ["id", "type", "scope", "labels", "aliases", "source", "review", "origin", "summary", "provenance", "properties"], "public producer object");
    const parsed: Value = { id: uri(object.id), type: text(object.type, "object type", 128), scope: text(object.scope, "object scope", 256), labels: labels(object.labels),
      source: source(object.source, path), review: "declared", origin: "author-declared" };
    if (object.review !== undefined && object.review !== "declared") fail("producer objects must be author-declared");
    if (object.origin !== undefined && object.origin !== "author-declared") fail("unsupported producer object origin");
    if (object.aliases !== undefined) parsed.aliases = labels(object.aliases, true);
    if (object.summary !== undefined) parsed.summary = text(object.summary, "public summary");
    if (object.provenance !== undefined) {
      const provenance = map(object.provenance, "public provenance");
      fields(provenance, ["qualification", "review", "evidence"], "public provenance");
      parsed.provenance = {};
      for (const key of ["qualification", "review"]) if (provenance[key] !== undefined) parsed.provenance[key] = text(provenance[key], "public provenance text", 2048);
      if (provenance.evidence !== undefined) {
        if (!Array.isArray(provenance.evidence) || provenance.evidence.length > 10000) fail("public evidence needs a bounded identifier sequence");
        parsed.provenance.evidence = [...new Set(provenance.evidence.map(uri))].sort();
      }
    }
    if (object.properties !== undefined) {
      const properties = map(object.properties, "public object properties"); fields(properties, [...PRODUCER_PROPERTY_FIELDS], "public object properties");
      if (properties.difficulty !== undefined && (typeof properties.difficulty !== "number" || !Number.isFinite(properties.difficulty) || properties.difficulty < 0)) fail("difficulty must be finite and nonnegative");
      for (const field of ['start','end','date','as-of']) if (properties[field]!==undefined) temporalLiteral(properties[field],field);
      parsed.properties = { ...properties };
    }
    return parsed;
  });
  const relations = item.relations.map((raw: any) => {
    const relation = map(raw, "public producer relation");
    fields(relation, ["id", "type", "from", "to", "scope", "source", "review", "origin", "weight", "properties"], "public producer relation");
    if ((relation.review !== undefined && relation.review !== "declared") || (relation.origin !== undefined && relation.origin !== "author-declared")) fail("producer relations must be author-declared");
    const parsed: Value = { id: uri(relation.id), type: text(relation.type, "relation type", 128), from: uri(relation.from), to: uri(relation.to), scope: text(relation.scope, "relation scope", 256),
      source: source(relation.source, path), review: "declared", origin: "author-declared" };
    if (relation.weight !== undefined) {
      if (typeof relation.weight !== "number" || !Number.isFinite(relation.weight) || relation.weight < 0) fail("relation weight must be finite and nonnegative");
      parsed.weight = relation.weight;
    }
    if (relation.properties !== undefined) {
      const properties = map(relation.properties, "relation properties"); fields(properties, ["prerequisite-group"], "relation properties");
      parsed.properties = {};
      if (properties["prerequisite-group"] !== undefined) parsed.properties["prerequisite-group"] = text(properties["prerequisite-group"], "prerequisite group", 256);
    }
    return parsed;
  });
  if (new Set(objects.map((object: Value) => object.id)).size !== objects.length || new Set(relations.map((relation: Value) => relation.id)).size !== relations.length) fail("producer repeats semantic identifiers");
  const ids = new Set(objects.map((object: Value) => object.id));
  if (relations.some((relation: Value) => !ids.has(relation.from) || !ids.has(relation.to))) fail("producer relation must connect public objects in the same envelope");
  if (item.dependencies !== undefined && (!Array.isArray(item.dependencies) || item.dependencies.length > 10000)) fail("producer dependencies must be a bounded path sequence");
  if (item.dependencyDigests !== undefined && (!Array.isArray(item.dependencyDigests) || item.dependencyDigests.length > 10000)) fail("producer dependency digests require a bounded sequence");
  const dependencyDigests = (item.dependencyDigests ?? []).map((raw: any) => {
    const observed = map(raw, "producer dependency digest");
    fields(observed, ["path", "algorithm", "digest"], "producer dependency digest");
    const path = localPath(observed.path);
    if (!['sha1', 'sha256'].includes(observed.algorithm) || typeof observed.digest !== "string"
        || !(observed.algorithm === 'sha1' ? /^[a-f0-9]{40}$/ : /^[a-f0-9]{64}$/).test(observed.digest)) fail("unsupported producer dependency digest");
    if (!(item.dependencies ?? []).includes(path)) fail("producer dependency digest must describe a declared dependency");
    return { path, algorithm: observed.algorithm, digest: observed.digest };
  });
  if (new Set(dependencyDigests.map((entry: any) => entry.path)).size !== dependencyDigests.length) fail("producer dependency digests must not repeat paths");
  return { producerVersion: 1, producer: item.producer, runId: item.runId, source: path, output: text(item.output, "producer HTML output", 4096), graph, objects, relations,
    dependencies: [...new Set([path, ...(item.dependencies ?? []).map(localPath)])].sort(), dependencyDigests };
}
function canonical(value: any): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
export function mergePublicGraph(parts: Value[], definition: GraphDefinition, status = "complete"): Value {
  const objects = new Map<string, Value>(), relations = new Map<string, Value>(), occurrences = new Map<string, Value>();
  const sources = new Set<string>();
  function add(target: Map<string, Value>, record: Value, name: string) {
    const previous = target.get(record.id);
    const semantic = ({ source, ...rest }: Value) => rest;
    if (previous && canonical(semantic(previous)) !== canonical(semantic(record))) fail(`conflicting public ${name} in one graph; use a separate graph id for different catalogues`);
    if (!previous) target.set(record.id, record);
  }
  for (const part of parts) {
    if (canonical(part.graph) !== canonical(definition)) fail("one graph id has conflicting labels or navigation/search settings");
    for (const item of part.objects) { add(objects, item, "object"); sources.add(item.source.path); }
    for (const item of part.relations) { add(relations, item, "relation"); sources.add(item.source.path); }
    for (const item of part.occurrences ?? []) occurrences.set(`${item.target}\n${item.destination}`, item);
  }
  const ids = new Set(objects.keys());
  if ([...relations.values()].some(item => !ids.has(item.from) || !ids.has(item.to))) fail("graph relation has an unavailable public endpoint");
  // Occurrences are already admitted from native HTML observations. A reused
  // definition can occur on a containing page with no canonical object origin
  // in this named graph; retain that observed page in its coverage inventory.
  for (const item of occurrences.values()) sources.add(item.source.path);
  const sorted = (values: Iterable<Value>) => [...values].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return { contractVersion: 0, status, graph: definition, scope: { sources: [...sources].sort(), renderedSources: [...sources].sort(), skippedSources: [] },
    objects: sorted(objects.values()), relations: sorted(relations.values()), occurrences: sorted(occurrences.values()) };
}
export function graphIndex(graph: Value): Value {
  return { contractVersion: 0, snapshotId: graph.snapshotId, status: graph.status, objects: graph.objects.map((item: Value) => ({ id: item.id, type: item.type, scope: item.scope,
    labels: item.labels, ...(item.aliases ? { aliases: item.aliases } : {}), ...(item.summary ? { summary: item.summary } : {}), destinations: graph.occurrences.filter((entry: Value) => entry.target === item.id).map((entry: Value) => entry.destination) })) };
}
/** A stale generated page must not remain searchable through native snippets.
 * Match whole page paths (including an optional deployment prefix), never text. */
export function withoutPageSearch(entries: any[], pages: string[]): any[] {
  const key = (value: any) => {
    if (typeof value !== "string" || /^[A-Za-z][A-Za-z\d+.-]*:/.test(value)) return null;
    try { return decodeURIComponent(value.split(/[?#]/)[0]).replace(/^(?:\.\/|\/)+/, ""); }
    catch { return null; }
  };
  return entries.filter(entry => {
    const path = key(entry?.href);
    return path === null || !pages.some(page => path === page || path.endsWith(`/${page}`));
  });
}
export function withGraphSearch(entries: any[], graphs: { definition: GraphDefinition; graph: Value }[], sharedMemberships: Record<string,string[]> = {}): any[] {
  if (!Array.isArray(entries)) fail("native website search index must be an array");
  const result = entries.filter(entry => entry?.kgGenerated !== 1).map(entry => {
    if (entry?.kgEnriched !== 1 || !entry.kgOriginal) return entry;
    const { kgEnriched, kgOriginal, graphId, graphIds, kgGraphLabels, semanticId, ...original } = entry;
    original.title = kgOriginal.title; original.text = kgOriginal.text;
    if (kgOriginal.hadSection) original.section = kgOriginal.section;
    else delete original.section;
    return original;
  });
  for (const { definition, graph } of graphs) {
    if (!definition.search) continue;
    for (const item of graph.objects) {
      const label = item.labels.en ?? Object.values(item.labels)[0] ?? item.id;
      const aliases = Object.values(item.aliases ?? {}).flat();
      const occurrences = graph.occurrences.filter((entry: Value) => entry.target === item.id);
      const occurrence = occurrences.find((entry: Value) => entry.source.path === item.source?.path && entry.source.anchor === item.source?.anchor) ?? occurrences[0];
      if (!occurrence) continue;
      const destination = occurrence.destination;
      const text = [label, ...Object.values(item.labels), ...aliases, item.summary ?? "", item.type, definition.label].join(" ");
      // Only a single authoritative declaration's explicit membership list can
      // join search contexts. Same IDs/URLs from independent producers do not.
      const allowed = sharedMemberships[item.id];
      const shared = allowed?.includes(definition.id) ? result.findIndex(entry => entry.href === destination && entry.semanticId === item.id
        && allowed.includes(entry.graphId)) : -1;
      if (shared >= 0) {
        const previous = result[shared], graphIds = [...new Set([...(previous.graphIds ?? [previous.graphId]),definition.id])].sort();
        const graphLabels = [...new Set([...(previous.kgGraphLabels ?? [previous.section]),definition.label])];
        result[shared] = {...previous, graphIds, kgGraphLabels:graphLabels, section:graphLabels.join(', '),
          title:`${previous.kgOriginal?.title || label} — ${graphLabels.join(', ')}`,text:`${previous.text ?? ''} ${text}`};
        continue;
      }
      const native = result.findIndex(entry => entry.href === destination && entry.graphId === undefined && entry.kgGenerated !== 1);
      if (native >= 0) {
        const previous = result[native];
        result[native] = { ...previous, title: `${previous.title || label} — ${definition.label}`, text: `${previous.text ?? ""} ${text}`, section: definition.label,
          kgEnriched: 1, kgOriginal: { title: previous.title ?? "", text: previous.text ?? "", section: previous.section ?? null, hadSection: Object.hasOwn(previous, "section") },
          graphId: definition.id, ...(allowed ? {graphIds:[definition.id],kgGraphLabels:[definition.label]} : {}), semanticId: item.id };
      } else result.push({ objectID: `kg:${definition.id}:${item.id}:${destination}`, href: destination, title: `${label} — ${definition.label}`, section: definition.label,
        text, kgGenerated: 1, graphId: definition.id, ...(allowed ? {graphIds:[definition.id],kgGraphLabels:[definition.label]} : {}), semanticId: item.id });
    }
  }
  return result;
}
