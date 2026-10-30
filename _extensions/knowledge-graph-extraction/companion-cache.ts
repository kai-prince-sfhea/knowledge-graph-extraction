// Copyright 2026 Kai Prince. SPDX-License-Identifier: Apache-2.0
// A version string alone cannot certify a transform's dependency contract.
// These exact installed payload fingerprints were reviewed with KG 0.0.10.
// Unknown/modified packages retain the fresh-AST requirement; no code is loaded.
export const companionPayloads: Record<string, {version: string; hash: string}> = {
  'accessible-maths': {version: '0.0.6', hash: '94b95987c07ae5cab495b235f767f75cc404bcd084d0cc8855bbceff834eb41f'},
  'maths-knowledge-graph': {version: '0.0.4', hash: '5eb3433eb0f43fc8051461d41b816d88704c3baaa726d487af64eaea4bd4b40c'},
  'interactive-cv': {version: '0.0.5', hash: '9d1d4e5c9b32625128f8455d2957f15af4fa12115f7693d983b73b8733203407'},
  'generative-websites': {version: '0.0.5', hash: '42a437dd79c26c7fe9b0a04703a55a686ec597cd5fb0ecac83bc010a182f40c6'},
  'local-ai-websites': {version: '0.0.5', hash: 'e6f76a2b7a59d28ca4bbbfb83ca819ae54ea7ee014f3d9d5f931ee485b97fad9'},
  'additional-citation-options': {version: '1.1.0-dev.3', hash: '32f5448f769e5943fe4b5d03769f0073167ff108a232b88f26f65f9e1624802f'},
};

/** Additional exact payloads with separately reviewed native input contracts.
 * Never derive admissions from mutable sibling folders or version strings. */
export const reviewedCurrentCompanionPayloads: Record<string, {
  version: string; hash: string; contract: 'current-v1'; review: string;
}[]> = {
  "accessible-maths": [{version:"0.0.10",hash:"37710f7096a96c4b680c9840a64549e6c2baece8dec17ee53fab3cc7449ecb00",contract:"current-v1",review:"native-input-contract-v1-20261030-am10"}],
  "maths-knowledge-graph": [{version:"0.0.10",hash:"d9b1dadc6fae14893f05d148240fc4cae1d0d12b8db7cee69b8a2e1c07e39a94",contract:"current-v1",review:"native-input-contract-v1-20261030-mkg10-proof-focus"}],
  "local-ai-websites": [{version:"0.0.13",hash:"bc84b2cd39ab376d35afccbdb806edc6e4e1a72c33c9c717bcbf65df75c9682b",contract:"current-v1",review:"native-input-contract-v1-20261030-la13-reader-focus"}],
  "generative-websites": [{version:"0.0.13",hash:"86d8ccfb2502770c06de4aa832ea64001dc46ce8da0a1d485108906dbe2f230a",contract:"current-v1",review:"native-input-contract-v1-20261030-gw13-r8-owned-focus"}],
  "interactive-cv": [{version:"0.0.11",hash:"51f27a8d78d3db27260db4b4de7fe8e072de2167016a191542557c9acf1cdf67",contract:"current-v1",review:"native-input-contract-v1-20261030-cv11-result-focus"}],
  "additional-citation-options": [{version:"1.1.0-dev.6",hash:"1dda73ef47c752bf6f31f0c341fbd64ae1534550be7366eb8ee5faae9f33c04a",contract:"current-v1",review:"native-input-contract-v1-20261030-aco-dev6"}],
};

export function companionContract(name: string, version: unknown, hash: string): 'historical' | 'current-v1' | null {
  if (!Object.hasOwn(companionPayloads, name) || typeof version !== 'string' || !/^[a-f0-9]{64}$/.test(hash)) return null;
  const expected = companionPayloads[name];
  if (expected.version === version && expected.hash === hash) return 'historical';
  const reviewed = Object.hasOwn(reviewedCurrentCompanionPayloads, name) ? reviewedCurrentCompanionPayloads[name] : [];
  return reviewed.some(pair => pair.contract === 'current-v1' && typeof pair.review === 'string' && pair.review.length > 0
    && pair.version === version && pair.hash === hash) ? 'current-v1' : null;
}

/** Match native named selectors only. Arbitrary Lua paths stay conservative. */
export function companionReference(value: unknown): {name: string; directory: string} | null {
  const path = typeof value === 'string' ? value : value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>).path : null;
  if (typeof path !== 'string' || !/^(?:[A-Za-z0-9_-]+\/)?[a-z][a-z0-9-]*$/.test(path)) return null;
  const name = path.split('/').at(-1)!;
  return Object.hasOwn(companionPayloads, name) ? {name, directory: `_extensions/${path}`} : null;
}

export function compatibleCompanion(name: string, version: unknown, hash: string): boolean {
  return companionContract(name, version, hash) !== null;
}

/** These data files affect the reviewed transforms' authored output. Paths are
 * interpreted by core using the native containing-document metadata context. */
export function companionInputs(metadata: Record<string, any>): string[] {
  const result: string[] = [];
  for (const [namespace, fields] of [['maths-knowledge-graph', ['declarations', 'notation']],
    ['interactive-cv', ['catalogue', 'graph-file']], ['local-ai', ['manifest']]] as [string, string[]][]) {
    const options = metadata[namespace];
    if (!options || typeof options !== 'object' || Array.isArray(options) || options.enabled === false) continue;
    for (const field of fields) if (typeof options[field] === 'string') result.push(options[field]);
    if (namespace === 'local-ai' && options['publish-assets'] === true && typeof options.manifest === 'string') {
      result.push(options.manifest.replace(/[^/]*$/, 'asset-receipt.json'));
    }
  }
  return [...new Set(result)];
}
