import { atomicJson, confined, environmentList, fail, loadProject, readJson, STATE } from "./core.ts";
import { activeContext, log } from "./context.ts";
import { restorePublication } from "./publication.ts";
import { readExtractionCache, reusable, sourceKeys } from "./cache.ts";
import { gitProvenance } from "./git.ts";
import { requireImportedBaselineRender } from "./baseline-state.ts";
import { groupBy } from "./grouping.ts";
import { preparedCspRunId } from "./integration-finalizers.ts";
import { preparedPrerequisites } from "./memberships.ts";
import { collectProducerGraphs } from './composed-publication.ts';
import { changedProducerInputs, enforceProducerWithdrawal } from './withdrawal.ts';
import { PRODUCER_PROPERTY_FIELDS } from './composition.ts';

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
// Detect changed producer bytes before parsing a potentially invalid import or
// recovering an older graph. A failed import cannot re-publish withdrawn data.
const changedProducer = await changedProducerInputs(root);
if(changedProducer) await enforceProducerWithdrawal(root,outputDir,changedProducer);
// Quarto can clean the output directory before invoking this hook. Restore
// only the last validated graph before parsing potentially invalid new input.
await restorePublication(root, outputDir);
const inputs = environmentList("QUARTO_PROJECT_INPUT_FILES", true);
// An unchanged preview still runs post-render hooks. Give that invocation its
// own non-observing run so finalization can verify producer withdrawals and
// finish deferred audits without reusing a previous run or fabricating coverage.
const project = await loadProject(root, inspection);
const selected = new Set<string>(project.sources);
const rendered = inputs.filter((path) => selected.has(path));
const renderedSet = new Set(rendered);
const full = inputs.length > 0 && project.sources.every((path: string) => renderedSet.has(path));
if (inputs.length) await requireImportedBaselineRender(root, project.mode, full);
const cache = project.cacheEnabled ? await readExtractionCache(root) : null;
const producerSourceKeys = await sourceKeys({ ...project, sources: project.producerSources }, outputDir);
const pendingProducer = await collectProducerGraphs(root,{runId:crypto.randomUUID(),outputDir,allRenderedSources:[],producerSourceKeys},project,[]);
if(pendingProducer.staleEntries.length)await enforceProducerWithdrawal(root,outputDir,pendingProducer);
const keys = Object.fromEntries(project.sources.map((source: string) => [source, producerSourceKeys[source]]));
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
  if (inputs.length && !full && !project.sources.every((source: string) => renderedSet.has(source) || reused[source])) {
    fail("frozen mode requires matching cached HTML/observations for every unrendered source; make a complete update render");
  }
}
const runId = crypto.randomUUID();
const cspRunId = project.config["content-security-protocol"] ? await preparedCspRunId(root) : undefined;
const anchorsBySource = groupBy<any>([...project.objects.flatMap((item: any) => [item.source, ...item.occurrences]), ...project.navigationLinks.map((item:any)=>item.source)], entry => entry.path);
const run = { contractVersion: 0, compositionVersion: 1, active: true, runId, stateDir: STATE, mode: project.mode, full,
  producerPropertyFields: [...PRODUCER_PROPERTY_FIELDS],
  ...(cspRunId ? { cspRunId } : {}),
  publicPrerequisites: preparedPrerequisites(project),
  sources: project.sources.map((path: string) => ({ path,
    expectedAnchors: [...new Set((anchorsBySource.get(path) ?? []).map((entry: any) => entry.anchor))].sort() })),
  renderedSources: rendered.sort(), allRenderedSources: inputs.sort(), dependencyDigest: project.dependencyDigest,
  dependencies: project.dependencies, outputDir, sourceKeys: keys, producerSourceKeys, sourceDependencies: project.sourceDependencies,
  cacheEnabled: project.cacheEnabled, authoringEnabled: project.authoringEnabled, reused, cacheReasons, git: await gitProvenance(root, project.gitEnabled) };
await Deno.mkdir(await confined(root, `${STATE}/runs/${runId}/observations`), { recursive: true });
await atomicJson(await confined(root, `${STATE}/run.json`), run);
await atomicJson(await confined(root, `${STATE}/runs/${runId}/prepared.json`), run);
log(inputs.length ? `prepared ${rendered.length}/${project.sources.length} selected pages (${run.mode})`
  : `prepared a non-observing verification run; no input pages rendered (${run.mode})`);
