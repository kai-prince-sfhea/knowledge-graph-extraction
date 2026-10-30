import { createSemanticLabels } from "./query.js";
import { parseReadingOptions } from "./reading-route.ts";
/** Optional standalone view of the already-projected public graph.
 * Publication chooses generation-coherent local URLs; this helper never loads
 * a database/model, changes declarations, or emits inline executable content.
 */
type ViewOptions = { "color-scheme": "auto" | "light" | "dark"; motion: "auto" | "paused"; "diagram-height": "compact" | "comfortable" | "large"; repulsion: number; attraction: number };
export type QueryProfile = { id: string; label: string; operation: "hierarchy" | "evidence" | "time-filter"; relations?: { type: string; direction: string }[]; direction?: "ancestors" | "descendants"; fields?: { instant?: string; start?: string; end?: string }; types?: string[]; match?: "overlaps" | "contained" | "starts-within" };
type Options = { graphUrl?: string; deliveryUrl?: string; readingOptions?: unknown; assetPrefix?: string; sourcePrefix?: string; reportUrl?: string; embedded?: boolean; view?: unknown; queryProfiles?: unknown };
const defaultView: ViewOptions = { "color-scheme": "auto", motion: "auto", "diagram-height": "comfortable", repulsion: 60, attraction: .04 };
/** Literal presentation preferences only: no CSS, URLs or executable values. */
export function parseGraphViewOptions(value: unknown = {}): ViewOptions {
  const fail = (message: string): never => { throw new Error(`knowledge-graph-extraction: knowledge-graph.view ${message}`); };
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("must be a mapping");
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !Object.hasOwn(defaultView, key))) fail("contains an unsupported field");
  const result = { ...defaultView, ...input } as ViewOptions;
  for (const [key, allowed] of [["color-scheme", ["auto", "light", "dark"]], ["motion", ["auto", "paused"]], ["diagram-height", ["compact", "comfortable", "large"]]] as const) {
    if (!allowed.includes(result[key] as never)) fail(`${key} requires one of: ${allowed.join(", ")}`);
  }
  for (const [key, maximum] of [["repulsion", 200], ["attraction", .2]] as const) {
    if (typeof result[key] !== "number" || !Number.isFinite(result[key]) || result[key] < 0 || result[key] > maximum) fail(`${key} must be a finite number from 0 to ${maximum}`);
  }
  return result;
}
/** Named, literal queries for authors who know their own schema. Nothing here
 * invents a hierarchy, treats a citation as proof, or executes authored code. */
export function parseQueryProfiles(value: unknown = []): QueryProfile[] {
  const fail = (message: string): never => { throw new Error(`knowledge-graph-extraction: knowledge-graph.query-profiles ${message}`); };
  if (!Array.isArray(value) || value.length > 16) fail("must be an array with at most 16 profiles");
  const text = (item: unknown, maximum: number): item is string => typeof item === "string" && item.length > 0 && item.length <= maximum && item === item.trim() && !/[\u0000-\u001f\u007f]/.test(item);
  const seen = new Set<string>();
  return (value as unknown[]).map(entry => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) fail("entries must be mappings");
    const input = entry as Record<string, unknown>, operation = input.operation;
    if (typeof input.id !== "string" || !/^[a-z][a-z0-9-]{0,47}$/.test(input.id) || seen.has(input.id) || !text(input.label, 128)) fail("requires distinct lowercase IDs and nonempty labels of at most 128 characters");
    if (!["hierarchy", "evidence", "time-filter"].includes(operation as string)) fail("requires a supported operation");
    const allowed = new Set(["id", "label", "operation", ...(operation === "time-filter" ? ["fields", "types", "match"] : operation === "hierarchy" ? ["relations", "direction"] : ["relations", "types"])]);
    if (Object.keys(input).some(key => !allowed.has(key))) fail("contains an unsupported profile field");
    seen.add(input.id);
    const result = { id: input.id, label: input.label, operation } as QueryProfile;
    if (operation !== "time-filter") {
      const directions = operation === "hierarchy" ? ["child-to-parent", "parent-to-child"] : ["target-to-evidence", "evidence-to-target"];
      const relations = input.relations;
      if (!Array.isArray(relations) || !relations.length || relations.length > 32) fail("requires 1 to 32 explicit relation mappings");
      const types = new Set<string>();
      result.relations = (relations as unknown[]).map(entry => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) fail("relation mappings must contain type and direction");
        const relation = entry as Record<string, unknown>;
        if (Object.keys(relation).some(key => !["type", "direction"].includes(key)) || !text(relation.type, 128) || types.has(relation.type as string) || !directions.includes(relation.direction as string)) fail("relation mappings require distinct types and explicit supported directions");
        types.add(relation.type as string); return { type: relation.type as string, direction: relation.direction as string };
      }).sort((a, b) => a.type < b.type ? -1 : a.type > b.type ? 1 : 0);
    }
    if (operation === "hierarchy") {
      if (input.direction !== undefined && !["ancestors", "descendants"].includes(input.direction as string)) fail("hierarchy direction must be ancestors or descendants");
      result.direction = (input.direction ?? "ancestors") as QueryProfile["direction"];
    }
    if (input.types !== undefined) {
      if (!Array.isArray(input.types) || !input.types.length || input.types.length > 32 || input.types.some(item => !text(item, 128)) || new Set(input.types).size !== input.types.length) fail("types must be a nonempty list of at most 32 distinct types");
      result.types = [...input.types as string[]].sort();
    }
    if (operation === "time-filter") {
      const fields = input.fields;
      if (!fields || typeof fields !== "object" || Array.isArray(fields)) fail("time fields require one instant property or explicit start/end properties");
      const mapping = fields as Record<string, unknown>, keys = Object.keys(mapping);
      if (!(keys.length === 1 && text(mapping.instant, 128) || keys.length === 2 && text(mapping.start, 128) && text(mapping.end, 128)) || keys.some(key => !["instant", "start", "end"].includes(key))) fail("time fields require one instant property or explicit start/end properties");
      result.fields = mapping.instant !== undefined ? { instant: mapping.instant as string } : { start: mapping.start as string, end: mapping.end as string };
      if (input.match !== undefined && !["overlaps", "contained", "starts-within"].includes(input.match as string)) fail("time match must be overlaps, contained or starts-within");
      result.match = (input.match ?? "overlaps") as QueryProfile["match"];
    }
    return result;
  });
}
/** Preserve the historic default preimage while binding customised view bytes. */
export function graphViewRuntimeIdentity(dependencies: unknown[], value?: unknown, queryProfiles?: unknown): unknown[] {
  const view = parseGraphViewOptions(value);
  const profiles = parseQueryProfiles(queryProfiles);
  const result = Object.keys(defaultView).every(key => view[key as keyof ViewOptions] === defaultView[key as keyof ViewOptions])
    ? dependencies : [...dependencies, { kind: "graph-view-options", ...view }];
  return profiles.length ? [...result, { kind: "graph-query-profiles", profiles }] : result;
}
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
/** Complete text alternative, including graphs larger than the bounded diagram. */
export function graphReportHtml(graph: any, options: Options = {}): string {
  const prefix = local(options.sourcePrefix ?? "../"), title = createSemanticLabels(graph.objects);
  const label = graph.graph?.label ?? "Public knowledge graph";
  const objects = [...graph.objects].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const listing = objects.map((item: any) => {
    const links = graph.occurrences.filter((entry: any) => entry.target === item.id).map((entry: any) => {
      const href = destination(entry.destination);
      return href ? `<li><a href="${escape(prefix + href)}"${options.embedded ? ' target="_top"' : ''}>${escape(entry.source.path)}#${escape(entry.source.anchor)}</a></li>` : "";
    }).join("");
    return `<li><strong>${escape(title(item))}</strong> (${escape(item.type)}) <code>${escape(item.id)}</code>${item.summary ? `<p>${escape(item.summary)}</p>` : ""}${item.provenance ? `<p>Declared provenance: <code>${escape(JSON.stringify(item.provenance))}</code></p>` : ""}<ul>${links}</ul></li>`;
  }).join("\n");
  const relations = [...graph.relations].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).map((item: any) => `<li><code>${escape(item.type)}</code>: ${escape(item.from)} → ${escape(item.to)} <code>${escape(item.id)}</code></li>`).join("\n");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(label)} source report</title></head><body><main aria-labelledby="kg-source-report-heading"><h1 id="kg-source-report-heading">${escape(label)} source report</h1><p>Snapshot <code>${escape(graph.snapshotId)}</code>. Coverage: <strong>${escape(graph.status)}</strong>. Records are author-declared, not independently verified.</p><h2>All public records</h2><ul>${listing}</ul><h2>Relations</h2><ul>${relations}</ul><p><a href="graph.json">Machine-readable graph</a></p></main></body></html>\n`;
}
export function graphViewHtml(graph: any, options: Options = {}): string {
  const view = parseGraphViewOptions(options.view);
  const queryProfiles = parseQueryProfiles(options.queryProfiles);
  const graphUrl = local(options.graphUrl ?? "graph.json"), asset = local(options.assetPrefix ?? "./");
  const source = local(options.sourcePrefix ?? "../"), report = local(options.reportUrl ?? "report.html");
  const reading = parseReadingOptions(options.readingOptions), id = graph.graph?.id ?? 'website';
  const graphBase = `knowledge-graph/generations/${graph.snapshotId}/${id === 'website' ? '' : `graphs/${id}/`}`;
  const readingConfig = reading.enabled && /^[a-f0-9]{64}$/.test(graph.snapshotId) ? {version:1,snapshotId:graph.snapshotId,siteUrl:source,
    graphs:[{id,label:graph.graph?.label??'Website',graphUrl:graphBase+'graph.json',navigationUrl:graphBase+'navigation.html'}],activities:reading.activities} : null;
  if (!graph || !Array.isArray(graph.objects) || !Array.isArray(graph.occurrences) || !["complete", "incomplete"].includes(graph.status)) throw new Error("public graph required for navigation view");
  const label = graph.graph?.label ?? "Public knowledge graph", heading = `${label} — graph navigation`;
  const title = createSemanticLabels(graph.objects);
  const objects = [...graph.objects].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const listing = objects.slice(0, 200).map((item: any) => {
    const occurrence = graph.occurrences.find((entry: any) => entry.target === item.id && entry.source.path === item.source?.path && entry.source.anchor === item.source?.anchor)
      ?? graph.occurrences.find((entry: any) => entry.target === item.id);
    const href = occurrence && destination(occurrence.destination);
    return `<li>${href ? `<a href="${escape(source + href)}"${options.embedded ? ' target="_top"' : ''}>${escape(title(item))}</a>` : escape(title(item))} <span>Type: ${escape(item.type)}</span><br><code>${escape(item.id)}</code></li>`;
  }).join("\n");
  return `<!doctype html><html lang="en" data-color-scheme="${view["color-scheme"]}" data-diagram-height="${view["diagram-height"]}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(heading)}</title><link rel="stylesheet" href="${escape(asset + "graph-view.css")}"><script type="module" src="${escape(asset + "graph-view.js")}"></script></head><body>
<a class="kg-skip" href="#main-content">Skip to graph navigation</a><main id="main-content" aria-labelledby="kg-navigation-heading" data-kg-view${readingConfig ? ` data-reading-config="${escape(JSON.stringify(readingConfig))}"` : ''}${options.deliveryUrl ? ` data-delivery-url="${escape(local(options.deliveryUrl))}"` : ''} data-initial-motion="${view.motion}" data-query-profiles="${escape(JSON.stringify(queryProfiles))}" data-graph-url="${escape(graphUrl)}" data-source-prefix="${escape(source)}" data-source-target="${options.embedded ? '_top' : '_blank'}" data-snapshot-id="${escape(graph.snapshotId)}">
<h1 id="kg-navigation-heading">${escape(heading)}</h1><p class="kg-overview">Source coverage: <strong>${escape(graph.status)}</strong>. <a href="#kg-search-heading">Find a record</a> · <a href="${escape(report)}">Complete source report</a></p><details class="kg-provenance"><summary>Snapshot identity</summary><p><code>${escape(graph.snapshotId)}</code>. Records and links are author-declared; layout position is not evidence of a relationship.</p></details>
<p id="kg-status" role="status" aria-live="polite">Optional controls are loading. The source list below is usable without JavaScript.</p>
${options.deliveryUrl ? '<section aria-label="Graph detail loading"><p data-delivery-status role="status" aria-live="polite">Loading the complete discovery index. Details are requested by topic with their dependency closure.</p><button type="button" data-load-all>Load all graph details</button><p>Missing details remain unknown. Topics connected by relations or prerequisites load together; unrelated topics can remain unloaded.</p></section>' : ''}
<div data-controls hidden>
<section class="kg-diagram-section" aria-labelledby="kg-diagram-heading"><h2 id="kg-diagram-heading">Explore the connections</h2><p id="kg-diagram-help">Drag nodes or pan the background. Release a node to resume the running layout. Buttons and the source list below provide keyboard and touch alternatives.</p>
<div class="kg-controls kg-diagram-toolbar" role="group" aria-label="Diagram view"><button type="button" data-simulation-toggle>Pause layout</button><button type="button" data-fit-view>Fit graph</button><button type="button" data-zoom="in">Zoom in</button><button type="button" data-zoom="out">Zoom out</button><button type="button" data-reset-view>Reset view</button></div>
<p class="kg-layout-state" data-simulation-state data-state="paused" role="status" aria-live="polite">Preparing the layout.</p>
<div class="kg-surface"><svg viewBox="0 0 1000 650" aria-hidden="true" data-diagram><g data-scene></g></svg></div>
<ul class="kg-type-legend" data-type-legend aria-label="Declared node types"></ul><p class="kg-diagram-note" data-diagram-note></p>
<div class="kg-controls kg-secondary-controls" role="group" aria-label="Diagram movement"><span>Pan:</span><button type="button" data-pan="left">Pan left</button><button type="button" data-pan="right">Pan right</button><button type="button" data-pan="up">Pan up</button><button type="button" data-pan="down">Pan down</button></div>
<div class="kg-controls kg-secondary-controls" role="group" aria-label="Arrange the selected node"><span>Move selected node:</span><button type="button" data-move="left">Left</button><button type="button" data-move="right">Right</button><button type="button" data-move="up">Up</button><button type="button" data-move="down">Down</button></div>
<details class="kg-settings"><summary>Layout settings</summary><p>These forces change the picture only. They do not change the graph, relation weights, difficulty costs or accepted route. Zoom with the buttons or mouse wheel; Fit graph brings displayed nodes back into view.</p><div class="kg-controls"><label>Repulsion <input name="repulsion" type="range" min="0" max="200" step="any" value="${view.repulsion}" data-force="repulsion"><output data-force-value="repulsion">${view.repulsion}</output></label><label>Link attraction <input name="attraction" type="range" min="0" max="0.2" step="any" value="${view.attraction}" data-force="attraction"><output data-force-value="attraction">${view.attraction}</output></label></div><p>Layout is paused initially when the author chooses a paused layout or your device requests reduced motion. You can resume explicitly; dragging and movement buttons do not override a pause.</p></details></section>
<section aria-labelledby="kg-search-heading"><h2 id="kg-search-heading">Find and inspect</h2><form data-search><label>Text <input name="text" type="search" autocomplete="off" maxlength="10000" data-focus-key="search:text"></label><label>Domain <select name="scope" data-focus-key="search:scope"><option value="">All domains</option></select></label><button type="submit" data-focus-key="search:submit">Search public records</button></form><p data-search-summary></p></section>
<section aria-labelledby="kg-detail-heading"><h2 id="kg-detail-heading" tabindex="-1">Selected record</h2><div data-detail>Select a record from the list.</div></section>
<section aria-labelledby="kg-query-heading"><h2 id="kg-query-heading">Ask a named question</h2><p id="kg-query-help">Questions use the domain selected above and the current public snapshot. Hierarchy and evidence questions use the selected record. Evidence means an author-declared association, not an independent proof verdict.</p><form data-query-form aria-describedby="kg-query-help"><label>Question <select name="profile"><option value="counts">Count records and relations</option><option value="pages">List source pages</option>${queryProfiles.map(profile => `<option value="profile:${escape(profile.id)}">${escape(profile.label)}</option>`).join("")}</select></label><fieldset data-time-window hidden disabled><legend>Closed date window</legend><label>From <input name="windowStart" type="date" required></label><label>Through <input name="windowEnd" type="date" required></label><p>Use exact calendar days. Missing, uncertain, open-ended or less precise source dates remain undetermined.</p></fieldset><button type="submit">Run this question</button></form><p data-query-status role="status" aria-live="polite">No question has been run.</p><div data-query-result></div></section>
<section aria-labelledby="kg-route-heading"><h2 id="kg-route-heading" tabindex="-1">A route through these records</h2><p>Cost is a reader-selected navigation preference, not proof of pedagogical validity. Declared prerequisites remain hard requirements; earlier planned steps must actually be completed.</p>
<form data-route-form><label>Route between <select name="mode"><option value="records">Records</option><option value="pages">Source pages</option></select></label><label>Start <select name="start" required></select></label><label>Goal <select name="goal" required></select></label><label>Follow edges <select name="direction"><option value="outgoing">In their declared direction</option><option value="incoming">In reverse direction</option><option value="both">In either direction</option></select></label><label>Route relation types <select name="relationTypes" multiple aria-describedby="kg-relation-help"></select></label><p id="kg-relation-help">No selection follows all declared relation types. Selecting types restricts route edges; declared prerequisites still apply. Page routes minimise semantic record cost, not the number of pages; sharing a page does not connect unrelated records.</p><label>Difficulty multiplier <input name="difficulty" type="number" min="0" step="0.25" value="1" required></label><button type="submit">Compute a bounded candidate</button></form>
<div data-candidate></div><div data-route></div><div class="kg-controls"><button type="button" data-return hidden>Return one exploration step</button><button type="button" data-return-route hidden>Return to accepted route</button><button type="button" data-clear-route hidden>Clear accepted route</button></div>
<label><input type="checkbox" data-persistent> Retain reader choices in this browser between sessions</label><button type="button" data-forget>Forget stored reader choices</button><p data-storage-note>Session storage is best-effort. No reader choices are sent to a server.</p></section></div>
<section aria-labelledby="kg-list-heading"><h2 id="kg-list-heading">Public source list</h2><p data-list-note>${objects.length > 200 ? "The static list shows the first 200 records; use the complete static report for all records." : "These records retain separate identifiers and declared domains."}</p><ul data-results>${listing}</ul></section>
</main></body></html>\n`;
}
export async function buildGraphView(graph: any, options: Options = {}) {
  const assets: Record<string, string> = {};
  for (const name of ["query.js", "graph-force.js", "graph-label-layout.js", "graph-view.js", "graph-view.css", "delivery.js", "reading-route.js"]) assets[name] = await Deno.readTextFile(new URL(`./${name}`, import.meta.url));
  return { html: graphViewHtml(graph, options), assets };
}
