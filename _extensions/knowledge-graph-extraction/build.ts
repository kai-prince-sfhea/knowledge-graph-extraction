// Explicit extraction-only assembly from validated native HTML observations.
// This entry point never invokes render, inference, model download or Git writes.
import { atomicJson, confined, fail, loadProject, readJson, STATE } from "./core.ts";
import { activeContext } from "./context.ts";
import { readExtractionCache, reusable, sourceKeys } from "./cache.ts";
import { gitProvenance } from "./git.ts";
import { restorePublication } from "./publication.ts";
import { requireImportedBaselineRender } from "./baseline-state.ts";
import { resetExtractionCache } from "./cache-reset.ts";

const mode = Deno.args[0] ?? "update";
const usage = "usage: quarto run <extension>/build.ts [update|frozen|inspect|reset [--dry-run]]";
if (mode === "reset") {
  if (Deno.args.length > 2 || (Deno.args[1] !== undefined && Deno.args[1] !== "--dry-run")) fail(usage);
  console.log(JSON.stringify(await resetExtractionCache(Deno.cwd(), Deno.args[1] === "--dry-run"), null, 2));
  Deno.exit(0);
}
if (!["update", "frozen", "inspect"].includes(mode) || Deno.args.length > 1) fail(usage);
if (mode !== "inspect") Deno.env.set("KG_MODE", mode);
const context = await activeContext();
if (!context) fail("activate knowledge-graph-extraction in a Quarto project before assembling a graph");
const { root, inspection, outputDir } = context;
const project = await loadProject(root, inspection);
if (mode !== "inspect") await requireImportedBaselineRender(root, project.mode, false);
if (!project.cacheEnabled) fail("cached assembly requires knowledge-graph.cache: true; enable it and render the project first");
const cache = await readExtractionCache(root), keys = await sourceKeys(project, outputDir);
const reused: Record<string, any> = {}, reasons: Record<string, string> = {};
for (const source of project.sources) {
  const result = await reusable(root, outputDir, source, keys[source], cache, project.cacheUnsafeSources);
  if (result.entry) reused[source] = result.entry;
  else reasons[source] = result.reason!;
}
if (mode === "inspect") {
  console.log(JSON.stringify({ cacheVersion: cache?.cacheVersion ?? null, snapshotId: cache?.snapshotId ?? null,
    currentDependencyDigest: project.dependencyDigest, cachedDependencyDigest: cache?.dependencyDigest ?? null,
    reusable: Object.keys(reused).sort(), stale: reasons, authority: "source-dependency-and-html-hashes" }, null, 2));
  Deno.exit(0);
}
if (Object.keys(reasons).length) fail("cached extraction is missing/stale or needs a fresh AST observation; run a complete quarto render before build.ts");
if (project.mode === "frozen") {
  const previous = await readJson(await confined(root, `${STATE}/last-complete.json`));
  if (previous.dependencyDigest !== project.dependencyDigest) fail("frozen snapshot dependencies changed; rebuild in update mode");
}
await restorePublication(root, outputDir);
const runId = crypto.randomUUID();
const run = { contractVersion: 0, runId, stateDir: STATE, mode: project.mode, full: false, cacheOnly: true,
  sources: project.sources.map((path: string) => ({ path, expectedAnchors: reused[path].observation.anchors })),
  renderedSources: [], dependencyDigest: project.dependencyDigest, dependencies: project.dependencies,
  outputDir, sourceKeys: keys, sourceDependencies: project.sourceDependencies, cacheEnabled: true, reused,
  cacheReasons: {}, git: await gitProvenance(root, project.gitEnabled) };
await Deno.mkdir(await confined(root, `${STATE}/runs/${runId}/observations`), { recursive: true });
await atomicJson(await confined(root, `${STATE}/run.json`), run);
await atomicJson(await confined(root, `${STATE}/runs/${runId}/prepared.json`), run);
Deno.env.set("QUARTO_PROJECT_OUTPUT_FILES", Object.values(reused).map(value => value.output).join("\n"));
Deno.env.delete("QUARTO_USE_FILE_FOR_PROJECT_OUTPUT_FILES");
await import("./finalize.ts");
