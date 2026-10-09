import { createSemanticLabels } from "./query.js";
/** Optional standalone view of the already-projected public graph.
 * Publication chooses generation-coherent local URLs; this helper never loads
 * a database/model, changes declarations, or emits inline executable content.
 */
type Options = { graphUrl?: string; assetPrefix?: string; sourcePrefix?: string; reportUrl?: string };
function escape(value: unknown): string {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
function local(value: string): string {
  let decoded: string;
  try { decoded = decodeURIComponent(value); } catch { throw new Error("invalid local graph-view URL"); }
  if (!value || value !== value.trim() || /[\u0000-\u001f\\]/.test(decoded) || decoded.trim().startsWith("/") || /^[A-Za-z][A-Za-z\d+.-]*:/.test(decoded.trim())) {
    throw new Error("graph view assets and data must use local relative URLs");
  }
  return value;
}
function destination(value: string): string | null {
  try {
    const decoded = decodeURIComponent(value);
    if (value !== value.trim() || decoded.trim().startsWith("/") || /[\u0000-\u001f\\]/.test(decoded) || /^[A-Za-z][A-Za-z\d+.-]*:/.test(decoded.trim()) || decoded.split("#")[0].split("/").some(part => part === "." || part === "..")) return null;
    return value;
  } catch { return null; }
}
export function graphViewHtml(graph: any, options: Options = {}): string {
  const graphUrl = local(options.graphUrl ?? "graph.json"), asset = local(options.assetPrefix ?? "./");
  const source = local(options.sourcePrefix ?? "../"), report = local(options.reportUrl ?? "report.html");
  if (!graph || !Array.isArray(graph.objects) || !Array.isArray(graph.occurrences) || !["complete", "incomplete"].includes(graph.status)) throw new Error("public graph required for navigation view");
  const title = createSemanticLabels(graph.objects);
  const objects = [...graph.objects].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const listing = objects.slice(0, 200).map((item: any) => {
    const occurrence = graph.occurrences.find((entry: any) => entry.target === item.id && entry.source.path === item.source?.path && entry.source.anchor === item.source?.anchor)
      ?? graph.occurrences.find((entry: any) => entry.target === item.id);
    const href = occurrence && destination(occurrence.destination);
    return `<li>${href ? `<a href="${escape(source + href)}">${escape(title(item))}</a>` : escape(title(item))} <span>Type: ${escape(item.type)}</span><br><code>${escape(item.id)}</code></li>`;
  }).join("\n");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Explore the public knowledge graph</title><link rel="stylesheet" href="${escape(asset + "graph-view.css")}"><script type="module" src="${escape(asset + "graph-view.js")}"></script></head><body>
<a class="kg-skip" href="#main-content">Skip to graph navigation</a><main id="main-content" data-kg-view data-graph-url="${escape(graphUrl)}" data-source-prefix="${escape(source)}" data-snapshot-id="${escape(graph.snapshotId)}">
<h1>Explore the public knowledge graph</h1><p>Snapshot <code>${escape(graph.snapshotId)}</code>. Source coverage: <strong>${escape(graph.status)}</strong>. <a href="${escape(report)}">Read the static source-linked report</a>.</p>
<p id="kg-status" role="status" aria-live="polite">Optional controls are loading. The source list below is usable without JavaScript.</p>
<div data-controls hidden><section aria-labelledby="kg-search-heading"><h2 id="kg-search-heading">Find and inspect</h2><form data-search><label>Text <input name="text" type="search" autocomplete="off" maxlength="10000" data-focus-key="search:text"></label><label>Domain <select name="scope" data-focus-key="search:scope"><option value="">All domains</option></select></label><button type="submit" data-focus-key="search:submit">Search public records</button></form><p data-search-summary></p></section>
<section aria-labelledby="kg-diagram-heading"><h2 id="kg-diagram-heading">Graph diagram</h2><p id="kg-diagram-help">Drag a node to arrange it, or drag the background to pan. The movement buttons provide click, tap and keyboard alternatives. The synchronized list performs every selection and source-opening task.</p>
<div class="kg-controls" aria-label="Diagram movement"><button type="button" data-pan="left">Pan left</button><button type="button" data-pan="right">Pan right</button><button type="button" data-pan="up">Pan up</button><button type="button" data-pan="down">Pan down</button><button type="button" data-zoom="in">Zoom in</button><button type="button" data-zoom="out">Zoom out</button><button type="button" data-reset-view>Reset view</button></div>
<div class="kg-surface"><svg viewBox="0 0 1000 650" aria-hidden="true" data-diagram><g data-scene></g></svg></div>
<div class="kg-controls" aria-label="Arrange the selected node"><span>Move selected node:</span><button type="button" data-move="left">Left</button><button type="button" data-move="right">Right</button><button type="button" data-move="up">Up</button><button type="button" data-move="down">Down</button></div></section>
<section aria-labelledby="kg-detail-heading"><h2 id="kg-detail-heading" tabindex="-1">Selected record</h2><div data-detail>Select a record from the list.</div></section>
<section aria-labelledby="kg-route-heading"><h2 id="kg-route-heading" tabindex="-1">A route through these records</h2><p>Cost is a reader-selected navigation preference, not proof of pedagogical validity. Declared prerequisites remain hard requirements; earlier planned steps must actually be completed.</p>
<form data-route-form><label>Start <select name="start" required></select></label><label>Goal <select name="goal" required></select></label><label>Follow edges <select name="direction"><option value="outgoing">In their declared direction</option><option value="incoming">In reverse direction</option><option value="both">In either direction</option></select></label><label>Route relation types <select name="relationTypes" multiple aria-describedby="kg-relation-help"></select></label><p id="kg-relation-help">No selection follows all declared relation types. Selecting types restricts route edges; declared prerequisites still apply.</p><label>Difficulty multiplier <input name="difficulty" type="number" min="0" step="0.25" value="1" required></label><button type="submit">Compute a bounded candidate</button></form>
<div data-candidate></div><div data-route></div><div class="kg-controls"><button type="button" data-return hidden>Return one exploration step</button><button type="button" data-return-route hidden>Return to accepted route</button><button type="button" data-clear-route hidden>Clear accepted route</button></div>
<label><input type="checkbox" data-persistent> Retain reader choices in this browser between sessions</label><button type="button" data-forget>Forget stored reader choices</button><p data-storage-note>Session storage is best-effort. No reader choices are sent to a server.</p></section></div>
<section aria-labelledby="kg-list-heading"><h2 id="kg-list-heading">Public source list</h2><p data-list-note>${objects.length > 200 ? "The static list shows the first 200 records; use the complete static report for all records." : "These records retain separate identifiers and declared domains."}</p><ul data-results>${listing}</ul></section>
</main></body></html>\n`;
}
export async function buildGraphView(graph: any, options: Options = {}) {
  const assets: Record<string, string> = {};
  for (const name of ["query.js", "graph-view.js", "graph-view.css"]) assets[name] = await Deno.readTextFile(new URL(`./${name}`, import.meta.url));
  return { html: graphViewHtml(graph, options), assets };
}
