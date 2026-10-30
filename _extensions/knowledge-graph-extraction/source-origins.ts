// Copyright 2026 Kai Prince. SPDX-License-Identifier: Apache-2.0
// Public original-source provenance only. Native occurrence identity and destinations stay unchanged.
import { resolveSourceOrigin, publicSourceOrigin, SOURCE_MAP_LIMITS } from './source-map.ts';
import { canonicalDelivery } from './delivery.js';
import { query } from './query.js';

type Value = Record<string, any>;
type SourceFile = { path: string; text: string; sha256: string };
export const SOURCE_ORIGINS_LIMITS = Object.freeze({ graphs: 500, occurrences: 100000,
  artifactBytes: 16 * 1024 * 1024, uniqueResolutions: 4096, sourceWorkBytes: 256 * 1024 * 1024 });
const fail = (): never => { throw new Error('knowledge-graph-extraction: source origins require bounded coherent public graphs and verified source inputs'); };
const mapping = (value: unknown): value is Value => !!value && typeof value === 'object' && !Array.isArray(value);
const sourcePath = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 4096 &&
  /\.(?:qmd|md)$/i.test(value) && value === value.trim() && !value.startsWith('/') && !/[:\\\u0000-\u001f\u007f?#]/.test(value) &&
  !value.split('/').some(part => !part || part === '.' || part === '..' || ['.git', '.quarto', '_extensions'].includes(part.toLowerCase()));
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 8192 && !/[\u0000-\u001f\u007f]/.test(value);
const graphId = (value: unknown): value is string => typeof value === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(value) && !['constructor', 'prototype'].includes(value);
const byteLength = (value: string) => new TextEncoder().encode(value).byteLength;

/** The coordinator supplies already public projections and inventoried include
 * closures; this function performs no I/O. Inclusion in that public projection
 * supplies the record-public decision. Author publicPaths separately supplies
 * the source-public decision. Neither decision authenticates rights/consent.
 *
 * Resolve against the complete QMD/MD closure before applying source consent:
 * an undisclosed duplicate must not turn a different public file into a unique
 * source. Unavailable rows disclose no candidate filename, text or source hash.
 * Existing coordinates describe the literal #ID token. An optional sourceOrigin
 * span additionally binds an unambiguous original heading section/fenced Div;
 * its hash is over exact UTF-8 source bytes, and its bounds are original UTF-16.
 * Included files remain separate sources rather than an invented expanded-file
 * range. Source text is never included in this immutable public artifact. */
export async function buildSourceOrigins(graphValues: unknown, files: unknown,
  sourceDependencies: unknown, publicPaths: unknown = []) {
  if (Array.isArray(publicPaths) && publicPaths.length === 0) return null;
  if (!Array.isArray(publicPaths) || publicPaths.length > SOURCE_MAP_LIMITS.files ||
      publicPaths.some(path => !sourcePath(path)) || new Set(publicPaths).size !== publicPaths.length) fail();
  if (!Array.isArray(graphValues) || !graphValues.length || graphValues.length > SOURCE_ORIGINS_LIMITS.graphs ||
      !Array.isArray(files) || files.length > SOURCE_MAP_LIMITS.files || !mapping(sourceDependencies)) fail();
  const permitted = new Set<string>(publicPaths), byPath = new Map<string, SourceFile[]>(), fileSizes = new Map<SourceFile, number>(); let inputBytes = 0;
  for (const raw of files) {
    if (!mapping(raw) || Object.keys(raw).some(key => !['path', 'text', 'sha256'].includes(key)) ||
        !sourcePath(raw.path) || typeof raw.text !== 'string' || !/^[a-f0-9]{64}$/.test(raw.sha256 ?? '')) fail();
    const accepted = { path: raw.path, text: raw.text, sha256: raw.sha256 }, size = byteLength(accepted.text);
    inputBytes += size; if (size > SOURCE_MAP_LIMITS.fileBytes || inputBytes > SOURCE_MAP_LIMITS.totalBytes) fail();
    fileSizes.set(accepted, size);
    const values = byPath.get(raw.path) ?? []; values.push(accepted); byPath.set(raw.path, values);
  }
  const graphs = new Set<string>(); let snapshotId: string | null = null, count = 0;
  const ordered = graphValues.map(raw => {
    if (!mapping(raw) || !mapping(raw.definition) || !mapping(raw.graph) || !graphId(raw.definition.id) ||
        graphs.has(raw.definition.id) || !/^[a-f0-9]{64}$/.test(raw.graph.snapshotId ?? '') ||
        (raw.graph.graph?.id ?? 'website') !== raw.definition.id || snapshotId !== null && snapshotId !== raw.graph.snapshotId) fail();
    query(raw.graph, 'lookup', raw.graph.objects?.[0]?.id ?? 'urn:kg:empty');
    graphs.add(raw.definition.id); snapshotId = raw.graph.snapshotId;
    count += raw.graph.occurrences.length; if (count > SOURCE_ORIGINS_LIMITS.occurrences) fail();
    return raw;
  }).sort((a, b) => a.definition.id < b.definition.id ? -1 : 1);
  const rows: Value[] = [], cache = new Map<string, any>(); let work = 0, resolutions = 0, rowBytes = 0, available = 0;
  for (const { definition, graph } of ordered) {
    const objects = new Map<string, Value>(graph.objects.map((object: Value) => [object.id, object]));
    const occurrences = [...graph.occurrences].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0), ids = new Set<string>();
    for (const occurrence of occurrences) {
      if (!mapping(occurrence) || !text(occurrence.id) || ids.has(occurrence.id) || !text(occurrence.target) ||
          !objects.has(occurrence.target) || !text(occurrence.destination) || !mapping(occurrence.source)) fail();
      ids.add(occurrence.id);
      const object = objects.get(occurrence.target)!, row: Value = { graphId: definition.id, occurrenceId: occurrence.id,
        target: occurrence.target, destination: occurrence.destination };
      let origin = null;
      const recordPublic = occurrence.public !== false && occurrence.eligible !== false && object.public !== false && object.eligible !== false;
      const containing = occurrence.source.path, anchor = occurrence.source.anchor;
      if (recordPublic && sourcePath(containing) && typeof anchor === 'string') {
        const key = canonicalDelivery([containing, anchor]);
        if (!cache.has(key)) {
          let result: any = { status: 'unavailable', reason: 'invalid-input' };
          const rawClosure = Object.hasOwn(sourceDependencies, containing) ? sourceDependencies[containing] : null;
          if (Array.isArray(rawClosure) && rawClosure.length <= SOURCE_MAP_LIMITS.files && rawClosure.includes(containing) &&
              rawClosure.every(path => typeof path === 'string') && new Set(rawClosure).size === rawClosure.length) {
            const paths = rawClosure.filter(path => /\.(?:qmd|md)$/i.test(path));
            if (paths.every(path => sourcePath(path) && byPath.get(path)?.length === 1)) {
              const candidates = paths.sort().map(path => byPath.get(path)![0]);
              const size = candidates.reduce((sum, file) => sum + fileSizes.get(file)!, 0);
              if (resolutions < SOURCE_ORIGINS_LIMITS.uniqueResolutions && work + size <= SOURCE_ORIGINS_LIMITS.sourceWorkBytes) {
                work += size; resolutions++;
                result = await resolveSourceOrigin(candidates, { anchor });
              }
            }
          }
          cache.set(key, result);
        }
        const result = cache.get(key);
        origin = publicSourceOrigin(result, { recordPublic, sourcePublic: result.status === 'available' && permitted.has(result.origin.path) });
      }
      if (origin) { row.sourceOrigin = origin; available++; }
      else { row.sourceOrigin = null; row.reason = 'source-origin-unavailable'; }
      rowBytes += byteLength(canonicalDelivery(row)) + 1;
      if (rowBytes > SOURCE_ORIGINS_LIMITS.artifactBytes - 1024) fail();
      rows.push(row);
    }
  }
  const artifact = { sourceOriginsVersion: 1, snapshotId, coordinateSystem: 'utf16-zero-based-end-exclusive', precision: 'anchor-token', occurrences: rows };
  const body = canonicalDelivery(artifact) + '\n'; if (byteLength(body) > SOURCE_ORIGINS_LIMITS.artifactBytes) fail();
  return { artifact, files: { 'source-origins.json': body }, stats: { occurrences: rows.length, available, unavailable: rows.length - available } };
}
