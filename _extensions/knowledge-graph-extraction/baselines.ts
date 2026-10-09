// Data-only portable expected baseline. This is not an HTML/extraction cache.
type Mapping = Record<string, any>;
const HASH = /^[a-f0-9]{64}$/;
export const BASELINE_KIND = 'knowledge-graph-frozen-baseline';
export const BASELINE_LIMIT = 32 * 1024 * 1024;
function fail(message: string): never { throw new Error('knowledge-graph-extraction: baseline: ' + message); }
function mapping(value: unknown, field: string): Mapping {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(field + ' must be a mapping');
  return value as Mapping;
}
function keys(value: Mapping, allowed: string[], field: string): void {
  if (Object.keys(value).some(key => !allowed.includes(key))) fail(field + ' contains unsupported fields');
}
export function canonicalBaseline(value: any): string {
  if (Array.isArray(value)) return '[' + value.map(canonicalBaseline).join(',') + ']';
  if (value !== null && typeof value === 'object') return '{' + Object.keys(value).sort()
    .map(key => JSON.stringify(key) + ':' + canonicalBaseline(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
export async function baselineHash(value: any): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalBaseline(value));
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
}
function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim() || /[\u0000-\u001f]/.test(value)) fail(field + ' must be nonempty text without controls');
  return value;
}
function http(value: unknown, field: string): string {
  const id = text(value, field);
  let url: URL;
  try { url = new URL(id); } catch { fail(field + ' must be an absolute HTTP(S) URI'); }
  if (!/^https?:\/\//i.test(id) || !['http:', 'https:'].includes(url.protocol) || !url.hostname
      || url.username || url.password || /[\s\\]/.test(id)) fail(field + ' must be an HTTP(S) URI without credentials or whitespace');
  return id;
}
function path(value: unknown, field: string): string {
  const result = text(value, field);
  if (/[:\\]/.test(result) || result.split('/').some(part => !part || part === '.' || part === '..')) fail(field + ' must be a confined project-relative path');
  return result;
}
function inventory(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || !value.length || new Set(value).size !== value.length) fail(field + ' must contain unique confined source paths');
  for (const item of value) if (!/\.qmd$/i.test(path(item, field))) fail(field + ' only supports QMD source paths');
  return [...value].sort();
}
function name(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(value)
      || ['constructor', 'prototype', '__proto__'].includes(value)) fail(field + ' must be a supported identifier');
  return value;
}
function language(value: string): void {
  if (!/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(value)) fail('unsupported label/alias language');
}
function source(value: unknown, sources: Set<string>): Mapping {
  const result = mapping(value, 'public source');
  keys(result, ['path', 'anchor', 'precision'], 'public source');
  if (!sources.has(path(result.path, 'public source path'))) fail('public source is outside declared source coverage');
  if (/[\s"'<>]/.test(text(result.anchor, 'public source anchor'))) fail('unsupported public source anchor');
  // v0 native extraction has anchor precision only. Do not accept invented spans.
  if (result.precision !== 'anchor') fail('version-0 baselines only support anchor source precision');
  return result;
}
function properties(value: unknown): void {
  const result = mapping(value, 'public properties');
  const reserved = ['id', 'type', 'scope', 'labels', 'aliases', 'review', 'public', 'source', 'occurrences',
    'origin', 'eligible', 'properties', 'from', 'to', 'weight'];
  for (const [key, item] of Object.entries(result)) {
    name(key, 'public property name');
    if (reserved.includes(key) || !['string', 'number', 'boolean'].includes(typeof item)
        || typeof item === 'number' && !Number.isFinite(item) || typeof item === 'string' && item.includes('\u0000')) fail('unsupported public property scalar');
  }
}
function record(value: unknown, kind: 'object' | 'relation', sources: Set<string>): Mapping {
  const result = mapping(value, 'public ' + kind);
  keys(result, ['id', 'type', 'scope', 'review', 'origin', 'source', 'properties',
    ...(kind === 'object' ? ['labels', 'aliases'] : ['from', 'to', 'weight'])], 'public ' + kind);
  http(result.id, 'semantic ID'); name(result.type, 'record type'); text(result.scope, 'record scope');
  if (result.review !== 'declared' || result.origin !== 'author-declared') fail('unsupported public review/origin status');
  source(result.source, sources);
  if (result.properties !== undefined) properties(result.properties);
  if (kind === 'object') {
    const labels = mapping(result.labels, 'public labels');
    if (!Object.keys(labels).length) fail('public object requires language-labelled labels');
    for (const [lang, label] of Object.entries(labels)) { language(lang); text(label, 'public label'); }
    if (result.aliases !== undefined) for (const [lang, entries] of Object.entries(mapping(result.aliases, 'public aliases'))) {
      language(lang);
      if (!Array.isArray(entries) || !entries.length || new Set(entries).size !== entries.length) fail('aliases require distinct nonempty language sequences');
      for (const entry of entries) text(entry, 'public alias');
    }
  } else {
    http(result.from, 'relation from'); http(result.to, 'relation to');
    if (result.weight !== undefined && (typeof result.weight !== 'number' || !Number.isFinite(result.weight) || result.weight < 0)) fail('relation weight must be finite and nonnegative');
  }
  return result;
}
function exportMetadata(value: unknown): void {
  const result = mapping(value, 'public export metadata');
  keys(result, ['id', 'title', 'creators', 'license', 'baseUrl'], 'public export metadata');
  http(result.id, 'dataset ID'); text(result.title, 'dataset title');
  if (!Array.isArray(result.creators) || new Set(result.creators).size !== result.creators.length) fail('dataset creators require distinct names');
  for (const creator of result.creators) text(creator, 'dataset creator');
  if (result.license !== undefined) http(result.license, 'dataset license');
  if (result.baseUrl !== undefined) {
    const base = new URL(http(result.baseUrl, 'dataset base URL'));
    if (base.search || base.hash || !base.pathname.endsWith('/') || base.href !== result.baseUrl) fail('dataset base URL must be a normalized website root without query or fragment');
  }
}
function destination(value: unknown, anchor: string): string {
  const result = text(value, 'occurrence destination'), hash = result.indexOf('#');
  if (hash <= 0 || result.indexOf('#', hash + 1) !== -1) fail('occurrence destination needs one local HTML anchor');
  let decoded: string;
  try { decoded = result.slice(0, hash).split('/').map(decodeURIComponent).join('/'); }
  catch { fail('occurrence destination has invalid percent encoding'); }
  path(decoded, 'occurrence destination');
  if (!/\.html?$/i.test(decoded)) fail('occurrence destination must identify native HTML');
  let expected: string;
  try { expected = decoded.split('/').map(encodeURIComponent).join('/') + '#' + encodeURIComponent(anchor); }
  catch { fail('occurrence destination has invalid Unicode'); }
  if (result !== expected) fail('occurrence destination must be canonically encoded and match its source anchor');
  return decoded;
}
async function publicGraph(graph: Mapping, manifest: Mapping, sources: string[]): Promise<void> {
  text(graph.extractorVersion, 'extractor version');
  const coverage = new Set(sources);
  if (graph.schema !== undefined) {
    const schema = mapping(graph.schema, 'public schema metadata');
    keys(schema, ['version', 'digest'], 'public schema metadata');
    if (schema.version !== 0 || typeof schema.digest !== 'string' || !HASH.test(schema.digest)) fail('unsupported public schema metadata');
  }
  const publication = graph.publication === undefined ? {} : mapping(graph.publication, 'public publication metadata');
  keys(publication, ['navigation', 'runtimeDigest', 'exports'], 'public publication metadata');
  if (graph.publication !== undefined && !Object.keys(publication).length) fail('empty publication metadata is unsupported');
  if (publication.navigation !== undefined && publication.navigation !== true) fail('unsupported public navigation flag');
  if ((publication.navigation === true) !== (manifest.navigation !== undefined)) fail('navigation metadata and manifest disagree');
  if (publication.navigation === true) {
    if (typeof publication.runtimeDigest !== 'string' || !HASH.test(publication.runtimeDigest)) fail('navigation needs its runtime digest');
  } else if (publication.runtimeDigest !== undefined) fail('navigation runtime digest has no navigation publication');
  if ((publication.exports !== undefined) !== (manifest.exports !== undefined)) fail('export metadata and manifest disagree');
  if (publication.exports !== undefined) exportMetadata(publication.exports);
  const objects = new Map<string, Mapping>(), ids = new Set<string>();
  for (const raw of graph.objects) {
    const object = record(raw, 'object', coverage);
    if (ids.has(object.id)) fail('duplicate semantic ID');
    ids.add(object.id); objects.set(object.id, object);
  }
  for (const raw of graph.relations) {
    const relation = record(raw, 'relation', coverage);
    if (ids.has(relation.id)) fail('duplicate semantic/relation ID');
    ids.add(relation.id);
    if (!objects.has(relation.from) || !objects.has(relation.to)) fail('relation has a dangling public endpoint');
  }
  if (publication.exports !== undefined && ids.has(publication.exports.id)) fail('dataset ID collides with a semantic record');
  const occurrenceIds = new Set<string>(), occurrences = new Set<string>(), outputs = new Map<string, string>();
  for (const raw of graph.occurrences) {
    const item = mapping(raw, 'public occurrence');
    keys(item, ['id', 'target', 'source', 'destination'], 'public occurrence');
    if (!objects.has(http(item.target, 'occurrence target'))) fail('occurrence has a dangling public target');
    const origin = source(item.source, coverage), key = `${item.target}\n${origin.path}\n${origin.anchor}`;
    if (item.id !== 'sha256:' + await baselineHashText(key) || occurrenceIds.has(item.id)) fail('invalid or duplicate occurrence identity');
    occurrenceIds.add(item.id); occurrences.add(key);
    const output = destination(item.destination, origin.anchor);
    if (outputs.has(origin.path) && outputs.get(origin.path) !== output) fail('one source has conflicting HTML destinations');
    outputs.set(origin.path, output);
  }
  for (const object of objects.values()) if (!occurrences.has(`${object.id}\n${object.source.path}\n${object.source.anchor}`)) fail('public object is missing its canonical source occurrence');
}
async function baselineHashText(value: string): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), byte => byte.toString(16).padStart(2, '0')).join('');
}
export type BaselineContext = { dependencyDigest: string; sources: string[]; extractorVersion: string };
export async function validateBaseline(value: unknown, context?: BaselineContext): Promise<Mapping> {
  const bundle = mapping(value, 'bundle');
  keys(bundle, ['bundleVersion', 'kind', 'manifest', 'graph', 'hash'], 'bundle');
  if (bundle.bundleVersion !== 0 || bundle.kind !== BASELINE_KIND || typeof bundle.hash !== 'string' || !HASH.test(bundle.hash)) fail('unsupported bundle contract');
  const { hash, ...body } = bundle;
  if (await baselineHash(body) !== hash) fail('bundle integrity mismatch');
  const manifest = mapping(bundle.manifest, 'manifest');
  keys(manifest, ['contractVersion', 'snapshotId', 'status', 'dependencyDigest', 'graph', 'index', 'report', 'navigation', 'assets', 'exports'], 'manifest');
  if (manifest.contractVersion !== 0 || manifest.status !== 'complete' || typeof manifest.snapshotId !== 'string' || !HASH.test(manifest.snapshotId)
      || typeof manifest.dependencyDigest !== 'string' || !HASH.test(manifest.dependencyDigest)) fail('a complete version-0 publication is required');
  const prefix = 'generations/' + manifest.snapshotId + '/';
  for (const name of ['graph', 'index', 'report']) if (manifest[name] !== prefix + name + (name === 'report' ? '.html' : '.json')) fail('unsupported publication mapping');
  function assets(field: string, names: string[]): void {
    const value = mapping(manifest[field], field);
    if (Object.keys(value).length !== names.length || names.some(name => value[name] !== prefix + name)) fail('unsupported asset mapping');
  }
  if (manifest.navigation !== undefined || manifest.assets !== undefined) {
    if (manifest.navigation !== prefix + 'navigation.html') fail('unsupported navigation mapping');
    assets('assets', ['query.js', 'graph-view.js', 'graph-view.css']);
  }
  if (manifest.exports !== undefined) assets('exports', ['dataset.jsonld', 'objects.csv', 'relations.csv', 'public-schema.json']);
  const graph = mapping(bundle.graph, 'public graph');
  keys(graph, ['contractVersion', 'extractorVersion', 'status', 'schema', 'publication', 'scope', 'objects', 'relations', 'occurrences', 'snapshotId'], 'public graph');
  const { snapshotId, ...content } = graph;
  if (graph.contractVersion !== 0 || graph.status !== 'complete' || typeof graph.extractorVersion !== 'string'
      || snapshotId !== manifest.snapshotId || await baselineHash(content) !== snapshotId) fail('public semantic content does not match the complete baseline');
  if (['objects', 'relations', 'occurrences'].some(key => !Array.isArray(graph[key]))) fail('public graph record arrays are missing');
  const scope = mapping(graph.scope, 'source coverage');
  keys(scope, ['sources', 'renderedSources', 'skippedSources'], 'source coverage');
  const sources = inventory(scope.sources, 'source coverage');
  if (canonicalBaseline(inventory(scope.renderedSources, 'validated source coverage')) !== canonicalBaseline(sources)
      || !Array.isArray(scope.skippedSources) || scope.skippedSources.length) fail('incomplete source coverage');
  await publicGraph(graph, manifest, sources);
  if (context && (manifest.dependencyDigest !== context.dependencyDigest || graph.extractorVersion !== context.extractorVersion
      || canonicalBaseline(sources) !== canonicalBaseline([...context.sources].sort()))) fail('source, configuration, schema or runtime dependencies changed; make and review a new complete update render');
  return bundle;
}
export async function makeBaseline(manifest: Mapping, graph: Mapping, context?: BaselineContext): Promise<Mapping> {
  const body = { bundleVersion: 0, kind: BASELINE_KIND, manifest, graph };
  return await validateBaseline({ ...body, hash: await baselineHash(body) }, context);
}
