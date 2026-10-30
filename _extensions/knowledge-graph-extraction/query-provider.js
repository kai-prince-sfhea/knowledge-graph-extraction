// Copyright 2026 Kai Prince. SPDX-License-Identifier: Apache-2.0
// Public, data-only API discovery. Validation does not fetch or execute modules.
export const QUERY_PROVIDER_LIMITS = Object.freeze({moduleBytes: 1024 * 1024, deliveryBytes: 8 * 1024 * 1024, profiles: 16});
export const QUERY_PROVIDER_API = Object.freeze({version: 1, queryVersion: 1,
  functions: Object.freeze(['query', 'search', 'traverse', 'prerequisites', 'shortestPath', 'hierarchyClosure', 'evidenceLookup', 'scopedCounts', 'filterByTime', 'pageIndex', 'shortestPagePath']),
  queryOperations: Object.freeze(['lookup', 'neighbours', 'definitions']),
  presentation: Object.freeze(['recordLabel', 'createSemanticLabels']),
  navigation: Object.freeze(['navigationStorageKey', 'createNavigationState', 'acceptRoute', 'beginDetour', 'returnFromDetour', 'advanceRoute', 'setKnowledge', 'setKnown', 'restoreNavigationState'])});
const fail = () => { throw new Error('knowledge-graph-extraction: incompatible or unsafe public query provider'); };
const text = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max && value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value);
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const graphId = value => typeof value === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(value) && !['constructor', 'prototype'].includes(value);
function fields(value, allowed, required = allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail();
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || !allowed.includes(key) || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) fail();
  }
  if (required.some(key => !Object.hasOwn(value, key))) fail();
}
function array(value, minimum, maximum) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length < minimum || value.length > maximum) fail();
  const keys = Reflect.ownKeys(value).filter(key => key !== 'length');
  if (keys.length !== value.length || keys.some((key, index) => key !== String(index))) fail();
  for (const key of keys) { const property = Object.getOwnPropertyDescriptor(value, key); if (!property.enumerable || !Object.hasOwn(property, 'value')) fail(); }
}
function local(value, snapshot) {
  if (!text(value, 4096) || /[\\%?#:\s]/u.test(value) || value.startsWith('/') ||
      value.split('/').some(part => !part || part === '.' || part === '..') || !value.startsWith(`generations/${snapshot}/`)) fail();
  return value;
}
/** Equivalent literal profile fragment to graph-view's author parser. The
 * browser validates before displaying named choices or invoking a query. */
export function validateQueryProviderProfiles(value = []) {
  array(value, 0, QUERY_PROVIDER_LIMITS.profiles); const ids = new Set();
  return value.map(input => {
    fields(input, ['id', 'label', 'operation', 'relations', 'direction', 'types', 'fields', 'match'], ['id', 'label', 'operation']);
    if (!/^[a-z][a-z0-9-]{0,47}$/.test(input.id ?? '') || ids.has(input.id) || !text(input.label, 128) || !['hierarchy', 'evidence', 'time-filter'].includes(input.operation)) fail();
    ids.add(input.id);
    const allowed = ['id', 'label', 'operation', ...(input.operation === 'time-filter' ? ['fields', 'types', 'match'] : input.operation === 'hierarchy' ? ['relations', 'direction'] : ['relations', 'types'])];
    if (Object.keys(input).some(key => !allowed.includes(key))) fail();
    const result = {id: input.id, label: input.label, operation: input.operation};
    if (input.operation !== 'time-filter') {
      array(input.relations, 1, 32); const seen = new Set(), directions = input.operation === 'hierarchy' ? ['child-to-parent', 'parent-to-child'] : ['target-to-evidence', 'evidence-to-target'];
      result.relations = input.relations.map(relation => {
        fields(relation, ['type', 'direction']);
        if (!text(relation.type, 128) || seen.has(relation.type) || !directions.includes(relation.direction)) fail();
        seen.add(relation.type); return {type: relation.type, direction: relation.direction};
      }).sort((a, b) => a.type < b.type ? -1 : a.type > b.type ? 1 : 0);
    }
    if (input.operation === 'hierarchy') {
      if (input.direction !== undefined && !['ancestors', 'descendants'].includes(input.direction)) fail();
      result.direction = input.direction ?? 'ancestors';
    }
    if (input.types !== undefined) {
      array(input.types, 1, 32); if (input.types.some(type => !text(type, 128)) || new Set(input.types).size !== input.types.length) fail();
      result.types = [...input.types].sort();
    }
    if (input.operation === 'time-filter') {
      fields(input.fields, ['instant', 'start', 'end'], []); const names = Object.keys(input.fields);
      if (!(names.length === 1 && text(input.fields.instant, 128) || names.length === 2 && text(input.fields.start, 128) && text(input.fields.end, 128))) fail();
      result.fields = input.fields.instant !== undefined ? {instant: input.fields.instant} : {start: input.fields.start, end: input.fields.end};
      if (input.match !== undefined && !['overlaps', 'contained', 'starts-within'].includes(input.match)) fail();
      result.match = input.match ?? 'overlaps';
    }
    return result;
  });
}
/** URLs stay registry-relative under one exact immutable generation. A module
 * hash identifies bytes; it is not a signature, consent record or truth claim.
 * A consumer must verify transferred bytes and actual API support separately. */
export function validateQueryProvider(value, expected = {}) {
  fields(expected, ['graphId', 'snapshotId', 'status'], []);
  fields(value, ['version', 'graphId', 'snapshotId', 'status', 'module', 'graph', 'delivery', 'profiles'], ['version', 'graphId', 'snapshotId', 'status', 'module', 'graph', 'profiles']);
  if (value.version !== 1 || !graphId(value.graphId) || !hash(value.snapshotId) || !['complete', 'incomplete'].includes(value.status) ||
      Object.keys(expected).some(key => value[key] !== expected[key])) fail();
  fields(value.module, ['url', 'sha256', 'bytes', 'apiVersion']);
  const generation = `generations/${value.snapshotId}/`, base = generation + (value.graphId === 'website' ? '' : `graphs/${value.graphId}/`);
  if (local(value.module.url, value.snapshotId) !== generation + 'query.js' || value.module.apiVersion !== 1 || !hash(value.module.sha256) ||
      !Number.isSafeInteger(value.module.bytes) || value.module.bytes < 1 || value.module.bytes > QUERY_PROVIDER_LIMITS.moduleBytes) fail();
  fields(value.graph, ['url', 'snapshotId', 'status']);
  if (local(value.graph.url, value.snapshotId) !== base + 'graph.json' || value.graph.snapshotId !== value.snapshotId || value.graph.status !== value.status) fail();
  let delivery;
  if (value.delivery !== undefined) {
    fields(value.delivery, ['deliveryVersion', 'manifest', 'sha256', 'bytes']);
    if (value.delivery.deliveryVersion !== 1 || local(value.delivery.manifest, value.snapshotId) !== base + 'delivery.json' || !hash(value.delivery.sha256) ||
        !Number.isSafeInteger(value.delivery.bytes) || value.delivery.bytes < 1 || value.delivery.bytes > QUERY_PROVIDER_LIMITS.deliveryBytes) fail();
    delivery = {...value.delivery};
  }
  return {version: 1, graphId: value.graphId, snapshotId: value.snapshotId, status: value.status,
    module: {...value.module}, graph: {...value.graph}, ...(delivery ? {delivery} : {}), profiles: validateQueryProviderProfiles(value.profiles)};
}
