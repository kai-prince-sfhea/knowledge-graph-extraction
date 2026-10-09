import { atomicJson, confined, readJson, STATE } from "./core.ts";
import { resolve } from "stdlib/path";

type Value = Record<string, any>;
async function git(root: string, args: string[]): Promise<string | null> {
  try {
    const result = await new Deno.Command("git", { args: ["-C", root, ...args],
      env: { GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" }, stdout: "piped", stderr: "piped" }).output();
    return result.success ? new TextDecoder("utf-8", { fatal: true }).decode(result.stdout).trimEnd() : null;
  } catch (error) { if (error instanceof Deno.errors.NotFound) return null; throw error; }
}

/** Read existing history only: never initialize, checkout, stage, commit, fetch or push. */
export async function gitProvenance(root: string, enabled: boolean): Promise<Value> {
  if (!enabled) return { enabled: false };
  const top = await git(root, ["rev-parse", "--show-toplevel"]);
  if (!top || resolve(top).toLowerCase() !== resolve(root).toLowerCase()) return { enabled: true, available: false, reason: "no-project-repository" };
  const head = await git(root, ["rev-parse", "HEAD"]);
  const status = await git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  if (status === null) return { enabled: true, available: false, head, reason: "status-unavailable" };
  let previous: Value | null = null;
  try { previous = await readJson(await confined(root, `${STATE}/git-baseline.json`)); }
  catch (error) { if (!(error instanceof Deno.errors.NotFound)) throw error; }
  const changes: { status: string; path: string; from?: string }[] = [];
  const fields = (status ?? "").split("\0");
  for (let index = 0; index < fields.length; index++) {
    const line = fields[index];
    if (!line) continue;
    const entry: { status: string; path: string; from?: string } = { status: line.slice(0, 2), path: line.slice(3) };
    if (/[RC]/.test(entry.status)) entry.from = fields[++index];
    changes.push(entry);
  }
  const baselineHead = typeof previous?.head === "string" ? previous.head : null;
  const comparable = baselineHead !== null && baselineHead.length > 0 && head !== null;
  const changedSinceBaseline = !comparable ? null : baselineHead !== head
    ? await git(root, ["diff", "--name-only", "-z", baselineHead!, "HEAD", "--"]) : "";
  return { enabled: true, available: true, head, baselineHead: previous?.head ?? null,
    baselineSnapshotId: previous?.snapshotId ?? null, dirty: changes.length > 0, changes,
    changedSinceBaseline: changedSinceBaseline === null ? null : changedSinceBaseline.split("\0").filter(Boolean),
    baselineComparison: !comparable ? "not-established" : changedSinceBaseline === null ? "unknown" : "available",
    authority: "content-hashes" };
}

export async function commitGitBaseline(root: string, provenance: Value, snapshotId: string): Promise<void> {
  if (!provenance.available) return;
  await atomicJson(await confined(root, `${STATE}/git-baseline.json`), { snapshotId, head: provenance.head });
}
