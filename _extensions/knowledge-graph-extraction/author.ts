// Explicit deterministic authoring CLI. Never called by render hooks.
import { parse, stringify } from "stdlib/yaml";
import { dirname, isAbsolute, relative } from "stdlib/path";
import { atomicJson, canonical, confined, digest, fail, loadProject, observationName, projectPath, PUBLIC, readJson, STATE } from "./core.ts";
import { activeContext, outputPath, outputRoot } from "./context.ts";
import { sourceKeys } from "./cache.ts";
import { htmlIds } from "./html.ts";
import { privatePath } from "./private-path.ts";
import { authoringCommand, authoringObservations, verifyAuthoringRun, validateProposals, type AuthoringHost } from "./authoring.ts";
type Data = Record<string, any>;

async function readBounded(root: string, path: string): Promise<string> {
  const normalized = projectPath(path);
  const absolute = normalized === STATE || normalized.startsWith(`${STATE}/`) ? await privatePath(root, normalized) : await confined(root, normalized);
  const bytes = await Deno.readFile(absolute);
  if (bytes.length > 8_000_000) fail("private authoring file exceeds its eight-megabyte limit");
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
async function snapshot(): Promise<{ context: Data; observations: Data[]; policy: any }> {
  const active = await activeContext();
  if (!active) fail("enable the knowledge-graph extension and knowledge-graph.authoring before discovery");
  const { root, inspection, outputDir } = active, project = await loadProject(root, inspection);
  const run = JSON.parse(await readBounded(root, `${STATE}/run.json`));
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(run.runId ?? "")) fail("invalid prepared authoring run ID");
  if (run.outputDir !== outputDir) fail("authoring output configuration changed; make a fresh full render");
  const finalized = JSON.parse(await readBounded(root, `${STATE}/runs/${run.runId}/finalized.json`));
  // Cache-only and partial runs legitimately lack fresh observation files.
  // Refuse them before reading those files so the next step is actionable.
  if (project.authoringEnabled !== true || run.authoringEnabled !== true || finalized.authoringEnabled !== true) {
    fail("enable knowledge-graph.authoring and make a fresh complete full observation run");
  }
  if (run.full !== true || run.cacheOnly === true || finalized.cacheOnly === true || finalized.status !== "complete"
    || !Array.isArray(run.renderedSources) || !Array.isArray(finalized.renderedSources)
    || !project.sources.every((source: string) => run.renderedSources.includes(source) && finalized.renderedSources.includes(source))) {
    fail("authoring requires a fresh complete full observation run");
  }
  const manifest = await readJson(await confined(root, outputPath(outputDir, `${PUBLIC}/manifest.json`)));
  if (manifest.snapshotId !== finalized.snapshotId || manifest.dependencyDigest !== finalized.dependencyDigest || manifest.status !== "complete") fail("authoring requires the current complete finalized publication");
  const observations: Data[] = [], actualHtml: Data = {}, output = await outputRoot(root, outputDir);
  for (const source of project.sources) {
    const observation = JSON.parse(await readBounded(root, `${STATE}/runs/${run.runId}/observations/${observationName(source)}`));
    const destination = finalized.htmlOutputs?.[source];
    if (!destination || typeof destination.path !== "string" || !/\.html?$/i.test(destination.path)) fail("authoring needs actual finalized native HTML outputs");
    const absolute = await confined(root, projectPath(destination.path));
    const inside = relative(output, absolute).replaceAll("\\", "/");
    if (inside === ".." || inside.startsWith("../") || isAbsolute(inside)) fail("authoring HTML output escaped its configured output directory");
    const html = await Deno.readTextFile(absolute), counts = htmlIds(html);
    actualHtml[source] = { path: destination.path, hash: await digest(html) };
    if (observation.authoring) for (const candidate of [...observation.authoring.annotations ?? [], ...observation.authoring.terms ?? []]) {
      if (counts.get(candidate.anchor) !== 1) fail("authoring candidate needs exactly one actual native HTML anchor");
    }
    observations.push(observation);
  }
  const context = await verifyAuthoringRun(project, run, finalized, await sourceKeys(project, outputDir), actualHtml, observations);
  const declaration = parse(await readBounded(root, projectPath(project.config["knowledge-graph"]?.declarations ?? "knowledge.yml"))) as Data;
  return { context, observations: authoringObservations(observations), policy: { namespaces: declaration.namespaces,
    schema: project.schema, objects: project.objects, relations: project.relations } };
}
export async function main(args: string[] = Deno.args): Promise<void> {
  const root = await Deno.realPath(Deno.cwd());
  let current: Awaited<ReturnType<typeof snapshot>> | undefined;
  const host: AuthoringHost = {
    snapshot: async () => current ??= await snapshot(),
    readJson: async path => JSON.parse(await readBounded(root, path)),
    readSelections: async path => parse(await readBounded(root, path)),
    writeProposals: async (path, value) => {
      // Re-discovery in an identical verified context reuses existing review
      // material. Never replace a different proposal file silently.
      const absolute = await privatePath(root, path);
      try {
        const old = await readJson(absolute);
        await validateProposals(old, current!.context, current!.policy);
        if (canonical(old.candidates) !== canonical(value.candidates)) fail("proposal output already exists with different candidates; choose a new path");
        return;
      } catch (error) { if (!(error instanceof Deno.errors.NotFound)) throw error; }
      await Deno.mkdir(dirname(absolute), { recursive: true });
      await Deno.writeTextFile(absolute, `${canonical(value)}\n`, { createNew: true });
    },
    writeReview: async (path, value) => {
      const absolute = await privatePath(root, path), receipt = await privatePath(root, `${path}.review.json`);
      for (const target of [absolute, receipt]) {
        try { await Deno.stat(target); fail("review output already exists; choose a new private output path"); }
        catch (error) { if (!(error instanceof Deno.errors.NotFound)) throw error; }
      }
      await Deno.mkdir(dirname(absolute), { recursive: true });
      await Deno.writeTextFile(absolute, stringify(value.patch), { createNew: true });
      await atomicJson(receipt, value.review);
    }
  };
  console.log(await authoringCommand(args, host));
}
if (import.meta.main) try { await main(); }
catch (error) { console.error(error instanceof Error ? error.message : String(error)); Deno.exit(1); }
