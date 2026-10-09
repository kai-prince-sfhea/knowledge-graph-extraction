import { atomicJson, canonical, confined, digest, environmentList, escapeHtml, fail, loadProject,
  observationName, publicRecord, PUBLIC, readJson, STATE, VERSION } from "./core.ts";
import { dirname, isAbsolute, join, relative } from "stdlib/path";
import { activeContext, log, outputPath, outputRoot } from "./context.ts";
import { htmlIds } from "./html.ts";
import { commitPublicationCache, stagePublication } from "./publication.ts";
import { CacheEntry, commitExtractionCache, readExtractionCache, reusable, semanticObservation, sourceKeys } from "./cache.ts";
import { commitGitBaseline } from "./git.ts";
import { buildGraphView } from "./graph-view.ts";
import { buildExports } from "./exports.ts";
import { authoringObservations } from "./authoring.ts";
import { importedBaseline, requireImportedBaselineRender } from "./baseline-state.ts";
import { privatePath } from "./private-path.ts";
import { groupBy } from "./grouping.ts";

const context = await activeContext();
if (context === null) Deno.exit(0);
const { root, inspection } = context;
const outputFiles = environmentList("QUARTO_PROJECT_OUTPUT_FILES", true);
if (!outputFiles.length) {
  log("no output pages rendered; previous graph retained");
  Deno.exit(0);
}
const run = await readJson(await confined(root, `${STATE}/run.json`));
const project = await loadProject(root, inspection);
await requireImportedBaselineRender(root, project.mode, run.full === true && run.cacheOnly !== true);
if (run.dependencyDigest !== project.dependencyDigest) fail("inputs changed during rendering; no graph committed");
const output = await outputRoot(root, run.outputDir);
const cached = project.cacheEnabled ? await readExtractionCache(root) : null;
const keys = await sourceKeys(project, run.outputDir);
const observations = new Map<string, any>();
const destinations = new Map<string, string>();
const htmlOutputs = new Map<string, { path: string; hash: string }>();
const hits: string[] = [], misses: string[] = [], observedSources: string[] = [];
const reasons: Record<string, string> = {};
const skippedSources: { path: string; reason: string }[] = [];
const objectsBySource = groupBy<any>(project.objects, item => item.source.path);
const declaredOccurrencesBySource = groupBy<any>(project.objects.flatMap((item: any) => item.occurrences), item => item.path);
const relationsBySource = groupBy<any>(project.relations, item => item.source.path);
const outputFileSet = new Set(outputFiles);
const renderedSet = new Set<string>(run.renderedSources);
for (const source of run.renderedSources) {
  const directory = `${STATE}/runs/${run.runId}/observations`;
  let observation;
  try { observation = await readJson(await confined(root, `${directory}/${observationName(source)}`)); }
  catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
    const markers = [];
    for await (const entry of Deno.readDir(await confined(root, directory))) {
      if (entry.isFile && entry.name.startsWith(`${observationName(source)}.skip-`) && entry.name.endsWith(".json")) {
        const marker = await readJson(await confined(root, `${directory}/${entry.name}`));
        if (marker.runId !== run.runId || marker.source !== source || !["disabled", "unsupported-format"].includes(marker.status)) fail("invalid skipped-source marker");
        markers.push(marker);
      }
    }
    if (!markers.length && !outputFiles.some(path => /\.html?$/i.test(path))) {
      // A format-specific HTML filter does not run at all for --to docx, etc.
      // Native non-HTML outputs therefore need no fabricated AST observation.
      skippedSources.push({ path: source, reason: "unsupported-format" });
      continue;
    }
    if (!markers.length) fail("a selected source has no observation; ensure the named filter applies to each selected document");
    skippedSources.push({ path: source, reason: markers.some(marker => marker.status === "disabled") ? "disabled" : "unsupported-format" });
    continue;
  }
  if (observation.runId !== run.runId || observation.source !== source) fail("observation belongs to a different run/source");
  if (observation.status !== "observed") fail("unsupported primary observation status");
  if (typeof observation.output !== "string" || !observation.output) fail("HTML observer did not record Quarto's output path");
  const observed = isAbsolute(observation.output) ? relative(root, observation.output).replaceAll("\\", "/")
    : observation.output.replaceAll("\\", "/");
  const candidates = [...new Set([observed, outputPath(run.outputDir, join(dirname(source), observed).replaceAll("\\", "/")),
    outputPath(run.outputDir, observed)].filter(path => outputFileSet.has(path)))];
  if (candidates.length !== 1) fail("cannot resolve one actual HTML destination from Quarto's output inventory; check output-file and output-dir");
  const relativeOutput = candidates[0];
  const expected = relative(output, await confined(root, relativeOutput)).replaceAll("\\", "/");
  if (expected.startsWith("../") || isAbsolute(expected)) fail("an HTML output escaped the selected output directory");
  const html = await Deno.readTextFile(await confined(root, relativeOutput));
  htmlOutputs.set(source, { path: relativeOutput, hash: await digest(new TextEncoder().encode(html)) });
  const counts = htmlIds(html);
  const anchors = new Set(Array.isArray(observation.anchors) ? observation.anchors : []);
  for (const item of objectsBySource.get(source) ?? []) {
    if (!anchors.has(item.source.anchor) || counts.get(item.source.anchor) !== 1) fail("object declaration source needs one observed/rendered anchor");
  }
  for (const occurrence of declaredOccurrencesBySource.get(source) ?? []) {
      if (!anchors.has(occurrence.anchor) || counts.get(occurrence.anchor) !== 1) fail("declared occurrence needs exactly one observed and rendered anchor");
      destinations.set(`${source}#${occurrence.anchor}`, `${expected.split("/").map(encodeURIComponent).join("/")}#${encodeURIComponent(occurrence.anchor)}`);
  }
  for (const relation of relationsBySource.get(source) ?? []) {
    if (!anchors.has(relation.source.anchor) || counts.get(relation.source.anchor) !== 1) fail("relation declaration source needs one observed/rendered anchor");
  }
  observations.set(source, observation);
  observedSources.push(source);
}

if (!observations.size && !run.cacheOnly && !skippedSources.some(entry => entry.reason === "disabled")) {
  await atomicJson(await confined(root, `${STATE}/runs/${run.runId}/finalized.json`), { runId: run.runId, status: "no-html-observations" });
  log("no selected HTML observations; native outputs retained and previous graph unchanged");
  Deno.exit(0);
}

// Revalidate both input closure and output bytes for every unrendered page.
for (const source of project.sources) {
  if (renderedSet.has(source)) continue;
  const candidate = project.cacheEnabled ? await reusable(root, run.outputDir, source, keys[source], cached, project.cacheUnsafeSources) : { reason: "cache-disabled" };
  if (!candidate.entry) { reasons[source] = candidate.reason!; misses.push(source); continue; }
  observations.set(source, { ...candidate.entry.observation, runId: run.runId, source });
  htmlOutputs.set(source, { path: candidate.entry.output, hash: candidate.entry.htmlHash });
}
const complete = project.sources.every((source: string) => observations.has(source));
const byId = (a: any, b: any) => a.id === b.id ? 0 : a.id < b.id ? -1 : 1;
const objects = project.objects.filter((item: any) => item.eligible && observations.has(item.source.path))
  .map((item: any) => publicRecord(project.schema, "object", item)).sort(byId);
const eligible = new Set(objects.map((item: any) => item.id));
const relations = project.relations.filter((item: any) => item.eligible && observations.has(item.source.path) && eligible.has(item.from) && eligible.has(item.to))
  .map((item: any) => publicRecord(project.schema, "relation", item)).sort(byId);
const occurrences: { id: string; target: string; source: any; destination: string }[] = [];
for (const item of project.objects.filter((entry: any) => eligible.has(entry.id))) {
  for (const source of item.occurrences.filter((entry: any) => observations.has(entry.path))) {
    occurrences.push({ id: `sha256:${await digest(`${item.id}\n${source.path}\n${source.anchor}`)}`, target: item.id,
      source, destination: destinations.get(`${source.path}#${source.anchor}`) ??
        `${relative(output, await confined(root, htmlOutputs.get(source.path)!.path)).replaceAll("\\", "/").split("/").map(encodeURIComponent).join("/")}#${encodeURIComponent(source.anchor)}` });
  }
}
occurrences.sort((a, b) => a.id === b.id ? 0 : a.id < b.id ? -1 : 1);
const entries: Record<string, CacheEntry> = {};
const publicObjectsBySource = groupBy<any>(objects, item => item.source.path);
const publicRelationsBySource = groupBy<any>(relations, item => item.source.path);
const publicOccurrencesBySource = groupBy(occurrences, item => item.source.path);
for (const source of observations.keys()) {
  const observation = semanticObservation(observations.get(source));
  const parts = { objects: publicObjectsBySource.get(source) ?? [],
    relations: publicRelationsBySource.get(source) ?? [],
    occurrences: publicOccurrencesBySource.get(source) ?? [] };
  const previous = project.cacheEnabled ? cached?.entries[source] : undefined;
  const html = htmlOutputs.get(source)!;
  const matches = previous?.key === keys[source] && previous.htmlHash === html.hash
    && canonical(previous.observation) === canonical(observation) && canonical(previous.parts) === canonical(parts);
  if (matches) { hits.push(source); entries[source] = previous!; }
  else { if (!misses.includes(source)) misses.push(source); reasons[source] ??= "fresh-extraction";
    entries[source] = { key: keys[source], output: html.path, htmlHash: html.hash, observation, parts }; }
}
const content = { contractVersion: 0, extractorVersion: VERSION, status: complete ? "complete" : "incomplete",
  ...(project.schemaPath ? { schema: { version: project.schemaVersion, digest: project.schemaDigest } } : {}),
  ...(project.navigation || project.exportOptions ? { publication: {
    ...(project.navigation ? { navigation: true, runtimeDigest: await digest(canonical(project.dependencies.filter((item: any) => item.kind === "extractor"))) } : {}),
    ...(project.exportOptions ? { exports: project.exportOptions } : {}) } } : {}),
  scope: { sources: project.sources, renderedSources: [...observations.keys()].sort(), skippedSources }, objects, relations, occurrences };
const snapshotId = await digest(canonical(content));
const graph = { ...content, snapshotId };
const occurrencesByTarget = groupBy(occurrences, entry => entry.target);
const index = { contractVersion: 0, snapshotId, status: graph.status, objects: objects.map((item: any) => ({ id: item.id,
  type: item.type, scope: item.scope, labels: item.labels, ...(item.aliases ? { aliases: item.aliases } : {}), destinations: (occurrencesByTarget.get(item.id) ?? []).map((entry) => entry.destination) })) };
if (project.mode === "frozen") {
  const previous = await readJson(await confined(root, `${STATE}/last-complete.json`));
  if (previous.snapshotId !== snapshotId) fail("frozen render differs from validated semantic content; no graph committed");
}

// Only explicitly protected literals are scanned. Ordinary private labels are
// not global forbidden words; publication eligibility controls graph projection.
function protectedText(value: string): void {
  if (project.protectedLiterals.some((token: string) => value.includes(token))) fail("protected literal found in publication inventory; remove it from public outputs or revise protected-literals");
}
async function scan(directory: string): Promise<void> {
  for await (const entry of Deno.readDir(directory)) {
    if (entry.isSymlink) fail("publication inventory contains an unsupported symbolic link");
    protectedText(entry.name);
    const path = join(directory, entry.name);
    if (entry.isDirectory && path === join(output, PUBLIC)) continue;
    if (entry.isDirectory) await scan(path);
    else if (/\.(html|json|ya?ml|md|txt|js|css)$/i.test(entry.name)) {
      const value = await Deno.readTextFile(path);
      protectedText(value);
    }
  }
}
if (project.protectedLiterals.length) {
  if (run.outputDir === ".") {
    for (const file of outputFiles) if (/\.(html|json|ya?ml|md|txt|js|css)$/i.test(file)) protectedText(await Deno.readTextFile(await confined(root, file)));
  } else await scan(output);
}
const report = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Knowledge graph extraction report</title></head><body><main><h1>Knowledge graph extraction report</h1><p>Snapshot: <code>${snapshotId}</code></p><p>Coverage: <strong>${graph.status}</strong>, ${observations.size}/${project.sources.length} declared pages rendered. ${complete ? "Explicit author declarations; no automatic word matching or inference." : "Partial render: missing records are unknown, not absent. Run a full project render for complete coverage."}</p><p>Unspecified/private fields are excluded. Content is author-declared, not independently verified.</p><h2>Objects</h2><ul>${index.objects.map((item: any) => `<li><strong>${escapeHtml(Object.values(item.labels)[0])}</strong> (${escapeHtml(item.scope)}, ${escapeHtml(item.type)}) <code>${escapeHtml(item.id)}</code><ul>${item.destinations.map((destination: string) => `<li><a href="../${escapeHtml(destination)}">${escapeHtml(destination)}</a></li>`).join("")}</ul></li>`).join("")}</ul><h2>Relations</h2><ul>${relations.map((item: any) => `<li><code>${escapeHtml(item.type)}</code>: ${escapeHtml(item.from)} → ${escapeHtml(item.to)} (${escapeHtml(item.scope)})</li>`).join("")}</ul><p><a href="manifest.json">Machine-readable manifest</a></p></main></body></html>\n`;
const publicDirectory = join(output, PUBLIC);
const reportContent = report.replace("declared pages rendered", "declared pages validated")
  .replace("</main>", `${project.navigation ? `<p><a href="generations/${snapshotId}/navigation.html">Explore the graph</a></p>` : ""}</main>`);
protectedText(canonical(graph));
protectedText(canonical(index));
protectedText(reportContent);
const view = project.navigation ? await buildGraphView(graph, { graphUrl: "graph.json", assetPrefix: "./", sourcePrefix: "../../../", reportUrl: "report.html" }) : null;
const exported = buildExports(graph, project.schema, project.exportOptions);
const additional: Record<string, string> = { ...(view ? { "navigation.html": view.html, ...view.assets } : {}), ...exported.files };
for (const value of Object.values(additional)) protectedText(value);
const generation = await confined(root, outputPath(run.outputDir, `${PUBLIC}/generations/${snapshotId}`));
await Deno.mkdir(generation, { recursive: true });
const immutableReport = reportContent.replaceAll('href="../', 'href="../../../').replace('href="manifest.json"', 'href="../../manifest.json"')
  .replace(`href="generations/${snapshotId}/navigation.html"`, 'href="navigation.html"');
const reportPath = join(generation, "report.html");
try { if (await Deno.readTextFile(reportPath) !== immutableReport) fail("immutable generation report conflict"); }
catch (error) {
  if (!(error instanceof Deno.errors.NotFound)) throw error;
  await Deno.writeTextFile(`${reportPath}.pending`, immutableReport);
  await Deno.rename(`${reportPath}.pending`, reportPath);
}
for (const [name, value] of [["graph.json", graph], ["index.json", index]] as const) {
  const path = join(generation, name);
  try { if (canonical(await readJson(path)) !== canonical(value)) fail("immutable generation content conflict"); }
  catch (error) { if (!(error instanceof Deno.errors.NotFound)) throw error; await atomicJson(path, value); }
}
for (const [name, value] of Object.entries(additional)) {
  const path = join(generation, name);
  try { if (await Deno.readTextFile(path) !== value) fail("immutable generation artifact conflict"); }
  catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
    await Deno.writeTextFile(`${path}.pending`, value);
    await Deno.rename(`${path}.pending`, path);
  }
}
const manifest = { contractVersion: 0, snapshotId, status: graph.status, dependencyDigest: project.dependencyDigest,
  graph: `generations/${snapshotId}/graph.json`, index: `generations/${snapshotId}/index.json`, report: `generations/${snapshotId}/report.html`,
  ...(view ? { navigation: `generations/${snapshotId}/navigation.html`, assets: Object.fromEntries(Object.keys(view.assets).map(name => [name, `generations/${snapshotId}/${name}`])) } : {}),
  ...(Object.keys(exported.files).length ? { exports: Object.fromEntries(Object.keys(exported.files).map(name => [name, `generations/${snapshotId}/${name}`])) } : {}) };
await Deno.writeTextFile(join(publicDirectory, "report.html.pending"), reportContent);
await Deno.rename(join(publicDirectory, "report.html.pending"), join(publicDirectory, "report.html"));
const cachedPublication = await stagePublication(root, run.outputDir, manifest);
await atomicJson(join(publicDirectory, "manifest.json"), manifest);
await commitPublicationCache(root, cachedPublication);
// Superseded public generations must not keep withdrawn records reachable.
// Private recovery history remains outside all published resources.
for await (const entry of Deno.readDir(join(publicDirectory, "generations"))) {
  if (entry.name === snapshotId) continue;
  if (entry.isSymlink || !entry.isDirectory || !/^[a-f0-9]{64}$/.test(entry.name)) fail("unexpected managed generation; inspect the output before publishing");
  await Deno.remove(await confined(root, outputPath(run.outputDir, `${PUBLIC}/generations/${entry.name}`)), { recursive: true });
}
if (complete) {
  await commitExtractionCache(root, snapshotId, project.dependencyDigest, entries);
  await commitGitBaseline(root, run.git ?? {}, snapshotId);
  await atomicJson(await confined(root, `${STATE}/last-complete.json`), manifest);
  if (project.mode === "frozen" && run.full === true && run.cacheOnly !== true) {
    const imported = await importedBaseline(root);
    if (imported?.fullFrozenRenderRequired) await atomicJson(await privatePath(root, `${STATE}/baselines/imported.json`),
      { ...imported, fullFrozenRenderRequired: false, validatedSnapshotId: snapshotId });
  }
}
await atomicJson(await confined(root, `${STATE}/runs/${run.runId}/finalized.json`), { ...manifest,
  runId: run.runId, authoringEnabled: run.authoringEnabled === true,
  htmlOutputs: Object.fromEntries(htmlOutputs),
  ...(run.authoringEnabled === true ? { authoringObservationDigest: await digest(canonical(authoringObservations(observedSources.map(source => observations.get(source))))) } : {}),
  renderedSources: observedSources.sort(), cacheOnly: run.cacheOnly === true,
  cache: { enabled: project.cacheEnabled, hits: hits.sort(), misses: misses.sort(), observed: observedSources.sort(), reasons },
  git: run.git ?? { enabled: false } });
log(`${graph.status} snapshot; ${objects.length} public objects, ${relations.length} relations, ${occurrences.length} occurrences`);
