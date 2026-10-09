import { confined, fail, inspectProject, projectEnabled, projectPath } from "./core.ts";
import { dirname, isAbsolute, relative, resolve } from "stdlib/path";

export function outputPath(outputDir: string, path: string): string {
  return projectPath(outputDir === "." ? path : `${outputDir}/${path}`);
}
export async function outputRoot(root: string, outputDir: string): Promise<string> {
  if (outputDir === ".") return root;
  const absolute = await confined(root, outputDir);
  let ancestor = absolute, target;
  while (true) {
    try { target = resolve(await Deno.realPath(ancestor), relative(ancestor, absolute)); break; }
    catch (error) { if (!(error instanceof Deno.errors.NotFound)) throw error; ancestor = dirname(ancestor); }
  }
  const first = relative(await Deno.realPath(root), target).replaceAll("\\", "/").split("/")[0].toLowerCase();
  if ([".quarto", ".git", "_extensions"].includes(first)) fail("rendered output must not overlap private state, Git or extension directories");
  return absolute;
}
export function log(message: string): void {
  if (Deno.env.get("QUARTO_PROJECT_SCRIPT_QUIET") !== "1") console.log(`knowledge-graph-extraction: ${message}`);
}
/** Installed metadata hooks must do nothing until the named feature is active. */
export async function activeContext(): Promise<Record<string, any> | null> {
  const root = await Deno.realPath(Deno.cwd());
  const inspection = await inspectProject(root);
  if (!projectEnabled(inspection)) return null;
  const value = Deno.env.get("QUARTO_PROJECT_OUTPUT_DIR") ?? inspection.config.project?.["output-dir"] ?? ".";
  const normalized = isAbsolute(value) ? relative(root, value).replaceAll("\\", "/") : value.replaceAll("\\", "/");
  const outputDir = !normalized || normalized === "." ? "." : projectPath(normalized);
  await outputRoot(root, outputDir);
  return { root, inspection, outputDir };
}
