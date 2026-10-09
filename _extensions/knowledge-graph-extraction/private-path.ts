// Private managed state must not resolve through links into published output.
import { isAbsolute, relative, resolve } from "stdlib/path";
import { confined, fail, projectPath, STATE } from "./core.ts";

export async function privatePath(root: string, value: string): Promise<string> {
  const path = projectPath(value);
  if (path !== STATE && !path.startsWith(`${STATE}/`)) fail(`private state path must stay under ${STATE}`);
  const canonicalRoot = await Deno.realPath(root), parts = path.split("/");
  let ancestor = canonicalRoot;
  for (let index = 0; index < parts.length; index++) {
    ancestor = resolve(ancestor, parts[index]);
    try {
      const entry = await Deno.lstat(ancestor);
      if (entry.isSymlink) fail("private managed state must not contain symbolic links or junctions");
      if ((!entry.isDirectory && index < parts.length - 1) || (index < 2 && !entry.isDirectory)) fail("private managed-state ancestors must be directories");
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
      break;
    }
  }
  const absolute = await confined(canonicalRoot, path), state = resolve(canonicalRoot, STATE);
  // Resolve existing targets as an additional boundary check. For a new target,
  // every existing ancestor has already been checked without following links.
  let actual = absolute;
  try { actual = await Deno.realPath(absolute); }
  catch (error) { if (!(error instanceof Deno.errors.NotFound)) throw error; }
  const inside = relative(state, actual).replaceAll("\\", "/");
  if (inside === ".." || inside.startsWith("../") || isAbsolute(inside)) fail("private state path resolves outside its managed state directory");
  return absolute;
}
