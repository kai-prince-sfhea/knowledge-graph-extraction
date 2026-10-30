import { atomicJson, canonical, confined, digest, escapeHtml, fail, readJson, STATE } from "./core.ts";
import { dirname, isAbsolute, join, relative } from "stdlib/path";
import { outputPath, outputRoot } from "./context.ts";
import { graphDefinition, graphIndex, mergePublicGraph, producerEnvelope, withGraphSearch, withoutPageSearch } from "./composition.ts";
import { buildDelivery } from "./delivery.ts";
import { inGraph, memberships } from "./memberships.ts";
import { htmlIds } from "./html.ts";
import { buildGraphView } from "./graph-view.ts";
import { graphReportHtml, graphReportAssets, graphRegionHtml } from "./graph-view.ts";
import { sourceKeys } from "./cache.ts";
import { buildFederation } from './federation.ts';
type Value = Record<string, any>;
const pointer = `${STATE}/producers/committed.json`;

/** Producers can render outside an explicitly narrowed website source list. */
export async function hasStagedPublicProducer(root: string, run: Value): Promise<boolean> {
  try {
    const directory = await confined(root, `${STATE}/runs/${run.runId}/producers`);
    for await (const entry of Deno.readDir(directory)) if (entry.isFile && entry.name.endsWith(".json")) return true;
    return false;
  } catch (error) { if (error instanceof Deno.errors.NotFound) return false; throw error; }
}

/** Fresh rendered pages replace their own contributions; untouched pages are
 * reused only while declared dependencies, context and actual HTML still match. */
export async function collectProducerGraphs(root: string, run: Value, project: Value, outputFiles: string[]) {
  const currentKeys = await sourceKeys({ ...project, sources: project.producerSources ?? project.inputSources.filter((path: string) => /\.qmd$/i.test(path)) }, run.outputDir);
  const contextDigest = await digest(canonical({ outputDir: run.outputDir, dependencies: project.dependencies.filter((entry: Value) => !["source", "include"].includes(entry.kind)) }));
  let previous: Value = { entries: {} };
  try {
    previous = await readJson(await confined(root, pointer));
    const { hash, ...content } = previous;
    if (previous.producerCacheVersion !== 1 || hash !== await digest(canonical(content))) fail("public producer cache integrity mismatch; make a complete render after inspecting private state");
  } catch (error) { if (!(error instanceof Deno.errors.NotFound)) throw error; }
  const rendered = new Set<string>(run.allRenderedSources ?? run.renderedSources), entries: Value = {}, staleCandidates: Value[] = [];
  const freshOutputs = new Set<string>();
  let changed = false;
  const replaced = (entry: Value) => rendered.has(entry.source) && outputFiles.includes(entry.output);
  async function retainStale(entry: Value) {
    changed = true;
    try { await Deno.stat(await confined(root, entry.output)); }
    catch (error) { if (error instanceof Deno.errors.NotFound) return; throw error; }
    const graph = graphDefinition(entry.graph);
    staleCandidates.push({ graph, source: entry.source, output: entry.output, producer: entry.producer });
  }
  for (const entry of previous.staleEntries ?? []) {
    if (replaced(entry)) { changed = true; continue; }
    await retainStale(entry);
  }
  for (const [key, raw] of Object.entries(previous.entries) as [string, Value][]) {
    const envelope = producerEnvelope(raw.envelope);
    if (replaced({ source: envelope.source, output: raw.output })) { changed = true; continue; }
    let valid = !(project.producerCacheUnsafeSources ?? []).includes(envelope.source)
      && project.inputSources.includes(envelope.source) && raw.contextDigest === contextDigest
      && raw.sourceKey !== undefined && raw.sourceKey === currentKeys[envelope.source];
    try {
      for (const dependency of raw.dependencies) if (await digest(await Deno.readFile(await confined(root, dependency.path))) !== dependency.hash) valid = false;
      if (await digest(await Deno.readFile(await confined(root, raw.output))) !== raw.htmlHash) valid = false;
    } catch (error) { if (!(error instanceof Deno.errors.NotFound)) throw error; valid = false; }
    if (valid) entries[key] = { ...raw, envelope };
    else await retainStale({ graph: envelope.graph, source: envelope.source, output: raw.output, producer: envelope.producer });
  }
  const output = await outputRoot(root, run.outputDir);
  const directory = `${STATE}/runs/${run.runId}/producers`;
  let staged: Deno.DirEntry[] = [];
  try {
    for await (const entry of Deno.readDir(await confined(root, directory))) staged.push(entry);
  } catch (error) { if (!(error instanceof Deno.errors.NotFound)) throw error; }
    for (const entry of staged.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      if (!entry.isFile || !entry.name.endsWith(".json")) fail("unexpected producer staging file");
      const stagedPath = await confined(root, `${directory}/${entry.name}`);
      if ((await Deno.stat(stagedPath)).size > 8 * 1024 * 1024) fail("public producer envelope exceeds 8 MiB; split the source catalogue");
      const envelope = producerEnvelope(await readJson(stagedPath), run.runId);
      if (!rendered.has(envelope.source) || !project.inputSources.includes(envelope.source)) fail("producer source is outside this render's native input inventory");
      if (!currentKeys[envelope.source] || run.producerSourceKeys?.[envelope.source] !== currentKeys[envelope.source]) fail("producer source or metadata changed during rendering; no graph committed");
      const observed = isAbsolute(envelope.output) ? relative(root, envelope.output).replaceAll("\\", "/") : envelope.output.replaceAll("\\", "/");
      const candidates = [...new Set([observed, outputPath(run.outputDir, join(dirname(envelope.source), observed).replaceAll("\\", "/")), outputPath(run.outputDir, observed)].filter(path => outputFiles.includes(path)))];
      if (candidates.length !== 1 || !/\.html?$/i.test(candidates[0])) fail("producer needs one actual HTML output in Quarto's output inventory");
      const path = candidates[0], destination = relative(output, await confined(root, path)).replaceAll("\\", "/");
      if (destination.startsWith("../") || isAbsolute(destination)) fail("producer HTML output escaped the website");
      const html = await Deno.readTextFile(await confined(root, path)), anchors = htmlIds(html);
      for (const item of [...envelope.objects, ...envelope.relations]) if (anchors.get(item.source.anchor) !== 1) fail("public producer record needs exactly one rendered source anchor");
      const dependencies = [];
      for (const dependency of envelope.dependencies) {
        const bytes = await Deno.readFile(await confined(root, dependency));
        const hash = await digest(bytes);
        if (dependency !== envelope.source) {
          const receipt = envelope.dependencyDigests.find((entry: Value) => entry.path === dependency);
          if (!receipt) fail("producer dependency needs an original-reader byte digest; update the companion extension");
          // SHA-1 is a native Pandoc byte-change receipt, not a signature or
          // authentication mechanism. Persistent reuse always uses SHA-256.
          const observed = receipt.algorithm === "sha256" ? hash : [...new Uint8Array(await crypto.subtle.digest("SHA-1", bytes))].map(byte => byte.toString(16).padStart(2, "0")).join("");
          if (observed !== receipt.digest) fail("producer dependency changed after it was read; no graph committed");
        }
        dependencies.push({ path: dependency, hash });
      }
      const occurrences = [];
      for (const item of envelope.objects) occurrences.push({ id: `sha256:${await digest(`${envelope.graph.id}\n${item.id}\n${envelope.source}\n${item.source.anchor}`)}`, target: item.id,
        source: item.source, destination: `${destination.split("/").map(encodeURIComponent).join("/")}#${encodeURIComponent(item.source.anchor)}` });
      const key = `${envelope.source}\n${envelope.producer}`;
      if (Object.hasOwn(entries, key)) fail("one producer source emitted multiple graph envelopes; choose one graph per producer page");
      entries[key] = { envelope, output: path, occurrences, dependencies, contextDigest, sourceKey: currentKeys[envelope.source], htmlHash: await digest(html) };
      freshOutputs.add(path);
      changed = true;
    }
  // A renamed/replacement source can intentionally retain its output-file.
  // Only a freshly admitted producer can take ownership of that actual output;
  // an old source tombstone must not quarantine its validated replacement.
  const staleEntries = staleCandidates.filter(entry => !freshOutputs.has(entry.output));
  const stale = staleEntries.map(entry => entry.graph);
  const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
  const parts = Object.entries(entries).sort(([a], [b]) => compare(a, b)).map(([, entry]: [string, any]) => ({ ...entry.envelope,
    objects: [...entry.envelope.objects].sort((a, b) => compare(a.id, b.id)),
    relations: [...entry.envelope.relations].sort((a, b) => compare(a.id, b.id)),
    occurrences: [...entry.occurrences].sort((a, b) => compare(a.id, b.id)) }));
  return { entries, staleEntries, changed, stale: [...new Map(stale.map(graph => [graph.id, graph])).values()].sort((a, b) => compare(a.id, b.id)), parts };
}

export function declarationGraphParts(project: Value, objects: Value[], relations: Value[], occurrences: Value[]) {
  const ids = new Map<string,Value>(project.objects.map((item: Value) => [item.id, item]));
  const edges = new Map<string,Value>(project.relations.map((item:Value)=>[item.id,item]));
  return project.graphDefinitions.filter((definition: Value) => definition.id !== "website").map((graph: Value) => ({ graph,
    objects: objects.filter(item => inGraph(ids.get(item.id)!,graph.id)), relations: relations.filter(item => inGraph(edges.get(item.id)!,graph.id)),
    occurrences: occurrences.filter(item => inGraph(ids.get(item.target)!,graph.id)) }));
}

/** Produce all graph artifacts inside the same immutable generation as the
 * legacy website graph, so no next-render fetch of stale data is required. */
export async function compositionArtifacts(snapshotId: string, websiteGraph: Value, project: Value, producer: Value, declared: Value[]) {
  const definitions = new Map<string, any>(), groups = new Map<string, Value[]>();
  const declaredIds = new Set(declared.map(part => part.graph.id));
  if ([...producer.parts.map((part: Value) => part.graph), ...producer.stale].some((definition: Value) => declaredIds.has(definition.id))) fail("a producer graph id is already owned by declaration graphs; choose a separate graph id");
  const owners = new Map<string, string>();
  for (const part of producer.parts) {
    if (owners.has(part.graph.id) && owners.get(part.graph.id) !== part.producer) fail("different domain producers cannot implicitly share one graph id");
    owners.set(part.graph.id, part.producer);
  }
  for (const part of [...declared, ...producer.parts]) {
    const definition = graphDefinition(part.graph);
    if (!definitions.has(definition.id)) definitions.set(definition.id, definition);
    const values = groups.get(definition.id) ?? []; values.push(part); groups.set(definition.id, values);
  }
  for (const stale of producer.stale) if (!definitions.has(stale.id)) { definitions.set(stale.id, stale); groups.set(stale.id, []); }
  const files: Record<string, string> = {}, registry: Value = { registryVersion: 1, snapshotId, graphs: [] }, graphValues = [];
  const website = project.graphDefinitions.find((entry: Value) => entry.id === "website");
  registry.graphs.push({ ...website, snapshotId, status: websiteGraph.status, graph: `generations/${snapshotId}/graph.json`, index: `generations/${snapshotId}/index.json`,
    ...(project.navigation ? { navigation: `generations/${snapshotId}/navigation.html` } : { navigation: false }) });
  graphValues.push({ definition: website, graph: websiteGraph });
  for (const [id, definition] of [...definitions].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    const status = producer.stale.some((entry: Value) => entry.id === id) || (declared.some(part => part.graph.id === id) && websiteGraph.status !== "complete") ? "incomplete" : "complete";
    const graph = { ...mergePublicGraph(groups.get(id)!, definition, status), snapshotId };
    const base = `graphs/${id}`, entry: Value = { ...definition, snapshotId, status, graph: `generations/${snapshotId}/${base}/graph.json`, index: `generations/${snapshotId}/${base}/index.json` };
    files[`${base}/graph.json`] = `${canonical(graph)}\n`;
    files[`${base}/index.json`] = `${canonical(graphIndex(graph))}\n`;
    files[`${base}/report.html`] = graphReportHtml(graph, { sourcePrefix: "../../../../../", embedded: true, view: project.viewOptions });
    for (const [name, value] of Object.entries(await graphReportAssets())) files[`${base}/${name}`] = value;
    entry.report = `generations/${snapshotId}/${base}/report.html`;
    if (project.deliveryOptions) {
      const delivery = await buildDelivery(graph, project.deliveryOptions);
      for (const [name, value] of Object.entries(delivery.files)) files[`${base}/${name}`] = value;
      files[`${base}/delivery.js`] = await Deno.readTextFile(new URL('./delivery.js', import.meta.url));
      entry.delivery = { ...delivery.descriptor, manifest: `generations/${snapshotId}/${base}/delivery.json` };
    }
    if (definition.navigation) {
      const view = await buildGraphView(graph, { graphUrl: "graph.json", ...(project.deliveryOptions ? {deliveryUrl:"delivery.json"}:{}), readingOptions:project.readingOptions, assetPrefix: "./", sourcePrefix: "../../../../../", reportUrl: "report.html", embedded: true, view: project.viewOptions, queryProfiles: project.queryProfiles });
      files[`${base}/navigation.html`] = view.html;
      for (const [name, value] of Object.entries(view.assets)) files[`${base}/${name}`] = value;
      entry.navigation = `generations/${snapshotId}/${base}/navigation.html`;
    } else {
      entry.navigation = false;
      if (project.deliveryOptions) files[`${base}/query.js`] = await Deno.readTextFile(new URL('./query.js', import.meta.url));
    }
    registry.graphs.push(entry); graphValues.push({ definition, graph });
  }
  const sharedMemberships = Object.fromEntries((project.objects ?? []).filter((item:Value)=>item.eligible && memberships(item).length>1).map((item:Value)=>[item.id,memberships(item)]));
  if (project.federationOptions) {
    if (definitions.has('federated')) fail('a producer cannot use the reserved federated graph id');
    const result = buildFederation(graphValues, project.admittedNavigationLinks ?? [], snapshotId,
      {selectedGraphs:project.federationOptions.graphs,memberships:sharedMemberships});
    if (project.unobservedNavigationLinks) {result.routingSafe=false;result.graph.status='incomplete';result.diagnostics.status='incomplete';result.diagnostics.unobservedLinkSources=project.unobservedNavigationLinks;}
    result.graph.graph.label = project.federationOptions.label;
    const base='graphs/federated', graph=result.graph;
    files[`${base}/graph.json`]=`${canonical(graph)}\n`;
    files[`${base}/index.json`]=`${canonical(graphIndex(graph))}\n`;
    files[`${base}/mapping.json`]=`${canonical({snapshotId,mapping:result.mapping,sourceGraphs:result.sourceGraphs,diagnostics:result.diagnostics,routingSafe:result.routingSafe})}\n`;
    files[`${base}/report.html`]=graphReportHtml(graph,{sourcePrefix:'../../../../../',embedded:true,view:project.viewOptions}).replace('</main>',`<p>Routing available: ${result.routingSafe ? 'yes' : 'no: unresolved public scope or prerequisites'}. <a href="mapping.json">Projection mapping and coverage</a>.</p></main>`);
    for(const [name,value] of Object.entries(await graphReportAssets())) files[`${base}/${name}`]=value;
    registry.federation={id:'federated',label:project.federationOptions.label,snapshotId,status:graph.status,routingSafe:result.routingSafe,graph:`generations/${snapshotId}/${base}/graph.json`,report:`generations/${snapshotId}/${base}/report.html`,mapping:`generations/${snapshotId}/${base}/mapping.json`,navigation:false};
    if(result.routingSafe){
      const view=await buildGraphView(graph,{graphUrl:'graph.json',readingOptions:project.readingOptions,assetPrefix:'./',sourcePrefix:'../../../../../',reportUrl:'report.html',embedded:true,view:project.viewOptions,queryProfiles:project.queryProfiles});
      files[`${base}/navigation.html`]=view.html;
      for(const [name,value]of Object.entries(view.assets))files[`${base}/${name}`]=value;
      registry.federation.navigation=`generations/${snapshotId}/${base}/navigation.html`;
    }
  }
  files["registry.json"] = `${canonical(registry)}\n`;
  return { files, registry, graphValues, sharedMemberships, searchEnabled: project.config?.website?.search !== false && project.config?.search !== false };
}

export async function finishComposition(root: string, outputDir: string, composition: Value, producer: Value): Promise<void> {
  const output = await outputRoot(root, outputDir);
  const registryPath = outputPath(outputDir, "knowledge-graph/registry.json");
  // Stable aliases point at this render's committed generation, never the
  // generation read when the Lua page filters began rendering.
  await atomicJson(await confined(root, registryPath), composition.registry);
  const graphById = new Map(composition.registry.graphs.map((entry: Value) => [entry.id, entry]));
  const quarantinedPages: string[] = [];
  for (const record of [...Object.values(producer.entries), ...(producer.staleEntries ?? []).map((entry: Value) => ({ envelope: entry, output: entry.output, stale: true }))] as Value[]) {
    const path = await confined(root, record.output), graph = graphById.get(record.envelope.graph.id) as Value;
    const inside = relative(output, path).replaceAll("\\", "/");
    if (inside.startsWith("../") || isAbsolute(inside) || !/\.html?$/i.test(inside)) {
      if (record.stale) continue; // A retired output-dir is outside this publication.
      fail("producer output is outside the current HTML publication");
    }
    let html;
    try { html = await Deno.readTextFile(path); }
    catch (error) { if (record.stale && error instanceof Deno.errors.NotFound) continue; throw error; }
    if (record.stale) {
      // No boundary contract exists for separating generated records, native
      // search snippets and authored titles. Temporarily quarantine this known
      // generated output as a whole; never edit its QMD or guess HTML islands.
      const notice = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Generated view requires a fresh render</title></head><body><main><h1>Generated view requires a fresh render</h1><p>Its source data or rendering context changed. Previous generated content is unavailable until this page is rendered again. The author source has been preserved.</p></main></body></html>\n';
      if (html !== notice) await Deno.writeTextFile(path, notice);
      quarantinedPages.push(relative(output, path).replaceAll("\\", "/"));
      continue;
    }
    const pattern = /<div\b(?=[^>]*\bdata-kg-graph=["']([^"']+)["'])(?=[^>]*\bdata-kg-producer-placeholder=["']1["'])[^>]*>[\s\S]*?<\/div>/gi;
    const changed = html.replace(pattern, (match, id) => {
      if (id !== graph.id || !graph.navigation) return match;
      const relativeUrl = relative(dirname(path), join(output, "knowledge-graph", graph.navigation)).replaceAll("\\", "/");
      const href = relativeUrl.split("/").map(encodeURIComponent).join("/");
      return graphRegionHtml(id, graph.label, href, record.stale);
    });
    if (changed !== html) await Deno.writeTextFile(path, changed);
    record.htmlHash = await digest(changed);
  }
  const searchPath = await confined(root, outputPath(outputDir, "search.json"));
  try { await atomicJson(searchPath, withGraphSearch(withoutPageSearch(await readJson(searchPath), quarantinedPages), composition.searchEnabled ? composition.graphValues : [], composition.sharedMemberships)); }
  catch (error) { if (!(error instanceof Deno.errors.NotFound)) throw error; }
  await commitProducerState(root, producer);
}

export async function commitProducerState(root: string, producer: Value): Promise<void> {
  const content = { producerCacheVersion: 1, entries: producer.entries, staleEntries: producer.staleEntries ?? [] };
  await atomicJson(await confined(root, pointer), { ...content, hash: await digest(canonical(content)) });
}
