// Copyright 2026 Kai Prince. SPDX-License-Identifier: Apache-2.0
// Build a data-only descriptor from exact already-read public query module bytes.
import { validateQueryProvider, QUERY_PROVIDER_LIMITS } from './query-provider.js';
export * from './query-provider.js';

type Input = {snapshotId: string; graphId: string; status: string; graphUrl: string;
  queryModuleURL: string; queryModuleSource: string; delivery?: unknown; profiles?: unknown};
export async function buildQueryProvider(input: Input) {
  const fail = (): never => { throw new Error('knowledge-graph-extraction: incompatible or unsafe public query provider'); };
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key =>
      !['snapshotId', 'graphId', 'status', 'graphUrl', 'queryModuleURL', 'queryModuleSource', 'delivery', 'profiles'].includes(key)) ||
      typeof input.queryModuleSource !== 'string' || !input.queryModuleSource.length || input.queryModuleSource.length > QUERY_PROVIDER_LIMITS.moduleBytes) fail();
  const bytes = new TextEncoder().encode(input.queryModuleSource);
  if (bytes.byteLength > QUERY_PROVIDER_LIMITS.moduleBytes || new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(bytes) !== input.queryModuleSource) fail();
  const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
  return validateQueryProvider({version: 1, graphId: input.graphId, snapshotId: input.snapshotId, status: input.status,
    module: {url: input.queryModuleURL, sha256, bytes: bytes.byteLength, apiVersion: 1},
    graph: {url: input.graphUrl, snapshotId: input.snapshotId, status: input.status},
    ...(input.delivery === undefined ? {} : {delivery: input.delivery}), profiles: input.profiles ?? []});
}
