import { atomicJson, canonical, confined, digest, fail, keys, PUBLIC, readJson, record, STATE } from "./core.ts";
import { dirname } from "stdlib/path";
import { outputPath } from "./context.ts";

type Artifact = { path: string; cacheName: string; hash: string };
type CacheRecord = { cacheVersion: number; manifest: Record<string, any>; manifestHash: string; artifacts: Artifact[] };
const pointer = `${STATE}/public/committed.json`;
const hashPattern = /^[a-f0-9]{64}$/;
const navigationAssets = ["query.js", "graph-view.js", "graph-view.css"];
const exportFiles = ["dataset.jsonld", "objects.csv", "relations.csv", "public-schema.json"];

function manifestValue(value: unknown): Record<string, any> {
  const manifest = record(value, "cached publication manifest");
  keys(manifest, ["contractVersion", "snapshotId", "status", "dependencyDigest", "graph", "index", "report", "navigation", "assets", "exports"], "cached publication manifest");
  if (manifest.contractVersion !== 0 || typeof manifest.snapshotId !== "string" || !hashPattern.test(manifest.snapshotId)
    || typeof manifest.dependencyDigest !== "string" || !hashPattern.test(manifest.dependencyDigest)
    || !["complete", "incomplete"].includes(manifest.status)) fail("invalid cached publication manifest");
  for (const [field, filename] of [["graph", "graph.json"], ["index", "index.json"], ["report", "report.html"]]) {
    if (manifest[field] !== `generations/${manifest.snapshotId}/${filename}`) fail("cached manifest has an unsupported artifact mapping");
  }
  if (manifest.navigation !== undefined || manifest.assets !== undefined) {
    if (manifest.navigation !== `generations/${manifest.snapshotId}/navigation.html`) fail("unsupported navigation mapping");
    const assets = record(manifest.assets, "navigation assets");
    keys(assets, navigationAssets, "navigation assets");
    if (Object.keys(assets).length !== navigationAssets.length) fail("missing navigation asset");
    for (const name of navigationAssets) if (assets[name] !== `generations/${manifest.snapshotId}/${name}`) fail("unsupported navigation asset mapping");
  }
  if (manifest.exports !== undefined) {
    const exports = record(manifest.exports, "export assets");
    keys(exports, exportFiles, "export assets");
    if (Object.keys(exports).length !== exportFiles.length) fail("missing export asset");
    for (const name of exportFiles) if (exports[name] !== `generations/${manifest.snapshotId}/${name}`) fail("unsupported export mapping");
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
      ...navigationAssets.map(name => ({ path: manifest.assets[name], cacheName: name }))] : []),
    ...(manifest.exports ? exportFiles.map(name => ({ path: manifest.exports[name], cacheName: name })) : []),
  ];
}

async function validate(value: unknown): Promise<CacheRecord> {
  const cached = record(value, "publication cache record");
  keys(cached, ["cacheVersion", "manifest", "manifestHash", "artifacts"], "publication cache record");
  const manifest = manifestValue(cached.manifest), expected = mappings(manifest);
  if (cached.cacheVersion !== 0 || !Array.isArray(cached.artifacts) || cached.artifacts.length !== expected.length
    || cached.manifestHash !== await digest(`${canonical(manifest)}\n`)) fail("invalid publication cache record");
  cached.artifacts.forEach((value: unknown, index: number) => {
    const artifact = record(value, "cached artifact");
    keys(artifact, ["path", "cacheName", "hash"], "cached artifact");
    if (artifact.path !== expected[index].path || artifact.cacheName !== expected[index].cacheName
      || typeof artifact.hash !== "string" || !hashPattern.test(artifact.hash)) fail("invalid cached artifact mapping/hash");
  });
  return cached as CacheRecord;
}

async function writeBytes(root: string, path: string, bytes: Uint8Array): Promise<void> {
  const destination = await confined(root, path);
  await Deno.mkdir(dirname(destination), { recursive: true });
  const pending = await confined(root, `${path}.${crypto.randomUUID()}.pending`);
  await Deno.writeFile(pending, bytes);
  await Deno.rename(pending, destination);
}

/** Stage only validated public bytes. The old cache pointer remains unchanged. */
export async function stagePublication(root: string, outputDir: string, value: unknown): Promise<CacheRecord> {
  const manifest = manifestValue(value), artifacts: Artifact[] = [];
  for (const mapping of mappings(manifest)) {
    const bytes = await Deno.readFile(await confined(root, outputPath(outputDir, `${PUBLIC}/${mapping.path}`)));
    const hash = await digest(bytes);
    const cachedPath = `${STATE}/public/generations/${manifest.snapshotId}/${mapping.cacheName}`;
    try {
      if (await digest(await Deno.readFile(await confined(root, cachedPath))) !== hash) fail("immutable publication cache conflict");
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
      await writeBytes(root, cachedPath, bytes);
    }
    artifacts.push({ ...mapping, hash });
  }
  return { cacheVersion: 0, manifest, manifestHash: await digest(`${canonical(manifest)}\n`), artifacts };
}

/** Call only after committing the matching public manifest. */
export async function commitPublicationCache(root: string, value: unknown): Promise<void> {
  await atomicJson(await confined(root, pointer), await validate(value));
}

/** Recover graph artifacts cleared by Quarto; this is not a whole-site rollback. */
export async function restorePublication(root: string, outputDir: string): Promise<void> {
  const manifestPath = outputPath(outputDir, `${PUBLIC}/manifest.json`);
  let existing: Record<string, any> | null = null;
  try { existing = manifestValue(await readJson(await confined(root, manifestPath))); }
  catch (error) { if (!(error instanceof Deno.errors.NotFound)) throw error; }
  let cached: CacheRecord;
  try { cached = await validate(await readJson(await confined(root, pointer))); }
  catch (error) { if (error instanceof Deno.errors.NotFound) return; throw error; }
  if (existing && await digest(`${canonical(existing)}\n`) !== cached.manifestHash) {
    fail("public manifest differs from its committed recovery pointer; inspect local state before recovery");
  }
  // Read and verify all bytes before writing any public artifact. Digests detect
  // accidental cache damage; they do not authenticate the cache's producer.
  const staged: { path: string; bytes: Uint8Array }[] = [];
  for (const artifact of cached.artifacts) {
    const path = `${STATE}/public/generations/${cached.manifest.snapshotId}/${artifact.cacheName}`;
    const bytes = await Deno.readFile(await confined(root, path));
    if (await digest(bytes) !== artifact.hash) fail("cached publication artifact hash mismatch; no graph restored");
    const destination = outputPath(outputDir, `${PUBLIC}/${artifact.path}`);
    let needsRepair = false;
    try { needsRepair = await digest(await Deno.readFile(await confined(root, destination))) !== artifact.hash; }
    catch (error) { if (!(error instanceof Deno.errors.NotFound)) throw error; needsRepair = true; }
    // Keep every integrity check, but retain/rewrite only damaged or missing
    // destinations. Intact artifacts need no buffered copy or filesystem write.
    if (needsRepair) staged.push({ path: destination, bytes });
  }
  if (existing !== null && !staged.length) return;
  for (const artifact of staged) await writeBytes(root, artifact.path, artifact.bytes);
  await atomicJson(await confined(root, manifestPath), cached.manifest);
}
