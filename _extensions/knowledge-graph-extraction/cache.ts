import { atomicJson, canonical, confined, digest, fail, readJson, STATE } from "./core.ts";
import { relative } from "stdlib/path";
import { outputRoot } from "./context.ts";
import { privatePath } from "./private-path.ts";

const pointer = `${STATE}/extraction/committed.json`;
type Value = Record<string, any>;
export type CacheEntry = {
  key: string; output: string; htmlHash: string; observation: Value;
  parts: { objects: Value[]; relations: Value[]; occurrences: Value[] };
};
export type ExtractionCache = { cacheVersion: 1; snapshotId: string; dependencyDigest: string;
  entries: Record<string, CacheEntry>; nativeOutputs?: Record<string, string>; hash: string };

/** A bounded native destination inventory, not evidence of an AST observation,
 * source freshness or complete graph coverage. It deliberately retains paths of
 * unsafe/unobserved pages so a coordinator can refresh their managed head URLs. */
async function validateNativeOutputs(root: string, value: unknown): Promise<void> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length > 100000) {
    fail("invalid extraction native-output inventory; inspect private cache state before rebuilding");
  }
  for (const [source, output] of Object.entries(value as Record<string, unknown>)) {
    if (!/\.qmd$/i.test(source) || typeof output !== "string" || !/\.html?$/i.test(output)) {
      fail("invalid extraction native-output inventory; inspect private cache state before rebuilding");
    }
    // Confinement verifies paths even when their files are currently absent.
    // The coordinator additionally restricts these to the current input/output
    // inventory; this cache helper has no authority to invent that inventory.
    await confined(root, source); await confined(root, output);
  }
}

/** Successful finalized page observations, including an explicitly incomplete
 * aggregate. Last-complete publication/frozen baselines are separate pointers. */
export async function readExtractionCache(root: string): Promise<ExtractionCache | null> {
  let value: any;
  try { value = await readJson(await privatePath(root, pointer)); }
  catch (error) { if (error instanceof Deno.errors.NotFound) return null; throw error; }
  const { hash, ...content } = value;
  if (value.cacheVersion !== 1 || typeof hash !== "string" || hash !== await digest(canonical(content))
      || !value.entries || typeof value.entries !== "object" || Array.isArray(value.entries)) {
    fail("extraction cache integrity mismatch; run build.ts reset from the project root, then make a complete update render");
  }
  for (const [source, entry] of Object.entries(value.entries) as [string, CacheEntry][]) {
    await confined(root, source);
    await confined(root, entry.output);
    if (!/^[a-f0-9]{64}$/.test(entry.key) || !/^[a-f0-9]{64}$/.test(entry.htmlHash)
        || entry.observation?.source !== source || entry.observation?.status !== "observed"
        || !Array.isArray(entry.observation.anchors) || !Array.isArray(entry.observation.citations)
        || !entry.parts || [entry.parts.objects, entry.parts.relations, entry.parts.occurrences].some(v => !Array.isArray(v))) {
      fail("invalid extraction cache entry; run build.ts reset from the project root, then make a complete update render");
    }
  }
  if (value.nativeOutputs !== undefined) await validateNativeOutputs(root, value.nativeOutputs);
  return value;
}

/** Source/include bytes vary per page; metadata, schema and tool changes are conservative global invalidators. */
export async function sourceKeys(project: Value, outputDir: string): Promise<Record<string, string>> {
  const globals = project.dependencies.filter((entry: Value) => !["source", "include"].includes(entry.kind));
  const hashes = new Map<string, string>(project.dependencies.map((entry: Value) => [entry.path, entry.hash]));
  // Keep the exact cacheVersion:1 canonical bytes. Top-level keys sort as
  // cacheVersion, closure, globals, outputDir, source; only closure/source vary.
  // Factoring this invariant fragment avoids walking every global dependency
  // again for every page without changing hashes or invalidation semantics.
  const suffix = `,"globals":${canonical(globals)},"outputDir":${canonical(outputDir)},"source":`;
  const result: Record<string, string> = {};
  for (const source of project.sources) {
    const paths = project.sourceDependencies?.[source] ?? [source];
    const closure = canonical(paths.map((path: string) => ({ path, hash: hashes.get(path) })));
    result[source] = await digest(`{"cacheVersion":1,"closure":${closure}${suffix}${canonical(source)}}`);
  }
  return result;
}

export function semanticObservation(observation: Value): Value {
  return { source: observation.source, status: observation.status, sourcePrecision: observation.sourcePrecision,
    anchors: [...observation.anchors].sort(), citations: [...observation.citations].sort() };
}

export async function reusable(root: string, outputDir: string, source: string, key: string,
    cached: ExtractionCache | null, unsafeSources: string[] = []): Promise<{ entry?: CacheEntry; reason?: string }> {
  if (unsafeSources.includes(source)) return { reason: "requires-fresh-render" };
  const entry = cached?.entries[source];
  if (!entry) return { reason: "not-cached" };
  if (entry.key !== key) return { reason: "dependency-changed" };
  const output = await outputRoot(root, outputDir);
  const resolved = await confined(root, entry.output);
  const inside = relative(output, resolved).replaceAll("\\", "/");
  if (inside === ".." || inside.startsWith("../")) return { reason: "output-moved" };
  let bytes;
  try { bytes = await Deno.readFile(resolved); }
  catch (error) { if (error instanceof Deno.errors.NotFound) return { reason: "output-missing" }; throw error; }
  if (await digest(bytes) !== entry.htmlHash) return { reason: "rendered-html-changed" };
  return { entry };
}

export async function commitExtractionCache(root: string, snapshotId: string, dependencyDigest: string,
    entries: Record<string, CacheEntry>, nativeOutputs?: Record<string, string>): Promise<void> {
  if (nativeOutputs !== undefined) await validateNativeOutputs(root, nativeOutputs);
  // Omitting the optional inventory preserves exact historic cache bytes and
  // hash preimages. An explicitly supplied empty mapping remains meaningful.
  const content = { cacheVersion: 1, snapshotId, dependencyDigest, entries,
    ...(nativeOutputs === undefined ? {} : { nativeOutputs }) };
  await atomicJson(await privatePath(root, pointer), { ...content, hash: await digest(canonical(content)) });
}
