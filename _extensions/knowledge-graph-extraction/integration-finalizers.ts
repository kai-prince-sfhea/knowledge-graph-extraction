// Optional, versioned cooperation with installed security auditing. No module is
// imported merely because it is installed: a current deferred audit is required.
import { confined, fail, readJson } from "./core.ts";
import { join, toFileUrl } from "stdlib/path";
const state = ".quarto/content-security-protocol";
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
async function optionalState(root: string, file: string, ignoreInvalid = false): Promise<any | null> {
  try {
    // Refuse links throughout the private state ancestry, including links that
    // would stay inside the project but expose managed state in public output.
    let path = root;
    for (const part of file.split("/")) {
      path = join(path, part);
      const stat = await Deno.lstat(path);
      if (stat.isSymlink) fail("security integration state must not contain links");
    }
    const absolute = await confined(root, file), stat = await Deno.lstat(absolute);
    if (!stat.isFile || stat.size > 8 * 1024 * 1024) fail("security integration state requires bounded regular files");
    return await readJson(absolute);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound || (ignoreInvalid && error instanceof SyntaxError)) return null;
    if (error instanceof Error && error.message.startsWith("knowledge-graph-extraction:")) throw error;
    fail("security integration state is invalid or unreadable; inspect the private audit state and render serially again");
  }
}
export async function preparedCspRunId(root: string): Promise<string | undefined> {
  // This is only one half of a two-way binding. If CSP prepares later, its own
  // pending record instead captures this new graph run's identity.
  let pending, status;
  try { pending = await optionalState(root, `${state}/pending.json`, true); status = await optionalState(root, `${state}/status.json`, true); }
  catch (error) { if (error instanceof SyntaxError) return undefined; throw error; }
  return pending?.schema === "content-security-protocol-run/v1" && uuid.test(pending.id ?? "") && status?.status === "pending" && status.generation === pending.id ? pending.id : undefined;
}
export async function finalizeDeferredSecurity(root: string, run: any, snapshotId: string | null): Promise<void> {
  const marker = await optionalState(root, `${state}/deferred-composition.json`);
  if (!marker || marker.schema !== "content-security-protocol-deferred-composition/v1" || marker.kgRunId !== run.runId || marker.outputDir !== run.outputDir || !uuid.test(marker.cspRunId ?? "")) return;
  const base = await confined(root, "_extensions"), candidates = [join(base, "content-security-protocol")];
  for await (const entry of Deno.readDir(base)) if (entry.isDirectory && entry.name !== "content-security-protocol") candidates.push(join(base, entry.name, "content-security-protocol"));
  const found = [];
  for (const directory of candidates) {
    try {
      const path = join(directory, "finalizer.mjs"), stat = await Deno.lstat(path);
      if (!stat.isFile || stat.isSymlink) fail("security finalizer must be an installed regular module");
      found.push(path);
    } catch (error) { if (!(error instanceof Deno.errors.NotFound)) throw error; }
  }
  if (found.length !== 1) fail("pending security audit needs exactly one composition-capable Content Security Protocol installation");
  try {
    const finalizer = await import(toFileUrl(found[0]).href);
    if (finalizer.COMPOSITION_FINALIZER_VERSION !== 1 || typeof finalizer.finalizeAfterComposition !== "function") fail("upgrade Content Security Protocol for the supported composition finalizer");
    await finalizer.finalizeAfterComposition({ root, kgRunId: run.runId, snapshotId });
  } catch (error) {
    if (error instanceof Error && /^(?:content-security-protocol|knowledge-graph-extraction):/.test(error.message)) throw error;
    fail("final security audit failed; inspect the private Content Security Protocol status before publishing");
  }
}
