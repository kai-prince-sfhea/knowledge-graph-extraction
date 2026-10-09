// Embedded by scripts/build-manifest.mjs into the metadata hook commands.
// Quarto 1.11.5 rebases direct paths without quoting spaces. A local data module
// avoids that parsing defect and discovers either normal installation layout.
import { toFileUrl } from "stdlib/path";
const stage = Deno.args[0];
if (!["prepare", "finalize"].includes(stage)) throw new Error("knowledge-graph-extraction: invalid lifecycle stage");
const base = Deno.cwd().replaceAll("\\", "/") + "/_extensions";
const candidates = [base + "/knowledge-graph-extraction"];
for (const entry of Deno.readDirSync(base)) {
  if (entry.isDirectory && entry.name !== "knowledge-graph-extraction") {
    candidates.push(base + "/" + entry.name + "/knowledge-graph-extraction");
  }
}
const found = candidates.filter(path => {
  try { return Deno.statSync(path + "/_extension.yml").isFile && Deno.statSync(path + "/" + stage + ".ts").isFile; }
  catch { return false; }
});
if (found.length !== 1) throw new Error("knowledge-graph-extraction: expected one installed package; remove duplicate copies with quarto remove");
await import(toFileUrl(found[0] + "/" + stage + ".ts").href);
