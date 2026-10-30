/** Optional adapter for Quarto's local Algolia Autocomplete UI. All content uses
 * the original native provider unchanged. Scoped providers search the complete
 * current public corpus before applying the native result limit. No model,
 * persistent preference, cloud request, or generated Quarto source patch. */
const MAX_ENTRIES = 100000, MAX_BYTES = 32 * 1024 * 1024, MAX_TEXT = 200000;
const fail = () => { throw new Error("knowledge-graph-extraction: optional site search data is invalid"); };
const mapping = value => value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value, maximum = MAX_TEXT) => typeof value === "string" && value.length <= maximum && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
const graphId = value => typeof value === "string" && /^[a-z][a-z0-9-]{0,63}$/.test(value) && !["constructor", "prototype", "__proto__"].includes(value);
const escape = value => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");

export function validateSiteSearchConfig(value) {
  if (!mapping(value) || value.version !== 1 || !/^[a-f0-9]{64}$/.test(value.snapshotId ?? "") || !Array.isArray(value.graphs) || value.graphs.length > 500 || !relativeUrl(value.indexUrl, true)) fail();
  const seen = new Set();
  const graphs = value.graphs.map(graph => {
    if (!mapping(graph) || Object.keys(graph).some(key => !["id", "label", "status"].includes(key)) || !graphId(graph.id) || seen.has(graph.id) || !text(graph.label, 256) || !graph.label.trim() || (graph.status !== undefined && !["complete", "incomplete"].includes(graph.status))) fail();
    seen.add(graph.id);
    return { id: graph.id, label: graph.label, status: graph.status ?? "complete" };
  });
  return { version: 1, snapshotId: value.snapshotId, graphs, indexUrl: value.indexUrl };
}

function relativeUrl(value, ancestors = false) {
  if (typeof value !== "string" || !value || value.length > 4096 || value !== value.trim() || /^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith("/") || /[\\\u0000-\u0020]/.test(value)) return false;
  let decoded;
  try { decoded = decodeURIComponent(value); } catch { return false; }
  if (/[\\\u0000-\u0020]/.test(decoded) || decoded.startsWith("/") || /^[a-z][a-z0-9+.-]*:/i.test(decoded) || /%(?:25)*(?:2e|2f|5c|00)/i.test(decoded)) return false;
  const path = decoded.split(/[?#]/)[0];
  // A renderer may prepend literal parent offsets to its trusted index URL;
  // encoded traversal and parents inside a path are never accepted.
  const own = ancestors ? value.replace(/^(?:\.\.\/)+/, "").replace(/^\.\//, "") : value;
  return !own.split(/[?#]/)[0].split("/").some(part => part === "." || part === "..")
    && !(decoded !== value && path.split("/").some(part => part === "." || part === ".."))
    && (!ancestors || !/[?#]/.test(value));
}

export function graphMemberships(entry) {
  const values = [...(entry.graphId === undefined ? [] : [entry.graphId]), ...(entry.graphIds ?? [])];
  if (!values.every(graphId)) fail();
  return [...new Set(values)];
}

export function validateSiteSearchIndex(value, rawConfig) {
  const config = validateSiteSearchConfig(rawConfig);
  if (!mapping(value) || value.version !== 1 || value.snapshotId !== config.snapshotId || !Array.isArray(value.entries) || value.entries.length > MAX_ENTRIES) fail();
  const descriptors = validateSiteSearchConfig({ ...config, graphs: value.graphs }).graphs;
  if (JSON.stringify(descriptors) !== JSON.stringify(config.graphs)) fail();
  const known = new Set(config.graphs.map(graph => graph.id));
  const entries = value.entries.map(entry => {
    if (!mapping(entry) || !relativeUrl(entry.href) || !text(entry.title ?? "") || !text(entry.text ?? "") || (entry.section !== undefined && !text(entry.section)) || (entry.semanticId !== undefined && !text(entry.semanticId, 4096)) || (entry.graphIds !== undefined && (!Array.isArray(entry.graphIds) || entry.graphIds.length > 500))) fail();
    const memberships = graphMemberships(entry);
    if (memberships.some(id => !known.has(id)) || ((entry.kgGenerated === 1 || entry.kgEnriched === 1) && (!memberships.length || !entry.semanticId)) || (entry.kgGenerated !== undefined && entry.kgGenerated !== 1) || (entry.kgEnriched !== undefined && entry.kgEnriched !== 1)) fail();
    const row = { href: entry.href, title: entry.title ?? "", text: entry.text ?? "" };
    if (entry.section !== undefined) row.section = entry.section;
    if (entry.objectID !== undefined) { if (!text(entry.objectID, 8192) && typeof entry.objectID !== "number") fail(); row.objectID = entry.objectID; }
    if (entry.crumbs !== undefined) {
      if (!Array.isArray(entry.crumbs) || entry.crumbs.length > 100 || !entry.crumbs.every(part => text(part, 4096))) fail();
      row.crumbs = [...entry.crumbs];
    }
    if (entry.semanticId !== undefined) row.semanticId = entry.semanticId;
    if (memberships.length) { row.graphId = entry.graphId ?? memberships[0]; row.graphIds = memberships; }
    if (entry.kgGenerated === 1) row.kgGenerated = 1;
    if (entry.kgEnriched === 1) {
      const original = entry.kgOriginal;
      if (!mapping(original) || !text(original.title) || !text(original.text) || typeof original.hadSection !== "boolean" || (original.hadSection && !text(original.section))) fail();
      row.kgEnriched = 1;
      row.kgOriginal = { title: original.title, text: original.text, hadSection: original.hadSection, section: original.hadSection ? original.section : null };
    }
    return row;
  });
  return { version: 1, snapshotId: config.snapshotId, graphs: descriptors, entries };
}

export function scopedSiteSearchEntries(index, scope) {
  if (scope === "all") return index.entries;
  if (scope === "pages") return index.entries.filter(entry => entry.kgGenerated !== 1).map(entry => {
    const { kgEnriched, kgGenerated, kgOriginal, graphId, graphIds, semanticId, ...original } = entry;
    if (kgEnriched === 1) {
      original.title = kgOriginal.title; original.text = kgOriginal.text;
      if (kgOriginal.hadSection) original.section = kgOriginal.section;
      else delete original.section;
    }
    return original;
  });
  const id = scope.startsWith("graph:") ? scope.slice(6) : scope;
  if (!index.graphs.some(graph => graph.id === id)) fail();
  return index.entries.filter(entry => graphMemberships(entry).includes(id));
}

/** Independent per-scope Fuse indexes, never a post-limit filter or native
 * private sub-index. Return safe snippets for native innerHTML templates. */
export function createScopedSiteSearch(index, Fuse) {
  const scopes = new Map();
  return (scope, query, limit = 50) => {
    if (!text(query, 2048) || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000) fail();
    if (!query.trim()) return [];
    let fuse = scopes.get(scope);
    if (!fuse) fuse = new Fuse(scopedSiteSearchEntries(index, scope), {
      keys: [{ name: "title", weight: 20 }, { name: "section", weight: 20 }, { name: "text", weight: 10 }],
      ignoreLocation: true, threshold: .1, isCaseSensitive: false, minMatchCharLength: 2, shouldSort: true,
    });
    scopes.delete(scope); scopes.set(scope, fuse);
    // Three recently selected scopes avoid multiplying a large corpus by every
    // graph merely because a reader explored the select options.
    if (scopes.size > 3) scopes.delete(scopes.keys().next().value);
    return fuse.search(query, { limit }).map(({ item }) => {
      const hash = item.href.indexOf("#"), path = hash < 0 ? item.href : item.href.slice(0, hash), anchor = hash < 0 ? "" : item.href.slice(hash);
      const href = path + (path.includes("?") ? "&" : "?") + "q=" + encodeURIComponent(query) + anchor;
      const position = item.text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
      const start = Math.max(0, position - 80), end = Math.min(item.text.length, start + 400);
      return { ...item, href, text: (start ? "…" : "") + escape(item.text.slice(start, end)) + (end < item.text.length ? "…" : "") };
    });
  };
}

/** Match only the native container and documents source; preserve all other
 * Autocomplete instances, providers, templates, reshape and keyboard handlers. */
export function wrapSiteSearchAutocomplete(original, { host, scope, search, unavailable, captured, changed }) {
  return function (options, ...rest) {
    if (!options || (options.container !== host && options.container !== "#quarto-search")) return original.call(this, options, ...rest);
    if (typeof options.getSources !== "function") { unavailable(); return original.call(this, options, ...rest); }
    const getSources = options.getSources;
    const adapted = { ...options, getSources(...args) {
      const adapt = sources => {
        if (!Array.isArray(sources) || !sources.some(source => source?.sourceId === "documents" && typeof source.getItems === "function")) { unavailable(); return sources; }
        return sources.map(source => source?.sourceId !== "documents" ? source : { ...source, getItems(...itemArgs) {
          if (scope() === "all") return source.getItems.apply(this, itemArgs);
          return Promise.resolve().then(() => search(scope(), itemArgs[0]?.query ?? "")).catch(() => { unavailable(); return source.getItems.apply(this, itemArgs); });
        } });
      };
      const sources = getSources.apply(this, args);
      return sources && typeof sources.then === "function" ? sources.then(adapt) : adapt(sources);
    }, onStateChange(...args) {
      const result = options.onStateChange?.apply(this, args);
      changed?.(args[0]); return result;
    } };
    const instance = original.call(this, adapted, ...rest);
    if (!instance || typeof instance.refresh !== "function") unavailable();
    else captured(instance);
    return instance;
  };
}

export function resolveSiteSearchUrl(value, location, offset = "") {
  if (!relativeUrl(value, true) || !/^(?:\.\.\/)*$/.test(offset)) fail();
  const base = new URL(location), root = new URL(offset || "./", base), url = new URL(value, base);
  if (!["http:", "https:"].includes(base.protocol) || url.origin !== base.origin || !url.pathname.startsWith(root.pathname) || url.search || url.hash) fail();
  return url.href;
}

async function readIndex(config, environment) {
  const { document, location } = environment;
  const offset = document.querySelector('meta[name="quarto:offset"]')?.content ?? "";
  const url = resolveSiteSearchUrl(config.indexUrl, location.href, offset);
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await environment.fetch(url, { signal: controller.signal, credentials: "same-origin", redirect: "error" });
    if (!response.ok || Number(response.headers.get("content-length") ?? 0) > MAX_BYTES) fail();
    let content;
    if (response.body?.getReader) {
      const reader = response.body.getReader(), decoder = new TextDecoder("utf-8", { fatal: true });
      let size = 0; content = "";
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > MAX_BYTES) { await reader.cancel(); fail(); }
        content += decoder.decode(value, { stream: true });
      }
      content += decoder.decode();
    } else { content = await response.text(); if (new TextEncoder().encode(content).byteLength > MAX_BYTES) fail(); }
    return validateSiteSearchIndex(JSON.parse(content), config);
  } finally { clearTimeout(timeout); }
}

export function installSiteSearch(environment = window) {
  const { document } = environment, configElements = document.querySelectorAll("[data-kg-site-search-config]");
  if (!configElements.length) return;
  const host = document.getElementById("quarto-search");
  if (!host) return; // Native search was deliberately disabled on this page.
  const control = document.createElement("div"); control.className = "kg-site-search-scope";
  control.setAttribute("data-kg-site-search-control", "");
  const label = document.createElement("label"), select = document.createElement("select"), status = document.createElement("p");
  select.id = "kg-site-search-scope"; label.htmlFor = select.id; label.textContent = "Search within";
  status.id = "kg-site-search-status";
  status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
  select.setAttribute("aria-describedby", status.id);
  control.append(label, select, status); host.insertAdjacentElement("afterend", control);
  let selected = "all", instance, config, failed = false, pending, search, scheduled = false, overlay = false;
  const unavailable = () => {
    selected = "all"; select.value = "all"; select.disabled = true; failed = true;
    control.setAttribute("data-unavailable", "");
    status.textContent = "Optional graph filter unavailable. Native search remains available for all content.";
  };
  const place = () => {
    if (scheduled) return; scheduled = true;
    environment.requestAnimationFrame(() => {
      scheduled = false;
      const forms = document.querySelectorAll(".aa-DetachedContainer .aa-DetachedFormContainer");
      // Do not attach to an ambiguous third-party dialog.
      const target = forms.length === 1 ? forms[0] : host;
      control.hidden = overlay && forms.length !== 1;
      if (!target.contains(control)) target.append(control);
    });
  };
  try {
    if (configElements.length !== 1 || host.querySelector(".aa-Autocomplete") || document.readyState === "complete") throw new Error();
    config = validateSiteSearchConfig(JSON.parse(configElements[0].textContent));
    control.setAttribute("data-snapshot-id", config.snapshotId);
    const native = JSON.parse(document.getElementById("quarto-search-options")?.textContent ?? "{}");
    overlay = native.type === "overlay"; control.hidden = overlay;
    const library = environment["@algolia/autocomplete-js"], original = library?.autocomplete;
    if (native.algolia || typeof original !== "function" || typeof environment.Fuse !== "function") throw new Error();
    const limit = native.limit ?? 50;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new Error();
    for (const option of [{ id: "all", label: "All content" }, { id: "pages", label: "Website pages only" }, ...config.graphs.map(graph => ({ ...graph, id: `graph:${graph.id}` }))]) {
      const node = document.createElement("option"); node.value = option.id; node.textContent = option.label; select.append(node);
    }
    select.addEventListener("change", () => {
      selected = select.value;
      const graph = config.graphs.find(item => `graph:${item.id}` === selected);
      status.textContent = graph ? `${graph.label}${graph.status === "incomplete" ? ": incomplete graph coverage" : ": public graph records"}. Source pages remain available under All content.` : selected === "pages" ? "Searching the original website page index." : "Searching all website pages and searchable public graphs.";
      Promise.resolve(instance?.refresh()).catch(unavailable);
    });
    const wrapper = wrapSiteSearchAutocomplete(original, {
      host, scope: () => selected, unavailable, changed: place,
      captured(value) { instance = value; if (library.autocomplete === wrapper) library.autocomplete = original; place(); },
      async search(scope, query) {
        if (!pending) pending = readIndex(config, environment).then(index => { search = createScopedSiteSearch(index, environment.Fuse); });
        await pending; return search(scope, query, limit);
      },
    });
    library.autocomplete = wrapper;
    if (library.autocomplete !== wrapper) throw new Error();
    // Native listeners are already registered; this runs after native init.
    document.addEventListener("DOMContentLoaded", () => {
      if (!instance && !failed) { if (library.autocomplete === wrapper) library.autocomplete = original; unavailable(); }
      place();
    }, { once: true });
  } catch { unavailable(); }
  // Reuse this single control when native Autocomplete opens/closes its dialog.
  // Only child-list changes are observed, and placement is one frame at a time.
  if (environment.MutationObserver) new environment.MutationObserver(place).observe(document.body, { childList: true, subtree: true });
  return { control, unavailable, get scope() { return selected; } };
}

if (typeof window !== "undefined" && typeof document !== "undefined") installSiteSearch(window);
