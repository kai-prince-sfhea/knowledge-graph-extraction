import { canonical, confined, digest, fail, keys, projectPath, record, text } from "./core.ts";

/** Explicit local source collections; never clone/update missing imports. */
export async function sourceCollections(root: string, value: unknown, dependencies: Record<string, any>[]): Promise<Record<string, any>[]> {
  if (value === undefined) return [];
  if (!Array.isArray(value)) fail("collections must be a sequence");
  const seen = new Set<string>(), result: Record<string, any>[] = [];
  for (const raw of value) {
    const item = record(raw, "source collection");
    keys(item, ["id", "root", "repository", "revision"], "source collection");
    const id = text(item.id, "collection id");
    let url;
    try { url = new URL(id); } catch { fail("collection id must be an absolute HTTP(S) URI"); }
    if (!["http:", "https:"].includes(url.protocol) || seen.has(id)) fail("collection identifiers must be distinct HTTP(S) URIs");
    seen.add(id);
    const path = item.root === "." ? "." : projectPath(item.root);
    const directory = path === "." ? root : await confined(root, path);
    try { if (!(await Deno.stat(directory)).isDirectory) fail("source collection root is not a directory"); }
    catch (error) { if (error instanceof Deno.errors.NotFound) fail("declared source collection is unavailable; restore the local import before rendering"); throw error; }
    const files = await Promise.all(dependencies.filter(entry => ["source", "include", "resource", "metadata", "ignored-metadata"].includes(entry.kind)
      && (path === "." || entry.path.startsWith(`${path}/`))).map(async entry => ({ path: entry.path,
        hash: await digest(await Deno.readFile(await confined(root, entry.path))) })));
    if (!dependencies.some(entry => ["source", "include", "resource"].includes(entry.kind) && (path === "." || entry.path.startsWith(`${path}/`)))) {
      fail("source collection has no tracked selected input or dependency; declare its local sources/includes explicitly");
    }
    const entry: Record<string, any> = { id, root: path, files };
    if (item.repository !== undefined) {
      const repository = text(item.repository, "collection repository");
      try { if (!["http:", "https:"].includes(new URL(repository).protocol)) fail("collection repository must be HTTP(S)"); }
      catch { fail("collection repository must be an absolute HTTP(S) URI"); }
      entry.repository = repository;
    }
    if (item.revision !== undefined) {
      if (typeof item.revision !== "string" || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(item.revision)) fail("collection revision must be an immutable full Git commit hash");
      let actual: string | null = null;
      try {
        const command = await new Deno.Command("git", { args: ["-C", directory, "rev-parse", "HEAD"],
          env: { GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" }, stdout: "piped", stderr: "piped" }).output();
        if (command.success) actual = new TextDecoder().decode(command.stdout).trim();
      } catch (error) { if (!(error instanceof Deno.errors.NotFound)) throw error; }
      if (actual !== item.revision) fail("source collection revision is unavailable or differs from its declared pin; restore/update the manifest explicitly");
      const prefixResult = await new Deno.Command("git", { args: ["-C", directory, "rev-parse", "--show-prefix"], stdout: "piped", stderr: "piped" }).output();
      if (!prefixResult.success) fail("cannot resolve pinned collection files");
      const prefix = new TextDecoder().decode(prefixResult.stdout).trim();
      for (const file of files) {
        const local = path === "." ? file.path : file.path.slice(path.length + 1);
        const committed = await new Deno.Command("git", { args: ["-C", directory, "show", `${item.revision}:${prefix}${local}`],
          env: { GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" }, stdout: "piped", stderr: "piped" }).output();
        if (!committed.success || await digest(committed.stdout) !== file.hash) fail("pinned source collection contains changed or untracked input bytes; commit/update the pin or remove the revision explicitly");
      }
      entry.revision = actual;
    }
    dependencies.push({ path: `collection:${id}`, kind: "collection", hash: await digest(canonical(entry)) });
    result.push(entry);
  }
  return result.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
