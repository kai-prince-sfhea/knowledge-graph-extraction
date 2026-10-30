import { atomicJson, canonical, confined, digest, fail, keys, PUBLIC, readJson, record, STATE } from "./core.ts";
import { dirname } from "stdlib/path";
import { outputPath } from "./context.ts";
import { privatePath } from "./private-path.ts";
import { producerWithdrawalPending } from './withdrawal.ts';

type Artifact = { path: string; cacheName: string; hash: string };
type CacheRecord = { cacheVersion: number; manifest: Record<string, any>; manifestHash: string; artifacts: Artifact[]; capturedAt?: string };
const pointer = `${STATE}/public/committed.json`;
const hashPattern = /^[a-f0-9]{64}$/;
const navigationAssets = ["query.js", "graph-view.js", "graph-view.css", "graph-force.js", "delivery.js", "reading-route.js", "graph-label-layout.js", "graph-theme.js"];
const reportAssets = ["graph-view.css", "graph-theme.js"];
const exportFiles = ["dataset.jsonld", "objects.csv", "relations.csv", "public-schema.json"];
const packageFiles = ["ro-crate-metadata.json", "reconstruction-manifest.json"];
const captureDate = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value;
// A semantic snapshot may be rendered from several different source/dependency
// contexts. Keep immutable artifacts per complete manifest, rather than letting
// one context overwrite or conflict with another that has the same graph facts.
function cacheDirectory(receipt: Pick<CacheRecord, "cacheVersion" | "manifest" | "manifestHash">): string {
  const base = `${STATE}/public/generations/${receipt.manifest.snapshotId}`;
  return receipt.cacheVersion === 0 ? base : `${base}/receipts/${receipt.manifestHash}`;
}
const artifactOrder = (a: Artifact, b: Artifact): number => a.path < b.path ? -1 : a.path > b.path ? 1 : a.cacheName < b.cacheName ? -1 : a.cacheName > b.cacheName ? 1 : 0;

function manifestValue(value: unknown): Record<string, any> {
  const manifest = record(value, "cached publication manifest");
  keys(manifest, ["contractVersion", "snapshotId", "status", "dependencyDigest", "graph", "index", "report", "navigation", "assets", "reportAssets", "exports", "registry", "composition"], "cached publication manifest");
  if (manifest.contractVersion !== 0 || typeof manifest.snapshotId !== "string" || !hashPattern.test(manifest.snapshotId)
    || typeof manifest.dependencyDigest !== "string" || !hashPattern.test(manifest.dependencyDigest)
    || !["complete", "incomplete"].includes(manifest.status)) fail("invalid cached publication manifest");
  for (const [field, filename] of [["graph", "graph.json"], ["index", "index.json"], ["report", "report.html"]]) {
    if (manifest[field] !== `generations/${manifest.snapshotId}/${filename}`) fail("cached manifest has an unsupported artifact mapping");
  }
  if (manifest.reportAssets !== undefined) {
    const assets = record(manifest.reportAssets, "source report assets");
    keys(assets, reportAssets, "source report assets");
    if (Object.keys(assets).length !== reportAssets.length) fail("missing source report asset");
    for (const name of reportAssets) if (assets[name] !== `generations/${manifest.snapshotId}/${name}`) fail("unsupported source report asset mapping");
  }
  if (manifest.navigation !== undefined || manifest.assets !== undefined) {
    if (manifest.navigation !== `generations/${manifest.snapshotId}/navigation.html`) fail("unsupported navigation mapping");
    const assets = record(manifest.assets, "navigation assets");
    keys(assets, navigationAssets, "navigation assets");
    // Restore valid older three-asset generations during an extension update.
    // Current renderers always emit the force module; exact new mappings are
    // checked by native publication tests rather than invalidating old recovery.
    const expected = navigationAssets.filter((name,index) => index < 3 || Object.hasOwn(assets,name));
    if (Object.keys(assets).length !== expected.length) fail("missing navigation asset");
    for (const name of expected) if (assets[name] !== `generations/${manifest.snapshotId}/${name}`) fail("unsupported navigation asset mapping");
  }
  if (manifest.exports !== undefined) {
    const exports = record(manifest.exports, "export assets");
    keys(exports, [...exportFiles,...packageFiles], "export assets");
    const expected = packageFiles.some(name=>Object.hasOwn(exports,name)) ? [...exportFiles,...packageFiles] : exportFiles;
    if (Object.keys(exports).length !== expected.length) fail("missing export asset");
    for (const name of expected) if (exports[name] !== `generations/${manifest.snapshotId}/${name}`) fail("unsupported export mapping");
  }
  if (manifest.registry !== undefined || manifest.composition !== undefined) {
    if (manifest.registry !== `generations/${manifest.snapshotId}/registry.json`) fail("invalid graph registry mapping");
    const files = record(manifest.composition, "composed graph artifacts");
    if (files["registry.json"] !== manifest.registry) fail("missing composed graph registry");
    for (const [name, value] of Object.entries(files)) {
      if (!/^(?:registry\.json|source-origins\.json|query-provider\.js|site-search(?:-index\.json|\.js|\.css)|reading-route\.js|(?:(?:graphs\/[a-z][a-z0-9-]{0,63}\/)?(?:delivery(?:-index\.json|\.json|\.js)|topics\/[a-f0-9]{64}\.json|query\.js|reading-route\.js))|graphs\/[a-z][a-z0-9-]{0,63}\/(?:graph\.json|index\.json|report\.html|navigation\.html|mapping\.json|graph-view\.js|graph-view\.css|graph-force\.js|graph-label-layout\.js|graph-theme\.js))$/.test(name)
          || value !== `generations/${manifest.snapshotId}/${name}`) fail("unsupported composed graph artifact mapping");
    }
  }
  return manifest;
}

function mappings(manifest: Record<string, any>): Omit<Artifact, "hash">[] {
  return [
    { path: manifest.graph, cacheName: "graph.json" },
    { path: manifest.index, cacheName: "index.json" },
    { path: manifest.report, cacheName: "report.html" },
    { path: "report.html", cacheName: "report-alias.html" },
    ...(manifest.navigation ? [{ path: manifest.navigation, cacheName: "navigation.html" },
      ...navigationAssets.filter(name => Object.hasOwn(manifest.assets, name)).map(name => ({ path: manifest.assets[name], cacheName: name }))] : []),
    ...(manifest.reportAssets ? reportAssets.map(name => ({ path: manifest.reportAssets[name], cacheName: `report-${name}` })) : []),
    ...(manifest.exports ? [...exportFiles,...packageFiles].filter(name=>Object.hasOwn(manifest.exports,name)).map(name => ({ path: manifest.exports[name], cacheName: name })) : []),
    ...(manifest.composition ? Object.entries(manifest.composition).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([name, path]) => ({ path: path as string, cacheName: `composition-${name.replaceAll("/", "--")}` })) : []),
  ];
}

function validateNavigationModule(path: string, bytes: Uint8Array, manifest: Record<string, any>): void {
  if (/(?:^|\/)report\.html$/.test(path)) {
    const html = new TextDecoder().decode(bytes);
    for (const match of html.matchAll(/\b(?:href|src)\s*=\s*["']([^"']*(?:graph-view\.css|graph-theme\.js))["']/g)) {
      const url = new URL(match[1], `https://publication.invalid/${path}`);
      if (url.origin !== 'https://publication.invalid' || !mappings(manifest).some(mapping => mapping.path === url.pathname.slice(1))) fail("source report references an undeclared stylesheet/theme asset; no graph restored");
    }
  }
  if (!/(?:^|\/)graph-view\.js$/.test(path)) return;
  const importsForce = /(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)["']\.\/graph-force\.js["']/.test(new TextDecoder().decode(bytes));
  if (importsForce && !mappings(manifest).some(mapping => mapping.path === path.replace(/graph-view\.js$/, "graph-force.js"))) {
    fail("navigator imports an undeclared graph-force.js module; no graph restored");
  }
  if (/(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)["']\.\/graph-label-layout\.js["']/.test(new TextDecoder().decode(bytes)) && !mappings(manifest).some(mapping => mapping.path === path.replace(/graph-view\.js$/, "graph-label-layout.js"))) fail("navigator imports undeclared graph-label-layout.js; no graph restored");
  if (/from\s*["']\.\/delivery\.js["']/.test(new TextDecoder().decode(bytes)) && !mappings(manifest).some(mapping => mapping.path === path.replace(/graph-view\.js$/, "delivery.js"))) fail("navigator imports undeclared delivery.js; no graph restored");
  if (/from\s*["']\.\/reading-route\.js["']/.test(new TextDecoder().decode(bytes)) && !mappings(manifest).some(mapping => mapping.path === path.replace(/graph-view\.js$/, "reading-route.js"))) fail("navigator imports undeclared reading-route.js; no graph restored");
  if (/(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)["']\.\/graph-theme\.js["']/.test(new TextDecoder().decode(bytes)) && !mappings(manifest).some(mapping => mapping.path === path.replace(/graph-view\.js$/, "graph-theme.js"))) fail("navigator imports undeclared graph-theme.js; no graph restored");
}

async function validate(value: unknown): Promise<CacheRecord> {
  const cached = record(value, "publication cache record");
  keys(cached, ["cacheVersion", "manifest", "manifestHash", "artifacts", "capturedAt"], "publication cache record");
  const manifest = manifestValue(cached.manifest), expected = mappings(manifest);
  if (![0, 1].includes(cached.cacheVersion) || cached.cacheVersion === 1 && !captureDate(cached.capturedAt)
    || cached.cacheVersion === 0 && cached.capturedAt !== undefined || !Array.isArray(cached.artifacts) || cached.artifacts.length !== expected.length
    || cached.manifestHash !== await digest(`${canonical(manifest)}\n`)) fail("invalid publication cache record");
  const expectedMappings = new Set(expected.map(item => `${item.path}\n${item.cacheName}`)), seen = new Set<string>();
  cached.artifacts.forEach((value: unknown) => {
    const artifact = record(value, "cached artifact");
    keys(artifact, ["path", "cacheName", "hash"], "cached artifact");
    const identity = `${artifact.path}\n${artifact.cacheName}`;
    if (!expectedMappings.has(identity) || seen.has(identity)
      || typeof artifact.hash !== "string" || !hashPattern.test(artifact.hash)) fail("invalid cached artifact mapping/hash");
    seen.add(identity);
  });
  // Input order is not receipt identity. Native/coordinator callers may produce
  // the same complete inventory in different orders without changing its facts.
  return { ...cached, artifacts: [...cached.artifacts].sort(artifactOrder) } as CacheRecord;
}

async function writeBytes(root: string, path: string, bytes: Uint8Array, privateCache = false): Promise<void> {
  // Public output recovery retains the ordinary project boundary. Managed cache
  // storage additionally refuses every descendant junction/symbolic link, even
  // when it points to another location inside this same project.
  const target = (value: string) => privateCache ? privatePath(root, value) : confined(root, value);
  const destination = await target(path);
  await Deno.mkdir(dirname(destination), { recursive: true });
  const pending = await target(`${path}.${crypto.randomUUID()}.pending`);
  await Deno.writeFile(pending, bytes);
  await Deno.rename(pending, await target(path));
}

/** Stage only validated public bytes. The old cache pointer remains unchanged. */
export async function stagePublication(root: string, outputDir: string, value: unknown): Promise<CacheRecord> {
  const manifest = manifestValue(value), manifestHash = await digest(`${canonical(manifest)}\n`), artifacts: Artifact[] = [];
  const directory = cacheDirectory({ cacheVersion: 1, manifest, manifestHash });
  // Check the complete destination ancestry before copying even the first
  // artifact. A private receipt must not be staged through a public junction.
  await privatePath(root, directory);
  for (const mapping of mappings(manifest)) {
    const bytes = await Deno.readFile(await confined(root, outputPath(outputDir, `${PUBLIC}/${mapping.path}`)));
    validateNavigationModule(mapping.path, bytes, manifest);
    const hash = await digest(bytes);
    const cachedPath = `${directory}/${mapping.cacheName}`;
    try {
      if (await digest(await Deno.readFile(await privatePath(root, cachedPath))) !== hash) fail("immutable publication cache conflict");
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
      await writeBytes(root, cachedPath, bytes, true);
    }
    artifacts.push({ ...mapping, hash });
  }
  return { cacheVersion: 1, manifest, manifestHash, artifacts: artifacts.sort(artifactOrder), capturedAt: new Date().toISOString() };
}

/** Call only after committing the matching public manifest. */
export async function commitPublicationCache(root: string, value: unknown): Promise<void> {
  let receipt = await validate(value);
  const historical = await privatePath(root, `${cacheDirectory(receipt)}/receipt.json`);
  try {
    const previous = await validate(await readJson(historical));
    // The first successful capture date belongs to this immutable receipt. A
    // repeated commit of identical bytes must not manufacture another capture.
    const { capturedAt: _previousDate, ...previousContent } = previous;
    const { capturedAt: _newDate, ...receiptContent } = receipt;
    if (canonical(previousContent) !== canonical(receiptContent)) fail('immutable private publication receipt conflict');
    receipt = previous;
  } catch (error) { if (!(error instanceof Deno.errors.NotFound)) throw error; await atomicJson(historical, receipt); }
  await atomicJson(await privatePath(root, pointer), receipt);
}

/** Recover graph artifacts cleared by Quarto; this is not a whole-site rollback. */
export async function restorePublication(root: string, outputDir: string): Promise<void> {
  if(await producerWithdrawalPending(root))return;
  const manifestPath = outputPath(outputDir, `${PUBLIC}/manifest.json`);
  let existing: Record<string, any> | null = null;
  try { existing = manifestValue(await readJson(await confined(root, manifestPath))); }
  catch (error) { if (!(error instanceof Deno.errors.NotFound)) throw error; }
  let cached: CacheRecord;
  try { cached = await validate(await readJson(await privatePath(root, pointer))); }
  catch (error) { if (error instanceof Deno.errors.NotFound) return; throw error; }
  if (existing && await digest(`${canonical(existing)}\n`) !== cached.manifestHash) {
    fail("public manifest differs from its committed recovery pointer; inspect local state before recovery");
  }
  // Read and verify all bytes before writing any public artifact. Digests detect
  // accidental cache damage; they do not authenticate the cache's producer.
  const staged: { path: string; bytes: Uint8Array }[] = [];
  for (const artifact of cached.artifacts) {
    const path = `${cacheDirectory(cached)}/${artifact.cacheName}`;
    const bytes = await Deno.readFile(await privatePath(root, path));
    if (await digest(bytes) !== artifact.hash) fail("cached publication artifact hash mismatch; no graph restored");
    validateNavigationModule(artifact.path, bytes, cached.manifest);
    const destination = outputPath(outputDir, `${PUBLIC}/${artifact.path}`);
    let needsRepair = false;
    try { needsRepair = await digest(await Deno.readFile(await confined(root, destination))) !== artifact.hash; }
    catch (error) { if (!(error instanceof Deno.errors.NotFound)) throw error; needsRepair = true; }
    // Keep every integrity check, but retain/rewrite only damaged or missing
    // destinations. Intact artifacts need no buffered copy or filesystem write.
    if (needsRepair) staged.push({ path: destination, bytes });
  }
  if (cached.manifest.registry) {
    const registry = await Deno.readFile(await privatePath(root, `${cacheDirectory(cached)}/composition-registry.json`));
    const alias = outputPath(outputDir, `${PUBLIC}/registry.json`);
    let repair = false;
    try { repair = await digest(await Deno.readFile(await confined(root, alias))) !== await digest(registry); }
    catch (error) { if (!(error instanceof Deno.errors.NotFound)) throw error; repair = true; }
    if (repair) staged.push({ path: alias, bytes: registry });
  }
  if (existing !== null && !staged.length) return;
  for (const artifact of staged) await writeBytes(root, artifact.path, artifact.bytes);
  await atomicJson(await confined(root, manifestPath), cached.manifest);
}
