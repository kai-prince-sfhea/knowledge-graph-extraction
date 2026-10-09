import { atomicJson, confined, environmentList, fail, loadProject, readJson, STATE } from "./core.ts";
import { activeContext, log } from "./context.ts";
import { restorePublication } from "./publication.ts";
import { readExtractionCache, reusable, sourceKeys } from "./cache.ts";
import { gitProvenance } from "./git.ts";
import { requireImportedBaselineRender } from "./baseline-state.ts";
import { groupBy } from "./grouping.ts";

async function clearRunPointer(root: string): Promise<void> {
  try { await Deno.remove(await confined(root, `${STATE}/run.json`)); }
  catch (error) { if (!(error instanceof Deno.errors.NotFound)) throw error; }
}

const context = await activeContext();
if (context === null) {
  // Discard a prior run's ephemeral pointer so a disabled document observer
  // cannot append to a completed or failed run. Never create inactive state;
  // validated generations, recovery pointers and run history remain intact.
  await clearRunPointer(await Deno.realPath(Deno.cwd()));
  Deno.exit(0);
}
const { root, inspection, outputDir } = context;
// Quarto can clean the output directory before invoking this hook. Restore
// only the last validated graph before parsing potentially invalid new input.
await restorePublication(root, outputDir);
const inputs = environmentList("QUARTO_PROJECT_INPUT_FILES", true);
if (!inputs.length) {
  // Reopening an unchanged website preview legitimately renders no inputs.
  // Retain validated generations without letting an old run receive observations.
  await clearRunPointer(root);
  log("no input pages rendered; previous graph retained");
  Deno.exit(0);
}
const project = await loadProject(root, inspection);
const selected = new Set<string>(project.sources);
const rendered = inputs.filter((path) => selected.has(path));
const renderedSet = new Set(rendered);
const full = project.sources.every((path: string) => renderedSet.has(path));
await requireImportedBaselineRender(root, project.mode, full);
const cache = project.cacheEnabled ? await readExtractionCache(root) : null;
const keys = await sourceKeys(project, outputDir);
const reused: Record<string, any> = {};
const cacheReasons: Record<string, string> = {};
for (const source of project.sources) {
  if (renderedSet.has(source)) continue;
  const candidate = project.cacheEnabled ? await reusable(root, outputDir, source, keys[source], cache, project.cacheUnsafeSources) : { reason: "cache-disabled" };
  if (candidate.entry) reused[source] = candidate.entry;
  else cacheReasons[source] = candidate.reason!;
}
if (project.mode === "frozen") {
  let previous;
  try { previous = await readJson(await confined(root, `${STATE}/last-complete.json`)); }
  catch { fail("frozen mode requires a previously validated complete snapshot; run an update build"); }
  if (previous.dependencyDigest !== project.dependencyDigest) fail("frozen snapshot dependencies changed; rebuild in update mode");
  if (!full && !project.sources.every((source: string) => renderedSet.has(source) || reused[source])) {
    fail("frozen mode requires matching cached HTML/observations for every unrendered source; make a complete update render");
  }
}
const runId = crypto.randomUUID();
const anchorsBySource = groupBy<any>(project.objects.flatMap((item: any) => [item.source, ...item.occurrences]), entry => entry.path);
const run = { contractVersion: 0, runId, stateDir: STATE, mode: project.mode, full,
  sources: project.sources.map((path: string) => ({ path,
    expectedAnchors: [...new Set((anchorsBySource.get(path) ?? []).map((entry: any) => entry.anchor))].sort() })),
  renderedSources: rendered.sort(), dependencyDigest: project.dependencyDigest,
  dependencies: project.dependencies, outputDir, sourceKeys: keys, sourceDependencies: project.sourceDependencies,
  cacheEnabled: project.cacheEnabled, authoringEnabled: project.authoringEnabled, reused, cacheReasons, git: await gitProvenance(root, project.gitEnabled) };
await Deno.mkdir(await confined(root, `${STATE}/runs/${runId}/observations`), { recursive: true });
await atomicJson(await confined(root, `${STATE}/run.json`), run);
await atomicJson(await confined(root, `${STATE}/runs/${runId}/prepared.json`), run);
log(`prepared ${rendered.length}/${project.sources.length} selected pages (${run.mode})`);
