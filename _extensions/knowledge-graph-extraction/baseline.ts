// Portable data-only expectations for a fresh full frozen Quarto render.
import { atomicJson, canonical, confined, digest, fail, loadProject, projectPath, publicRecord, PUBLIC, readJson, STATE, VERSION } from './core.ts';
import { activeContext, outputPath, outputRoot } from './context.ts';
import { readExtractionCache, sourceKeys } from './cache.ts';
import { BASELINE_LIMIT, makeBaseline, validateBaseline } from './baselines.ts';
import { basename, dirname, join, relative, isAbsolute } from 'stdlib/path';
import { privatePath } from './private-path.ts';
async function resolvedTarget(path: string): Promise<string> {
  try { return await Deno.realPath(path); }
  catch (error) { if (!(error instanceof Deno.errors.NotFound)) throw error; return join(await resolvedTarget(dirname(path)), basename(path)); }
}
async function baselineFile(root: string, file: string, outputDir: string): Promise<string> {
  const normalized = file.toLowerCase();
  if (!normalized.endsWith('.json') || ['.git', '.quarto', '_extensions'].some(dir => normalized === dir || normalized.startsWith(dir + '/'))) fail('choose a separate JSON baseline file outside managed state and extension files');
  const absolute = await confined(root, file);
  let current = root;
  for (const component of file.split('/')) {
    current = join(current, component);
    try { if ((await Deno.lstat(current)).isSymlink) fail('baseline paths must not contain symbolic links or junctions'); }
    catch (error) { if (!(error instanceof Deno.errors.NotFound)) throw error; }
  }
  const output = await resolvedTarget(await outputRoot(root, outputDir));
  const managed = await resolvedTarget(await confined(root, outputPath(outputDir, PUBLIC)));
  const inside = (directory: string) => {
    const destination = relative(directory, absolute);
    return destination !== '..' && !destination.startsWith('..' + (Deno.build.os === 'windows' ? '\\' : '/')) && !isAbsolute(destination);
  };
  if (inside(managed) || outputDir !== '.' && inside(output)) fail('baseline files must stay outside rendered output');
  return absolute;
}
const help = `Knowledge Graph Extraction: portable reviewed frozen baseline
  quarto run <extension>/baseline.ts export [--file knowledge-graph-baseline.json] --reviewed
  quarto run <extension>/baseline.ts inspect [--file knowledge-graph-baseline.json]
  quarto run <extension>/baseline.ts import [--file knowledge-graph-baseline.json] --reviewed [--replace]
The bundle contains public graph data and expected hashes, not model data, native HTML or extraction observations.
Import does not publish or render. Follow it with a complete KG_MODE=frozen quarto render.`;
async function main(): Promise<void> {
  const [command = 'help', ...args] = Deno.args;
  if (['help', '--help', '-h'].includes(command) && !args.length) { console.log(help); return; }
  if (!['export', 'import', 'inspect'].includes(command)) fail('unknown baseline command; use help');
  let file = 'knowledge-graph-baseline.json', reviewed = false, replace = false;
  const seen = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    if (seen.has(args[i])) fail('repeated baseline argument');
    seen.add(args[i]);
    if (args[i] === '--reviewed') reviewed = true;
    else if (args[i] === '--replace' && command === 'import') replace = true;
    else if (args[i] === '--file' && args[i + 1] && !args[i + 1].startsWith('--')) file = projectPath(args[++i]);
    else fail('unknown baseline argument; use help');
  }
  if (command !== 'inspect' && !reviewed) fail('explicit --reviewed is required; review the public graph and its declarations first');
  file = projectPath(file);
  const context = await activeContext();
  if (!context) fail('activate knowledge-graph-extraction in a Quarto project before using baselines');
  const { root, inspection, outputDir } = context;
  const project = await loadProject(root, inspection);
  const expected = { dependencyDigest: project.dependencyDigest, sources: project.sources, extractorVersion: VERSION };
  const filename = await baselineFile(root, file, outputDir);
  if (command === 'export') {
    if (project.dependencies.some((entry: any) => entry.path === file)) fail('a baseline cannot be one of its own source/resource dependencies');
    const manifest = await readJson(await confined(root, outputPath(outputDir, PUBLIC + '/manifest.json')));
    const previous = await readJson(await privatePath(root, STATE + '/last-complete.json'));
    if (canonical(previous) !== canonical(manifest)) fail('export requires the current validated complete publication');
    const graph = await readJson(await confined(root, outputPath(outputDir, PUBLIC + '/' + manifest.graph)));
    const bundle = await makeBaseline(manifest, graph, expected);
    const cache = await readExtractionCache(root), keys = await sourceKeys(project, outputDir);
    if (!cache || cache.snapshotId !== graph.snapshotId || cache.dependencyDigest !== project.dependencyDigest) fail('export requires a matching complete extraction baseline');
    for (const source of project.sources) {
      const entry = cache.entries[source];
      if (!entry || entry.key !== keys[source] || await digest(await Deno.readFile(await confined(root, entry.output))) !== entry.htmlHash) fail('source or native HTML changed since review; make a complete update render');
    }
    const bytes = new TextEncoder().encode(canonical(bundle) + '\n');
    if (bytes.byteLength > BASELINE_LIMIT) fail('baseline exceeds the 32 MiB supported limit');
    let exists = false;
    try { const old = await Deno.readFile(filename); exists = true; if (await digest(old) !== await digest(bytes)) fail('baseline file already exists with different data; choose a new file to preserve the reviewed baseline'); }
    catch (error) { if (!(error instanceof Deno.errors.NotFound)) throw error; }
    if (!exists) {
      await Deno.mkdir(dirname(filename), { recursive: true });
      await atomicJson(filename, bundle);
      // A newly created file may match an author resource glob. Do not permit
      // a self-invalidating lockfile, and remove only this newly created file.
      try {
        if ((await loadProject(root)).dependencyDigest !== project.dependencyDigest) fail('baseline file is included by project dependencies; choose an excluded location');
      } catch (error) {
        if (await digest(await Deno.readFile(filename)) === await digest(bytes)) await Deno.remove(filename);
        throw error;
      }
    }
    console.log('Reviewed public baseline exported: ' + file + '; snapshot ' + graph.snapshotId);
    return;
  }
  if ((await Deno.stat(filename)).size > BASELINE_LIMIT) fail('baseline exceeds the 32 MiB supported limit');
  const bundle = await validateBaseline(await readJson(filename), expected);
  // The data-only expectation must still be the current allowlisted public
  // declaration projection. A self-rehashed bundle cannot add private fields,
  // new facts or occurrences; actual HTML destinations need the full render.
  const byId = (a: any, b: any) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  const objects = project.objects.filter((item: any) => item.eligible).map((item: any) => publicRecord(project.schema, 'object', item)).sort(byId);
  const ids = new Set(objects.map((item: any) => item.id));
  const relations = project.relations.filter((item: any) => item.eligible && ids.has(item.from) && ids.has(item.to))
    .map((item: any) => publicRecord(project.schema, 'relation', item)).sort(byId);
  if (canonical(objects) !== canonical([...bundle.graph.objects].sort(byId)) || canonical(relations) !== canonical([...bundle.graph.relations].sort(byId))) fail('baseline records differ from current allowlisted public declarations');
  const occurrences = project.objects.filter((item: any) => item.eligible).flatMap((item: any) => item.occurrences.map((source: any) => ({ target: item.id, source })));
  const order = (a: any, b: any) => canonical(a) < canonical(b) ? -1 : canonical(a) > canonical(b) ? 1 : 0;
  if (canonical(occurrences.sort(order)) !== canonical(bundle.graph.occurrences.map((item: any) => ({ target: item.target, source: item.source })).sort(order))) fail('baseline occurrences differ from current public declarations');
  const schema = project.schemaPath ? { version: project.schemaVersion, digest: project.schemaDigest } : undefined;
  const publication = project.navigation || project.exportOptions ? {
    ...(project.navigation ? { navigation: true, runtimeDigest: await digest(canonical(project.dependencies.filter((item: any) => item.kind === 'extractor'))) } : {}),
    ...(project.exportOptions ? { exports: project.exportOptions } : {}) } : undefined;
  if (canonical(bundle.graph.schema ?? null) !== canonical(schema ?? null) || canonical(bundle.graph.publication ?? null) !== canonical(publication ?? null)) fail('baseline schema or publication differs from current configuration');
  if (command === 'inspect') {
    console.log(JSON.stringify({ bundleVersion: bundle.bundleVersion, snapshotId: bundle.manifest.snapshotId,
      dependencyDigest: bundle.manifest.dependencyDigest, status: 'matching-expected-baseline', sources: project.sources,
      fullFrozenRenderRequired: true, nativeHtmlOrExtractionCacheIncluded: false }, null, 2));
    return;
  }
  let previous;
  try { previous = await readJson(await privatePath(root, STATE + '/last-complete.json')); }
  catch (error) { if (!(error instanceof Deno.errors.NotFound)) throw error; }
  if (previous && canonical(previous) !== canonical(bundle.manifest) && !replace) fail('a different local baseline exists; use --replace --reviewed to replace only its expected fingerprint');
  const pointer = await privatePath(root, STATE + '/last-complete.json'), receipt = await privatePath(root, STATE + '/baselines/imported.json');
  await atomicJson(pointer, bundle.manifest);
  await atomicJson(receipt, { bundleVersion: 0, bundleHash: bundle.hash,
    snapshotId: bundle.manifest.snapshotId, dependencyDigest: bundle.manifest.dependencyDigest, source: file,
    fullFrozenRenderRequired: true });
  console.log('Expected baseline imported; make a complete KG_MODE=frozen quarto render. No public outputs or extraction observations were installed.');
}
await main();
