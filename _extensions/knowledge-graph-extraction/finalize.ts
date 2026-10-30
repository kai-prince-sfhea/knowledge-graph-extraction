import { atomicJson, canonical, confined, digest, environmentList, escapeHtml, fail, loadProject,
  observationName, publicRecord, PUBLIC, readJson, STATE, VERSION } from "./core.ts";
import { dirname, isAbsolute, join, relative } from "stdlib/path";
import { activeContext, log, outputPath, outputRoot } from "./context.ts";
import { htmlIds } from "./html.ts";
import { commitPublicationCache, stagePublication } from "./publication.ts";
import { CacheEntry, commitExtractionCache, readExtractionCache, reusable, semanticObservation, sourceKeys } from "./cache.ts";
import { commitGitBaseline } from "./git.ts";
import { buildGraphView, graphViewRuntimeIdentity } from "./graph-view.ts";
import { buildPackageExports } from "./package-export.ts";
import { authoringObservations } from "./authoring.ts";
import { importedBaseline, requireImportedBaselineRender } from "./baseline-state.ts";
import { privatePath } from "./private-path.ts";
import { groupBy } from "./grouping.ts";
import { collectProducerGraphs, compositionArtifacts, declarationGraphParts, finishComposition, commitProducerState } from "./composed-publication.ts";
import { finalizeDeferredSecurity } from "./integration-finalizers.ts";
import { compositionIdentity } from "./composition.ts";
import { buildDelivery } from "./delivery.ts";
import { buildSourceOrigins } from './source-origins.ts';
import { buildQueryProvider } from './query-provider.ts';
import { siteSearchIdentity, siteSearchArtifacts, planSiteSearch, applySiteSearch, nativeSearchOutputs } from "./site-search-finalizer.ts";
import { withCompositionTransaction } from './composition-transaction.ts';
import { inGraph } from "./memberships.ts";
import { changedProducerInputs, clearProducerWithdrawal, enforceProducerWithdrawal } from './withdrawal.ts';

const context = await activeContext();
if (context === null) Deno.exit(0);
const { root, inspection } = context;
const outputFiles = environmentList("QUARTO_PROJECT_OUTPUT_FILES", true);
const run = await readJson(await confined(root, `${STATE}/run.json`));
let producer:any=null;
try {
const project = await loadProject(root, inspection);
if (run.dependencyDigest !== project.dependencyDigest) fail("inputs changed during rendering; no graph committed");
// Successful unrelated/non-HTML renders still have to withdraw known stale
// generated projections. Unchanged producers retain their existing semantics.
producer = await collectProducerGraphs(root, run, project, outputFiles);
if (!outputFiles.length && !producer.changed) {
  await atomicJson(await confined(root, `${STATE}/runs/${run.runId}/finalized.json`), { runId: run.runId, snapshotId: null, status: "no-output-pages" });
  await finalizeDeferredSecurity(root, run, null);
  log("no output pages rendered; previous graph retained");
  Deno.exit(0);
}
await requireImportedBaselineRender(root, project.mode, run.full === true && run.cacheOnly !== true);
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
const navigationLinksBySource = groupBy<any>(project.navigationLinks, item => item.source.path);
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
  for (const link of navigationLinksBySource.get(source) ?? []) {
    if (!anchors.has(link.source.anchor) || counts.get(link.source.anchor) !== 1) fail('navigation link needs one observed/rendered source anchor');
  }
  observations.set(source, observation);
  observedSources.push(source);
}

if (!observations.size && !run.cacheOnly && !skippedSources.some(entry => entry.reason === "disabled") && !producer.changed) {
  await atomicJson(await confined(root, `${STATE}/runs/${run.runId}/finalized.json`), { runId: run.runId, snapshotId: null, status: "no-html-observations" });
  await finalizeDeferredSecurity(root, run, null);
  log("no selected HTML observations; native outputs retained and previous graph unchanged");
  Deno.exit(0);
}

// Revalidate both input closure and output bytes for every unrendered page.
const unsupportedSources = new Set(skippedSources.filter(entry => entry.reason === "unsupported-format").map(entry => entry.path));
for (const source of project.sources) {
  if (renderedSet.has(source) && !unsupportedSources.has(source)) continue;
  const candidate = project.cacheEnabled ? await reusable(root, run.outputDir, source, keys[source], cached, project.cacheUnsafeSources) : { reason: "cache-disabled" };
  if (!candidate.entry) { reasons[source] = candidate.reason!; misses.push(source); continue; }
  observations.set(source, { ...candidate.entry.observation, runId: run.runId, source });
  htmlOutputs.set(source, { path: candidate.entry.output, hash: candidate.entry.htmlHash });
}
const freshProducerSources = new Set(producer.parts.map(part => part.source));
for (const entry of producer.staleEntries) if (!freshProducerSources.has(entry.source)) { observations.delete(entry.source); htmlOutputs.delete(entry.source); }
const complete = project.sources.every((source: string) => observations.has(source)) && producer.stale.length === 0;
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
const declaredGraphs = declarationGraphParts(project, objects, relations, occurrences);
const websiteIds = new Set(project.objects.filter((item: any) => inGraph(item,'website')).map((item: any) => item.id));
const websiteRelations = new Set(project.relations.filter((item:any)=>inGraph(item,'website')).map((item:any)=>item.id));
const hasComposedGraphs = declaredGraphs.length > 0 || producer.parts.length > 0 || producer.stale.length > 0;
// Cached observations already bind exact native output hashes and anchor sets.
const federationIds = new Set<string>(project.federationOptions?.graphs ?? []);
const selectedNavigationLinks = project.navigationLinks.filter((item:any)=>federationIds.has(item.from.graph)||federationIds.has(item.to.graph));
project.admittedNavigationLinks = selectedNavigationLinks.filter((item:any)=>item.eligible && observations.has(item.source.path)
  && observations.get(item.source.path).anchors.includes(item.source.anchor)).map(({eligible,...item}:any)=>item);
project.unobservedNavigationLinks = selectedNavigationLinks.filter((item:any)=>item.eligible).length-project.admittedNavigationLinks.length;
const nativeSearchDigest = await siteSearchIdentity(root, run.outputDir, producer,
  project.searchFilter && project.config?.website?.search !== false && project.config?.search !== false);
const readingCapability = project.readingOptions.enabled && (project.navigation || hasComposedGraphs) ? project.readingOptions : null;
const capabilities = {
  queryProvider:{version:1,apiVersion:1},
  ...(project.sourceOriginPaths.length ? {sourceOrigins:{version:1,publicPaths:project.sourceOriginPaths}} : {}),
  ...(readingCapability ? {reading:readingCapability} : {}),
  ...(project.deliveryOptions ? {delivery: project.deliveryOptions} : {}),
  ...(nativeSearchDigest ? {siteSearch: {version: 1, nativeDigest: nativeSearchDigest}} : {}),
  ...(project.federationOptions ? {federation:{...project.federationOptions,links:project.admittedNavigationLinks,unobserved:project.unobservedNavigationLinks,
    memberships:project.objects.filter((item:any)=>item.eligible&&item.graphIds?.length>1).map((item:any)=>({id:item.id,graphs:item.graphIds}))}} : {}) };
const runtimeDigest = project.navigation || hasComposedGraphs || capabilities ? await digest(canonical(graphViewRuntimeIdentity(project.dependencies.filter((item: any) => item.kind === "extractor"), project.viewOptions, project.queryProfiles))) : undefined;
const compositionDigest = await digest(canonical(compositionIdentity(declaredGraphs, producer, runtimeDigest, capabilities)));
const content = { contractVersion: 0, extractorVersion: VERSION, status: complete ? "complete" : "incomplete",
  ...(project.schemaPath ? { schema: { version: project.schemaVersion, digest: project.schemaDigest } } : {}),
  publication: { compositionDigest,
    ...(project.navigation ? { navigation: true, runtimeDigest } : {}),
    ...(project.exportOptions ? { exports: project.exportOptions } : {}),
    ...(project.packageOptions ? { package: project.packageOptions } : {}) },
  scope: { sources: project.sources, renderedSources: [...observations.keys()].sort(), skippedSources },
  objects: objects.filter((item: any) => websiteIds.has(item.id)),
  relations: relations.filter((item: any) => websiteRelations.has(item.id) && websiteIds.has(item.from) && websiteIds.has(item.to)),
  occurrences: occurrences.filter(item => websiteIds.has(item.target)) };
const snapshotId = await digest(canonical(content));
const graph = { ...content, snapshotId };
const occurrencesByTarget = groupBy(graph.occurrences, entry => entry.target);
const index = { contractVersion: 0, snapshotId, status: graph.status, objects: graph.objects.map((item: any) => ({ id: item.id,
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
let reportContent = report.replace("declared pages rendered", "declared pages validated")
  .replace("</main>", `${project.navigation ? `<p><a href="generations/${snapshotId}/navigation.html">Explore the graph</a></p>` : ""}</main>`);
protectedText(canonical(graph));
protectedText(canonical(index));
protectedText(reportContent);
const view = project.navigation ? await buildGraphView(graph, { graphUrl: "graph.json", ...(project.deliveryOptions ? {deliveryUrl:"delivery.json"}:{}), readingOptions:project.readingOptions, assetPrefix: "./", sourcePrefix: "../../../", reportUrl: "report.html", view: project.viewOptions, queryProfiles: project.queryProfiles }) : null;
const exported = await buildPackageExports(graph, project.schema, project.exportOptions, project.packageOptions);
const composition = await compositionArtifacts(snapshotId, graph, project, producer, declaredGraphs);
if(project.sourceOriginPaths.length){
  const paths=new Set<string>();
  for(const value of composition.graphValues)for(const occurrence of value.graph.occurrences)for(const path of project.sourceDependencies[occurrence.source.path]??[]){if(/[.](?:qmd|md)$/i.test(path))paths.add(path);}
  if(paths.size>512)fail('source origin input inventory exceeds 512 files; narrow the declared graph or disable source-origins');
  const files=[];let bytes=0;
  for(const path of [...paths].sort()){
    let cursor=root;
    for(const [index,part]of path.split('/').entries()){
      cursor=join(cursor,part);const entry=await Deno.lstat(cursor);
      if(entry.isSymlink||!(index===path.split('/').length-1?entry.isFile:entry.isDirectory))fail('source origins require ordinary source files and directories');
    }
    const absolute=await confined(root,path),info=await Deno.stat(absolute);
    if(!info.isFile||info.size>2*1024*1024||(bytes+=info.size)>16*1024*1024)fail('source origin inputs exceed their file/total byte budget');
    const data=await Deno.readFile(absolute),text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(data);
    files.push({path,text,sha256:project.dependencies.find((item:any)=>item.path===path&&['source','include'].includes(item.kind))?.hash});
  }
  const origins=await buildSourceOrigins(composition.graphValues,files,project.sourceDependencies,project.sourceOriginPaths);
  if(origins){Object.assign(composition.files,origins.files);reportContent=reportContent.replace('</main>',`<p><a href="generations/${snapshotId}/source-origins.json">Original source coordinates</a>. Token positions and, where unambiguous, hash-bound original heading sections or fenced Divs. Includes retain their separate original-file coordinates; these do not establish semantic equivalence or proof validity.</p></main>`);}
}
const readingGraphs=composition.registry.graphs.filter((entry:any)=>typeof entry.navigation==='string').map((entry:any)=>({id:entry.id,label:entry.label,graphUrl:`knowledge-graph/${entry.graph}`,navigationUrl:`knowledge-graph/${entry.navigation}`}));
if(composition.registry.federation?.navigation){const entry=composition.registry.federation;readingGraphs.push({id:entry.id,label:entry.label,graphUrl:`knowledge-graph/${entry.graph}`,navigationUrl:`knowledge-graph/${entry.navigation}`});}
const reading=readingCapability&&readingGraphs.length?{snapshotId,graphs:readingGraphs,activities:readingCapability.activities}:null;
if(reading){for(const name of ['reading-route.js','query.js'])composition.files[name]=await Deno.readTextFile(new URL(`./${name}`,import.meta.url));}
if (project.deliveryOptions) {
  const delivery = await buildDelivery(graph, project.deliveryOptions);
  Object.assign(composition.files, delivery.files);
  composition.files['delivery.js'] = await Deno.readTextFile(new URL('./delivery.js', import.meta.url));
  if (!view) composition.files['query.js'] = await Deno.readTextFile(new URL('./query.js', import.meta.url));
  composition.registry.graphs[0].delivery = { ...delivery.descriptor, manifest: `generations/${snapshotId}/delivery.json` };
  composition.files['registry.json'] = `${canonical(composition.registry)}\n`;
}
const siteSearch = await siteSearchArtifacts(root, run.outputDir, snapshotId, composition, producer, project.searchFilter);
const queryModuleSource=await Deno.readTextFile(new URL('./query.js',import.meta.url));
composition.files['query.js']=queryModuleSource;
composition.files['query-provider.js']=await Deno.readTextFile(new URL('./query-provider.js',import.meta.url));
for(const entry of [...composition.registry.graphs,...(composition.registry.federation?[composition.registry.federation]:[])]){
  entry.queryProvider=await buildQueryProvider({snapshotId,graphId:entry.id,status:entry.status,graphUrl:entry.graph,
    queryModuleURL:`generations/${snapshotId}/query.js`,queryModuleSource,delivery:entry.delivery,profiles:project.queryProfiles});
}
composition.files['registry.json']=`${canonical(composition.registry)}\n`;
reportContent = reportContent.replace("</main>", `<section><h2>Separate public graphs</h2><ul>${composition.registry.graphs.map((entry: any) => `<li>${entry.navigation ? `<a href="${escapeHtml(entry.navigation)}">${escapeHtml(entry.label)}</a>` : escapeHtml(entry.label)} (${escapeHtml(entry.status)})</li>`).join("")}</ul></section></main>`);
if(composition.registry.federation) {const entry=composition.registry.federation;reportContent=reportContent.replace('</main>',`<p><a href="${escapeHtml(entry.navigation || entry.report)}">${escapeHtml(entry.label)}</a> (${escapeHtml(entry.status)}).</p></main>`);}
const additional: Record<string, string> = { ...(view ? { "navigation.html": view.html, ...view.assets } : {}), ...exported.files, ...composition.files };
for (const value of Object.values(additional)) protectedText(value);
const generation = await confined(root, outputPath(run.outputDir, `${PUBLIC}/generations/${snapshotId}`));
await Deno.mkdir(generation, { recursive: true });
const immutableReport = reportContent.replaceAll('href="../', 'href="../../../').replace('href="manifest.json"', 'href="../../manifest.json"')
  .replaceAll(`href="generations/${snapshotId}/`, 'href="');
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
  await Deno.mkdir(dirname(path), { recursive: true });
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
  ...(Object.keys(exported.files).length ? { exports: Object.fromEntries(Object.keys(exported.files).map(name => [name, `generations/${snapshotId}/${name}`])) } : {}),
  registry: `generations/${snapshotId}/registry.json`, composition: Object.fromEntries(Object.keys(composition.files).map(name => [name, `generations/${snapshotId}/${name}`])) };
// Explicit native observations only; an output-dir of '.' must never turn an
// enhancement into a recursive visit to private state or authored templates.
const nativeOutputs:Record<string,string>={...(cached?.nativeOutputs??{}),
  ...Object.fromEntries(Object.entries(cached?.entries??{}).map(([source,item]:any)=>[source,item.output])),
  ...Object.fromEntries([...htmlOutputs].map(([source,item])=>[source,item.path])),
  ...Object.fromEntries(Object.values(producer.entries).map((item:any)=>[item.envelope.source,item.output]))};
for(const [source,path]of Object.entries(nativeOutputs)){
  const inside=relative(output,join(root,path)).replaceAll('\\','/');
  if(!project.inputSources.includes(source)||!inside||inside.startsWith('../')||isAbsolute(inside))delete nativeOutputs[source];
}
const nativeHtmlPaths = [...new Set([...outputFiles.filter(path=>/\.html?$/i.test(path)),
  ...await nativeSearchOutputs(root,run.outputDir),
  ...Object.values(nativeOutputs),
  ...[...htmlOutputs.values()].map(item=>item.path), ...Object.values(producer.entries).map((item:any)=>item.output),
  ...(producer.staleEntries??[]).map((item:any)=>item.output)])].filter(path=>{
    const inside=relative(output,join(root,path)).replaceAll('\\','/');
    return inside && !inside.startsWith('../') && !isAbsolute(inside)
      && !['knowledge-graph','site_libs','local-ai-assets'].includes(inside.split('/')[0])
      && !path.split('/').some(part=>['.quarto','.git','_extensions'].includes(part));
  });
const presentHtmlPaths:string[]=[];
for(const path of nativeHtmlPaths){try{await Deno.stat(await confined(root,path));presentHtmlPaths.push(path);}catch(error){if(!(error instanceof Deno.errors.NotFound))throw error;}}
const transactionalPaths=[...presentHtmlPaths, ...['search.json',`${PUBLIC}/registry.json`,`${PUBLIC}/report.html`,`${PUBLIC}/manifest.json`].map(path=>outputPath(run.outputDir,path)),
  `${STATE}/producers/committed.json`,`${STATE}/public/committed.json`,`${STATE}/extraction/committed.json`];
await withCompositionTransaction(root,run.outputDir,transactionalPaths,async()=>{
  await finishComposition(root,run.outputDir,composition,producer);
  const searchPlan=await planSiteSearch(root,run.outputDir,siteSearch,presentHtmlPaths,reading);
  await applySiteSearch(searchPlan);
  await Deno.writeTextFile(join(publicDirectory,'report.html.pending'),reportContent);
  await Deno.rename(join(publicDirectory,'report.html.pending'),join(publicDirectory,'report.html'));
  // Composition adds only a navigation view to producer pages. Bind subsequent
  // cache reuse to their final bytes instead of the earlier unenhanced HTML.
  for (const record of Object.values(producer.entries) as any[]) {
    if (entries[record.envelope.source]) entries[record.envelope.source].htmlHash = record.htmlHash;
    const html = htmlOutputs.get(record.envelope.source);
    if (html) html.hash = record.htmlHash;
  }
  // Search assets are also inserted into unchanged native pages. Bind every
  // extraction/producer receipt to the final bytes, not its pre-enhancement HTML.
  for (const [source, record] of htmlOutputs) {
    record.hash = await digest(await Deno.readFile(await confined(root, record.path)));
    if (entries[source]) entries[source].htmlHash = record.hash;
  }
  for (const record of Object.values(producer.entries) as any[]) {
    record.htmlHash = await digest(await Deno.readFile(await confined(root, record.output)));
  }
  // finishComposition stored producer hashes before the optional native-search
  // enhancement. Refresh the same validated receipt without repeating transforms.
  await commitProducerState(root, producer);
  // Retain validated observations even when some other sources need a fresh
  // render. This pointer describes observed pages, never a complete baseline.
  // Rebind managed HTML changes so the next partial render can reuse them.
  await commitExtractionCache(root,snapshotId,project.dependencyDigest,entries,nativeOutputs);

  const cachedPublication=await stagePublication(root,run.outputDir,manifest);
  await atomicJson(join(publicDirectory,'manifest.json'),manifest);
  await commitPublicationCache(root,cachedPublication);
});
// Superseded public generations must not keep withdrawn records reachable.
// Private recovery history remains outside all published resources.
for await (const entry of Deno.readDir(join(publicDirectory, "generations"))) {
  if (entry.name === snapshotId) continue;
  if (entry.isSymlink || !entry.isDirectory || !/^[a-f0-9]{64}$/.test(entry.name)) fail("unexpected managed generation; inspect the output before publishing");
  await Deno.remove(await confined(root, outputPath(run.outputDir, `${PUBLIC}/generations/${entry.name}`)), { recursive: true });
}
if (complete) {
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
await finalizeDeferredSecurity(root, run, snapshotId);
await clearProducerWithdrawal(root);
log(`${graph.status} snapshot; ${objects.length} public objects, ${relations.length} relations, ${occurrences.length} occurrences`);
}catch(error){
  const changed=await changedProducerInputs(root);
  const withdrawn=producer?.staleEntries?.length ? producer : changed;
  if(withdrawn)await enforceProducerWithdrawal(root,run.outputDir,withdrawn);
  throw error;
}
