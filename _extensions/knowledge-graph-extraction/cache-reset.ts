// Reset only disposable extraction reuse; never recursively delete private state.
import { fail, STATE } from "./core.ts";
import { privatePath } from "./private-path.ts";

const paths = [`${STATE}/extraction/committed.json`, `${STATE}/run.json`];

export async function resetExtractionCache(root: string, dryRun = false): Promise<Record<string, unknown>> {
  root = await Deno.realPath(root);
  const targets: { path: string; absolute: string; exists: boolean }[] = [];
  // Validate every target before changing either one. Do not parse potentially
  // corrupt cache/project configuration, follow links, or remove directories.
  for (const path of paths) {
    const absolute = await privatePath(root, path);
    let exists = false;
    try {
      if (!(await Deno.lstat(absolute)).isFile) fail(`cache reset requires a regular file at ${path}; inspect this path manually`);
      exists = true;
    } catch (error) { if (!(error instanceof Deno.errors.NotFound)) throw error; }
    targets.push({ path, absolute, exists });
  }
  if (!dryRun) for (const target of targets) if (target.exists) {
    try { await Deno.remove(target.absolute); }
    catch (error) { if (!(error instanceof Deno.errors.NotFound)) throw error; }
  }
  return { project: root, dryRun, removed: dryRun ? [] : targets.filter(t => t.exists).map(t => t.path),
    wouldRemove: dryRun ? targets.filter(t => t.exists).map(t => t.path) : [],
    alreadyAbsent: targets.filter(t => !t.exists).map(t => t.path),
    preserved: ["last validated graph and recovery artifacts", "Git baseline and history", "imported baseline receipt",
      "authoring and AI proposals/reviews", "declarations, native HTML and other Quarto caches"],
    nextStep: "Close preview and other renders before resetting. Run a complete quarto render in update mode to rebuild extraction reuse; cached-only assembly needs this fresh render." };
}
