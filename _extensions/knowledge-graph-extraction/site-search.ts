import { validateSiteSearchConfig, validateSiteSearchIndex } from "./site-search.js";

type Graph = { id: string; label: string; status?: "complete" | "incomplete" };
type Input = { snapshotId: string; graphs: Graph[]; entries: unknown[] };
type Options = { indexUrl: string; assetPrefix?: string };
const escape = (value: string): string => value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

/** No extra author build step. The finalizer chooses immutable generation URLs,
 * copies these two assets, and inserts the returned markup in native HTML. */
export function buildSiteSearchAssets(input: Input, options: Options) {
  const config = validateSiteSearchConfig({ version: 1, snapshotId: input.snapshotId, graphs: input.graphs, indexUrl: options.indexUrl });
  const index = validateSiteSearchIndex({ version: 1, snapshotId: input.snapshotId, graphs: config.graphs, entries: input.entries }, config);
  const prefix = options.assetPrefix ?? "./";
  // Per-page ancestor offsets are needed in nested output; all other URL syntax
  // is refused, and the browser additionally confines resolution to the site.
  if (typeof prefix !== "string" || !/^(?:\.\/|(?:\.\.\/)*)(?:[A-Za-z0-9._~-]+\/)*$/.test(prefix)) throw new Error("knowledge-graph-extraction: invalid site search asset prefix");
  const indexText = JSON.stringify(index) + "\n";
  if (new TextEncoder().encode(indexText).byteLength > 32 * 1024 * 1024) throw new Error("knowledge-graph-extraction: optional site search data exceeds its bounded size");
  const json = JSON.stringify(config).replaceAll("<", "\\u003c").replaceAll("\u2028", "\\u2028").replaceAll("\u2029", "\\u2029");
  return {
    config, index, indexText,
    markup: `<link rel="stylesheet" href="${escape(prefix + "site-search.css")}" data-kg-site-search-asset>\n<script type="application/json" data-kg-site-search-config>${json}</script>\n<script type="module" src="${escape(prefix + "site-search.js")}" data-kg-site-search-asset></script>`,
    assets: ["site-search.js", "site-search.css"].map(name => ({ name, source: new URL(name, import.meta.url) })),
  };
}
