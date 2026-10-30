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

/** Match native named selectors only. Arbitrary Lua paths stay conservative. */
export function companionReference(value: unknown): {name: string; directory: string} | null {
  const path = typeof value === 'string' ? value : value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>).path : null;
  if (typeof path !== 'string' || !/^(?:[A-Za-z0-9_-]+\/)?[a-z][a-z0-9-]*$/.test(path)) return null;
  const name = path.split('/').at(-1)!;
  return Object.hasOwn(companionPayloads, name) ? {name, directory: `_extensions/${path}`} : null;
}

export function compatibleCompanion(name: string, version: unknown, hash: string): boolean {
  const expected = companionPayloads[name];
  return !!expected && expected.version === version && expected.hash === hash;
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
