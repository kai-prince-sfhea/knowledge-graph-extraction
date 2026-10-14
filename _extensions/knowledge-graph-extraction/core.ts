import { parse } from "stdlib/yaml";
import { dirname, extname, fromFileUrl, isAbsolute, join, relative, resolve } from "stdlib/path";
import { parseAIConfig } from "./ai-config.ts";
import { sourceCollections } from "./collections.ts";
import { parseExportOptions } from "./exports.ts";
import { parseSchema, validateObjectType, validateProperties, validateRelationEndpoints, validateWeight } from "./schema.ts";
export { publicRecord } from "./schema.ts";

export const VERSION = "0.0.6";
export const STATE = ".quarto/knowledge-graph";
export const PUBLIC = "knowledge-graph";
type RecordValue = Record<string, any>;

export function fail(message: string): never {
  throw new Error(`knowledge-graph-extraction: ${message}`);
}

export function record(value: unknown, name: string): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${name} must be a mapping`);
  return value as RecordValue;
}

export function keys(value: RecordValue, allowed: string[], name: string): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) fail(`${name} contains an unsupported field`);
}

export function text(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim() || /[\u0000-\u001f]/.test(value)) fail(`${name} must be nonempty text`);
  return value;
}

export function projectPath(value: unknown): string {
  const path = text(value, "path").replaceAll("\\", "/");
  if (isAbsolute(path) || path.includes(":") || path.split("/").some((part) => !part || part === "." || part === "..")) {
    fail("paths must stay within the project without traversal");
  }
  return path;
}

export async function confined(root: string, path: string): Promise<string> {
  const absolute = resolve(root, projectPath(path));
  let ancestor = absolute;
  while (true) {
    try {
      const real = await Deno.realPath(ancestor);
      const inside = relative(await Deno.realPath(root), real);
      if (inside === ".." || inside.startsWith(`..${Deno.build.os === "windows" ? "\\" : "/"}`) || isAbsolute(inside)) {
        fail("a path resolves outside the project (including symbolic links)");
      }
      return absolute;
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
      const parent = dirname(ancestor);
      if (parent === ancestor) throw error;
      ancestor = parent;
    }
  }
}

export function canonical(value: any): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export async function digest(value: string | Uint8Array): Promise<string> {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : new Uint8Array(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function atomicJson(path: string, value: any): Promise<void> {
  await Deno.mkdir(dirname(path), { recursive: true });
  const pending = `${path}.${crypto.randomUUID()}.pending`;
  await Deno.writeTextFile(pending, `${canonical(value)}\n`);
  await Deno.rename(pending, path);
}

export async function readJson(path: string): Promise<any> {
  return JSON.parse(await Deno.readTextFile(path));
}

export function environmentList(name: string, required = false): string[] {
  // Quarto can put a large input/output inventory in a newline-delimited file instead of an
  // environment variable (QUARTO_USE_FILE_FOR_PROJECT_*_FILES).
  const inventoryFile = Deno.env.get(`QUARTO_USE_FILE_FOR_${name.replace(/^QUARTO_/, "")}`);
  const value = inventoryFile ? Deno.readTextFileSync(inventoryFile) : Deno.env.get(name);
  if (required && value === undefined) fail(`Quarto did not supply ${name}; use quarto render or quarto preview`);
  return (value ?? "").split(/\r?\n/).filter(Boolean).map(projectPath);
}

async function inspect(root: string, input?: string): Promise<RecordValue> {
  const bin = Deno.env.get("QUARTO_BIN_PATH");
  const executable = bin ? join(bin, Deno.build.os === "windows" ? "quarto.exe" : "quarto") : "quarto";
  const result = await new Deno.Command(executable, {
    args: ["inspect", input ?? root], cwd: root, stdout: "piped", stderr: "piped",
  }).output();
  if (!result.success) fail("Quarto could not inspect a selected input/project; run quarto inspect privately to diagnose its configuration");
  try { return record(JSON.parse(new TextDecoder().decode(result.stdout)), "Quarto inspection"); }
  catch { fail("Quarto inspect did not return valid project JSON"); }
}

function relativeInput(root: string, path: unknown): string {
  const value = text(path, "Quarto input path");
  return projectPath(isAbsolute(value) ? relative(root, value).replaceAll("\\", "/") : value);
}

/** Effective project context comes from Quarto rather than a second YAML merger. */
export async function inspectProject(root: string): Promise<RecordValue> {
  const result = await inspect(root);
  const config = record(result.config, "effective Quarto configuration");
  const inputSources = array(result.files?.input ?? [], "Quarto input inventory")
    .map((path) => relativeInput(root, path));
  const project = { ...result, config, inputSources };
  return { ...project, activeInputSources: await activeInputSources(root, project) };
}

function hasFilter(value: unknown): boolean {
  const entries = Array.isArray(value) ? value : value === undefined ? [] : [value];
  return entries.some((entry) => {
    const path = typeof entry === "string" ? entry : entry && typeof entry === "object" ? entry.path : undefined;
    if (typeof path !== "string") return false;
    const normalized = path.replaceAll("\\", "/");
    return /(?:^|\/)knowledge-graph-extraction$/.test(normalized) ||
      /(?:^|\/)knowledge-graph-extraction\/extract\.lua$/.test(normalized);
  });
}

function configurationEnabled(config: RecordValue): boolean {
  if (config["knowledge-graph"]?.enabled === false) return false;
  return configurationHasFilter(config);
}

function configurationHasFilter(config: RecordValue): boolean {
  if (hasFilter(config.filters)) return true;
  if (config.format && typeof config.format === "object" && !Array.isArray(config.format)) {
    return Object.values(config.format).some((format) => format && typeof format === "object" && hasFilter((format as RecordValue).filters));
  }
  return false;
}

/** Locate applicable named filters using native frontmatter and local inherited
 * metadata. This is a filter-presence check, not a second Quarto YAML merger.
 * Deliberately disabled pages remain in scope so the observer can mark their
 * coverage honestly; disabling a page must not manufacture a complete graph.
 */
export async function activeInputSources(root: string, project: RecordValue): Promise<string[]> {
  if (project.config?.["knowledge-graph"]?.enabled === false) return [];
  const inputs: string[] = (project.inputSources ?? []).filter((path: string) => extname(path).toLowerCase() === ".qmd");
  if (hasFilter(project.config?.filters)) return inputs;
  const metadataBySource = new Map<string, RecordValue>();
  for (const [value, entry] of Object.entries(project.fileInformation ?? {})) {
    const path = relativeInput(root, value);
    metadataBySource.set(path, (entry as RecordValue).metadata ?? {});
  }
  const cache = new Map<string, RecordValue[]>();
  const active = new Set<string>();
  const directories = new Map<string, RecordValue[]>();
  const directoryFormats = new Map<string, string[]>();
  function formatNames(value: unknown): string[] {
    if (typeof value === "string") return [value];
    return value && typeof value === "object" && !Array.isArray(value) ? Object.keys(value) : [];
  }
  function filterForFormats(metadata: RecordValue, names: Set<string>): boolean {
    if (hasFilter(metadata.filters)) return true;
    if (!metadata.format || typeof metadata.format !== "object" || Array.isArray(metadata.format)) return false;
    return Object.entries(metadata.format).some(([name, value]) => names.has(name) &&
      value && typeof value === "object" && !Array.isArray(value) && hasFilter((value as RecordValue).filters));
  }
  function localPath(value: unknown, directory: string): string | null {
    if (typeof value !== "string") return null;
    const path = value.replaceAll("\\", "/");
    if (/^[A-Za-z][A-Za-z\d+.-]*:/.test(path) && !isAbsolute(path)) return null;
    try {
      const absolute = path.startsWith("/") ? resolve(root, path.slice(1))
        : isAbsolute(path) ? path : resolve(root, directory, path);
      return projectPath(relative(root, absolute).replaceAll("\\", "/"));
    } catch { return null; }
  }
  async function linked(metadata: RecordValue, directory: string): Promise<RecordValue[]> {
    const values = [metadata];
    for (const key of ["metadata-file", "metadata-files"]) {
      const field = metadata[key];
      if (field === undefined) continue;
      for (const entry of Array.isArray(field) ? field : [field]) {
        const path = localPath(entry, directory);
        if (path !== null) values.push(...await metadataFile(path, directory));
      }
    }
    if (metadata.format && typeof metadata.format === "object" && !Array.isArray(metadata.format)) {
      for (const [name, value] of Object.entries(metadata.format)) {
        if (value && typeof value === "object" && !Array.isArray(value)) {
          // Keep imported format settings attached to that format; flattening
          // them would accidentally treat an HTML-only filter as global.
          for (const entry of await linked(value as RecordValue, directory)) values.push({ format: { [name]: entry } });
        }
      }
    }
    return values;
  }
  async function metadataFile(path: string, directory: string): Promise<RecordValue[]> {
    const key = `${directory}\n${path}`;
    if (cache.has(key)) return cache.get(key)!;
    if (active.has(key)) return [];
    active.add(key);
    let values: RecordValue[];
    try {
      const metadata = record(parse(await Deno.readTextFile(await confined(root, path))) ?? {}, "activation metadata");
      values = await linked(metadata, directory);
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
      values = [];
    }
    active.delete(key);
    cache.set(key, values);
    return values;
  }
  async function inherited(directory: string): Promise<RecordValue[]> {
    if (directories.has(directory)) return directories.get(directory)!;
    // Mirror directoryMetadataForInputFile: root metadata applies to root
    // pages; nested pages begin at their first child directory. At each level
    // Quarto selects the first existing suffix, preferring .yml over .yaml.
    const parent = dirname(directory);
    const values = directory === "." || parent === "." ? [] : [...await inherited(parent)];
    const names = directory === "." || parent === "." ? [] : [...directoryFormats.get(parent)!];
    for (const name of ["_metadata.yml", "_metadata.yaml"]) {
      const entries = await metadataFile(projectPath(join(directory, name).replaceAll("\\", "/")), directory);
      if (entries.length) { values.push(...entries); names.push(...formatNames(entries[0].format)); break; }
    }
    directories.set(directory, values);
    directoryFormats.set(directory, [...new Set(names)]);
    return values;
  }
  const selected: string[] = [];
  for (const path of inputs) {
    const directory = dirname(path);
    const metadata = metadataBySource.get(path) ?? {};
    const values = [...await inherited(directory), ...await linked(metadata, directory)];
    // Native resolveFormats selects explicit document/directory format keys
    // before project defaults. Imports contribute settings for those selected
    // formats; they do not turn a format-scoped filter into a global filter.
    const localFormats = [...new Set([...formatNames(metadata.format), ...directoryFormats.get(directory)!])];
    const projectFormats = formatNames(project.config?.format);
    const names = new Set(project.config?.project?.type === "book" || !localFormats.length
      ? projectFormats.length ? projectFormats : ["html"] : localFormats);
    if ([project.config ?? {}, ...values].some(value => filterForFormats(value, names))) selected.push(path);
  }
  return selected;
}

/** Installation alone must not validate declarations or create graph state. */
export function projectEnabled(project: RecordValue): boolean {
  if (project.config?.["knowledge-graph"]?.enabled === false) return false;
  if (Array.isArray(project.activeInputSources)) return project.activeInputSources.length > 0;
  if (configurationEnabled(project.config ?? {})) return true;
  return Object.values(project.fileInformation ?? {}).some((entry) =>
    entry && typeof entry === "object" && configurationEnabled((entry as RecordValue).metadata ?? {}));
}

function array(value: unknown, name: string): any[] {
  if (!Array.isArray(value)) fail(`${name} must be a sequence`);
  return value;
}

function identifier(value: unknown, namespaces: RecordValue): string {
  const id = text(value, "id");
  const split = id.indexOf(":");
  const prefix = id.slice(0, split);
  const expanded = split > 0 && Object.hasOwn(namespaces, prefix) ? `${namespaces[prefix]}${id.slice(split + 1)}` : id;
  let uri: URL;
  try { uri = new URL(expanded); } catch { fail("an id needs an absolute HTTP(S) URI or declared namespace"); }
  if (!["https:", "http:"].includes(uri.protocol) || uri.username || uri.password || /\s/.test(expanded)) fail("ids must be explicit HTTP(S) identifiers without credentials");
  return expanded;
}

function source(value: unknown, sources: Set<string>): RecordValue {
  const item = record(value, "source reference");
  keys(item, ["path", "anchor"], "source reference");
  const path = projectPath(item.path);
  if (!sources.has(path)) fail("an occurrence/source reference is outside the declared source inventory");
  const anchor = text(item.anchor, "anchor");
  if (/[\s"'<>]/.test(anchor)) fail("anchor contains unsupported characters");
  return { path, anchor, precision: "anchor" };
}

export async function loadProject(root: string, inspected?: RecordValue): Promise<RecordValue> {
  const inspection = inspected ?? await inspectProject(root);
  const config = inspection.config;
  const options = record(config["knowledge-graph"] ?? {}, "knowledge-graph configuration");
  keys(options, ["declarations", "schema", "mode", "enabled", "protected-literals", "ai", "cache", "git", "navigation", "exports", "dependencies", "authoring"], "knowledge-graph configuration");
  if (options.authoring !== undefined && typeof options.authoring !== "boolean") fail("knowledge-graph.authoring must be boolean");
  for (const name of ["cache", "git", "navigation"]) {
    if (options[name] !== undefined && typeof options[name] !== "boolean") fail(`knowledge-graph.${name} must be boolean`);
  }
  const ai = parseAIConfig(options.ai);
  const schemaPath = options.schema === undefined ? undefined : projectPath(options.schema);
  const schema = parseSchema(schemaPath === undefined ? undefined
    : parse(await Deno.readTextFile(await confined(root, schemaPath))));
  const schemaDigest = await digest(canonical(schema));
  if (options.enabled !== undefined && typeof options.enabled !== "boolean") fail("knowledge-graph.enabled must be boolean");
  const protectedLiterals = array(options["protected-literals"] ?? [], "knowledge-graph.protected-literals")
    .map((value) => text(value, "protected literal"));
  if (new Set(protectedLiterals).size !== protectedLiterals.length) fail("protected-literals contains duplicates");
  const mode = Deno.env.get("KG_MODE") ?? options.mode ?? "update";
  if (!["update", "frozen"].includes(mode)) fail("mode must be update or frozen");
  const declarationPath = projectPath(options.declarations ?? "knowledge.yml");
  const declaration = record(parse(await Deno.readTextFile(await confined(root, declarationPath))), "declarations");
  keys(declaration, ["version", "namespaces", "sources", "collections", "objects", "relations"], "declarations");
  if (declaration.version !== 0) fail("only declaration version 0 is supported");
  const namespaces = record(declaration.namespaces, "namespaces");
  for (const [prefix, base] of Object.entries(namespaces)) {
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(prefix)) fail("invalid namespace prefix");
    identifier(base, {});
  }
  const inputSources = inspection.inputSources as string[];
  const activeSources: string[] = inspection.activeInputSources ?? await activeInputSources(root, inspection);
  const paths: string[] = declaration.sources === undefined ? activeSources : array(declaration.sources, "sources").map((value) => {
    const entry = record(value, "source");
    keys(entry, ["path"], "source");
    const path = projectPath(entry.path);
    if (extname(path).toLowerCase() !== ".qmd") fail("KG-0 source inventory accepts QMD pages only");
    return path;
  });
  if (!paths.length || new Set(paths).size !== paths.length) fail("source inventory is empty or contains duplicates");
  if (paths.some((path) => !inputSources.includes(path))) fail("a selected source is outside Quarto's current render inventory; check project.render and the active profile");
  if (paths.some((path) => !activeSources.includes(path))) fail("a selected source has no knowledge-graph-extraction filter; activate the filter for that page or remove it from declarations.sources");
  const sourceSet = new Set(paths);
  const ids = new Set<string>();
  const objects = array(declaration.objects, "objects").map((value) => {
    const item = record(value, "object");
    keys(item, ["id", "type", "scope", "labels", "aliases", "review", "public", "source", "occurrences", "properties"], "object");
    const id = identifier(item.id, namespaces);
    if (ids.has(id)) fail("duplicate semantic id");
    ids.add(id);
    const type = validateObjectType(schema, item.type);
    const properties = validateProperties(schema, "object", type, item.properties);
    const labels = record(item.labels, "labels");
    if (!Object.keys(labels).length) fail("object requires a language-labelled label");
    for (const [language, label] of Object.entries(labels)) {
      if (!/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(language)) fail("invalid label language");
      text(label, "label");
    }
    const aliases = item.aliases === undefined ? undefined : record(item.aliases, "aliases");
    if (aliases) for (const [language, values] of Object.entries(aliases)) {
      if (!/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(language)) fail("invalid alias language");
      const entries = array(values, "language aliases").map(value => text(value, "alias"));
      if (!entries.length || new Set(entries).size !== entries.length) fail("aliases must be distinct nonempty strings");
      aliases[language] = entries.sort();
    }
    const review = item.review ?? "declared";
    if (review !== "declared") fail("KG-0 only accepts author-declared status");
    if (item.public !== undefined && typeof item.public !== "boolean") fail("public eligibility must be boolean");
    const origin = source(item.source, sourceSet);
    const occurrences = array(item.occurrences ?? [], "occurrences").map((entry) => source(entry, sourceSet));
    if (new Set(occurrences.map((entry) => `${entry.path}\n${entry.anchor}`)).size !== occurrences.length) {
      fail("an object must not repeat the same path/anchor occurrence");
    }
    // The canonical source always counts as an occurrence. Authors only need
    // to list additional reuses; an explicit matching canonical entry is kept.
    if (!occurrences.some((entry) => entry.path === origin.path && entry.anchor === origin.anchor)) occurrences.unshift(origin);
    return { id, type, scope: text(item.scope, "scope"), labels, ...(aliases ? { aliases } : {}), review,
      origin: "author-declared", source: origin, occurrences, eligible: item.public === true,
      ...(Object.keys(properties).length ? { properties } : {}) };
  });
  const objectMap = new Map(objects.map((item) => [item.id, item]));
  const relations = array(declaration.relations, "relations").map((value) => {
    const item = record(value, "relation");
    keys(item, ["id", "type", "from", "to", "scope", "review", "public", "source", "properties", "weight"], "relation");
    const id = identifier(item.id, namespaces);
    if (ids.has(id)) fail("duplicate semantic/relation id");
    ids.add(id);
    const from = identifier(item.from, namespaces), to = identifier(item.to, namespaces);
    if (!objectMap.has(from) || !objectMap.has(to)) fail("relation has an unknown endpoint");
    const type = validateRelationEndpoints(schema, item.type, objectMap.get(from)!.type, objectMap.get(to)!.type);
    const properties = validateProperties(schema, "relation", type, item.properties);
    const weight = item.weight === undefined ? undefined : validateWeight(item.weight);
    const review = item.review ?? "declared";
    if (review !== "declared") fail("KG-0 only accepts author-declared relations");
    if (item.public !== undefined && typeof item.public !== "boolean") fail("public eligibility must be boolean");
    if (item.public === true && (!objectMap.get(from)!.eligible || !objectMap.get(to)!.eligible)) fail("public relation cannot expose a private endpoint");
    return { id, type, from, to, scope: text(item.scope, "scope"), review,
      origin: "author-declared", source: source(item.source, sourceSet), eligible: item.public === true,
      ...(Object.keys(properties).length ? { properties } : {}), ...(weight === undefined ? {} : { weight }) };
  });
  const dependencies: RecordValue[] = [];
  const sourceDependencies: Record<string, string[]> = {};
  const dependencyClosures = new Map<string, Set<string>>();
  const unsafeDependencies = new Set<string>();
  const explicitDependencies = new Set<string>();
  let unsafeTransforms = false;
  const hashed = new Set<string>();
  const processed = new Set<string>();
  const active = new Set<string>();
  const checkedDirectories = new Set<string>();
  const checkedMetadata = new Set<string>();
  const activeMetadata = new Set<string>();
  async function directoryMetadata(inputDirectory: string): Promise<void> {
    let directory = inputDirectory;
    while (true) {
      const interpret = directory !== "." || inputDirectory === ".";
      const context = `${directory}\n${interpret}`;
      if (!checkedDirectories.has(context)) {
        checkedDirectories.add(context);
        let selected = false;
        for (const name of ["_metadata.yml", "_metadata.yaml"]) {
          const contextPath = contextualPath(name, directory);
          try {
            await Deno.stat(await confined(root, contextPath));
            if (interpret && !selected) await metadataFile(contextPath, directory);
            else if (!hashed.has(contextPath)) {
              // Ignored suffixes/root contexts are conservatively fingerprinted
              // without interpreting YAML or following irrelevant resources.
              hashed.add(contextPath);
              dependencies.push({ path: contextPath,
                hash: await digest(await Deno.readFile(await confined(root, contextPath))), kind: "ignored-metadata" });
            }
            selected = true;
          } catch (error) { if (!(error instanceof Deno.errors.NotFound)) throw error; }
        }
      }
      if (directory === ".") break;
      const parent = dirname(directory);
      if (parent === directory) fail("cannot resolve a project-relative metadata context");
      directory = parent;
    }
  }
  function frontMatter(content: string): RecordValue {
    const normalized = content.replace(/^\uFEFF/, "");
    if (!/^---[ \t]*\r?\n/.test(normalized)) return {};
    const block = normalized.match(/^---[ \t]*\r?\n([\s\S]*?)^(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/m);
    if (!block) fail("QMD frontmatter must have a closing YAML delimiter");
    return record(parse(block[1]) ?? {}, "QMD frontmatter");
  }
  function contextualPath(value: unknown, mainDirectory: string): string {
    const path = text(value, "local dependency path").replaceAll("\\", "/");
    // A leading slash in an include means the Quarto project root, not the
    // filesystem root. All normalized references must remain project-local.
    if (path.startsWith("/") && !path.startsWith("//")) return projectPath(path.slice(1));
    // Parent-relative references are native Quarto syntax. Normalize first,
    // then enforce the same project/symlink boundary as all other inputs.
    if (/^[A-Za-z][A-Za-z\d+.-]*:/.test(path) && !isAbsolute(path)) fail("remote dependency paths are unsupported; use a project-local resource");
    return projectPath(relative(root, isAbsolute(path) ? path : resolve(root, mainDirectory, path)).replaceAll("\\", "/"));
  }
  async function metadataDependencies(metadata: RecordValue, mainDirectory: string): Promise<void> {
    const extra = metadata["knowledge-graph"]?.dependencies;
    if (extra !== undefined) {
      for (const value of array(extra, "knowledge-graph.dependencies")) {
        for (const path of await dependency(contextualPath(value, mainDirectory))) explicitDependencies.add(path);
      }
    }
    if (metadata.filters !== undefined) {
      const filters = Array.isArray(metadata.filters) ? metadata.filters : [metadata.filters];
      if (filters.some(filter => !hasFilter([filter]))) unsafeTransforms = true;
    }
    if (["reader", "writer", "template", "shortcodes"].some(key => metadata[key] !== undefined)
      || metadata.engine !== undefined && !["markdown", "none"].includes(metadata.engine)) unsafeTransforms = true;
    if (metadata.format && typeof metadata.format === "object" && !Array.isArray(metadata.format)) {
      for (const value of Object.values(metadata.format)) {
        if (value && typeof value === "object" && !Array.isArray(value)) await metadataDependencies(value as RecordValue, mainDirectory);
      }
    }
    for (const key of ["bibliography", "csl"]) {
      if (metadata[key] === undefined) continue;
      const resources = Array.isArray(metadata[key]) ? metadata[key] : [metadata[key]];
      for (const value of resources) await dependency(contextualPath(value, mainDirectory));
    }
    for (const key of ["include-in-header", "include-before-body", "include-after-body"]) {
      if (metadata[key] === undefined) continue;
      const resources = Array.isArray(metadata[key]) ? metadata[key] : [metadata[key]];
      for (const value of resources) {
        if (typeof value === "string") await dependency(contextualPath(value, mainDirectory));
        else if (value && typeof value === "object" && typeof value.file === "string") await dependency(contextualPath(value.file, mainDirectory));
      }
    }
    for (const key of ["metadata-file", "metadata-files"]) {
      if (metadata[key] === undefined) continue;
      const resources = Array.isArray(metadata[key]) ? metadata[key] : [metadata[key]];
      for (const value of resources) await metadataFile(contextualPath(value, mainDirectory), mainDirectory);
    }
  }
  async function metadataFile(path: string, mainDirectory: string): Promise<void> {
    const context = `${mainDirectory}\n${path}`;
    if (activeMetadata.has(context)) fail("metadata dependency cycle detected; remove the cyclic metadata-files reference");
    if (checkedMetadata.has(context)) return;
    activeMetadata.add(context);
    let bytes: Uint8Array;
    try { bytes = await Deno.readFile(await confined(root, path)); }
    catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
      // Quarto deliberately ignores absent optional metadata-files. Record the
      // absence so creating one later invalidates an existing frozen closure.
      if (!hashed.has(path)) {
        hashed.add(path);
        dependencies.push({ path, hash: await digest("absent-optional-metadata"), kind: "missing-metadata" });
      }
      activeMetadata.delete(context);
      checkedMetadata.add(context);
      return;
    }
    const metadata = record(parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) ?? {}, "metadata file");
    const ignored = dependencies.find(entry => entry.path === path && entry.kind === "ignored-metadata");
    if (ignored) {
      // A file ignored for a nested page may later be native metadata of a
      // root page. Its interpreted fingerprint wins independently of order.
      ignored.hash = await digest(canonical(semanticMetadata(metadata)));
      ignored.kind = "metadata";
    } else if (!hashed.has(path)) {
      hashed.add(path);
      dependencies.push({ path, hash: await digest(canonical(semanticMetadata(metadata))), kind: "metadata" });
    }
    await metadataDependencies(metadata, mainDirectory);
    activeMetadata.delete(context);
    checkedMetadata.add(context);
  }
  async function dependency(path: string, include = false, mainDirectory = dirname(path)): Promise<Set<string>> {
    path = projectPath(path);
    // The same include can resolve nested includes differently in two main
    // documents. Hash its bytes once, but evaluate each main-document context.
    const context = `${mainDirectory}\n${path}`;
    if (active.has(context)) fail("include/dependency cycle detected; no complete snapshot can be prepared");
    if (processed.has(context)) return dependencyClosures.get(context)!;
    const closure = new Set<string>([path]);
    dependencyClosures.set(context, closure);
    active.add(context);
    const bytes = await Deno.readFile(await confined(root, path));
    if (!hashed.has(path)) {
      hashed.add(path);
      dependencies.push({ path, hash: await digest(bytes), kind: sourceSet.has(path) ? "source" : include ? "include" : "resource" });
    }
    if (extname(path).toLowerCase() === ".qmd" || include) {
      const content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      // Code execution and non-include shortcodes may depend on undeclared
      // external state. Such pages always require a fresh render observation.
      if (/^\s*(?:`{3,}|~{3,})\s*\{[^}]+\}/m.test(content)
          || /\{\{<\s*(?!include\b)[A-Za-z]/.test(content)
          || /`(?:r\s+|\{(?:r|python|julia)\})/.test(content)) unsafeDependencies.add(path);
      await directoryMetadata(mainDirectory);
      if (extname(path).toLowerCase() === ".qmd" || include) {
        const metadata = frontMatter(content);
        await metadataDependencies(metadata, mainDirectory);
      }
      // Native includes are standalone shortcode lines, including those inside
      // source fences. Escaped/triple-brace literal examples do not match.
      // Nested include references resolve in the main document's directory:
      // https://quarto.org/docs/authoring/includes.html
      for (const match of content.matchAll(/^[ \t]*\{\{<[ \t]*include[ \t]+(?:"([^"\r\n]+)"|'([^'\r\n]+)'|([^\s>]+))[ \t]*>\}\}[ \t]*\r?$/gm)) {
        for (const item of await dependency(contextualPath(match[1] ?? match[2] ?? match[3], mainDirectory), true, mainDirectory)) closure.add(item);
      }
    }
    active.delete(context);
    processed.add(context);
    return closure;
  }
  for (const path of paths) sourceDependencies[path] = [...await dependency(path)].sort();
  // Quarto identifies the root, activated profiles and project metadata-files
  // that actually contributed to its effective configuration.
  for (const value of inspection.files?.config ?? []) {
    const path = relativeInput(root, value);
    await metadataFile(path, ".");
  }
  await metadataDependencies(config, ".");
  // Explicit inputs invalidate globally even if first classified as a source/include.
  for (const path of [...explicitDependencies].sort()) dependencies.push({ path: `explicit:${path}`, kind: "explicit-dependency",
    hash: dependencies.find(entry => entry.path === path)!.hash });
  const unsafeGlobal = unsafeTransforms || [...explicitDependencies].some(path => unsafeDependencies.has(path));
  const cacheUnsafeSources = paths.filter(path => unsafeGlobal || sourceDependencies[path].some(item => unsafeDependencies.has(item)));
  const collections = await sourceCollections(root, declaration.collections, dependencies);
  function semanticMetadata(value: RecordValue): RecordValue {
    const result = structuredClone(value);
    delete result["knowledge-graph"]?.mode;
    // Runtime mode chooses whether to validate/rebuild, not semantic content.
    return result;
  }
  // Native project inspection supplies effective profile/default merging. The
  // individual source bytes and every inherited/external metadata context are
  // already in the closure; inspecting every document would add a Quarto
  // subprocess per page without adding an untracked source of configuration.
  dependencies.push({ path: "quarto-runtime", hash: await digest(canonical(inspection.quarto ?? {})), kind: "runtime" });
  dependencies.push({ path: declarationPath, hash: await digest(await Deno.readFile(await confined(root, declarationPath))), kind: "declarations" });
  if (schemaPath) dependencies.push({ path: schemaPath, hash: await digest(await Deno.readFile(await confined(root, schemaPath))), kind: "schema" });
  dependencies.push({ path: "effective-project-config", hash: await digest(canonical(semanticMetadata(config))), kind: "effective-root-config" });
  const extensionRoot = dirname(fromFileUrl(import.meta.url));
  async function extensionDependencies(directory: string, prefix = ""): Promise<void> {
    for await (const entry of Deno.readDir(directory)) {
      if (entry.isSymlink) fail("extension dependency files must not be symbolic links");
      const name = `${prefix}${entry.name}`;
      if (entry.isDirectory) await extensionDependencies(join(directory, entry.name), `${name}/`);
      else if (entry.isFile) dependencies.push({ path: `extension/${name}`,
        hash: await digest(await Deno.readFile(join(directory, entry.name))), kind: "extractor" });
    }
  }
  await extensionDependencies(extensionRoot);
  dependencies.sort((a, b) => a.path === b.path ? 0 : a.path < b.path ? -1 : 1);
  return { config, mode, ai, schema, schemaPath, schemaVersion: schema.version, schemaDigest,
    inputSources, sources: paths.sort(), objects, relations,
    sourceDependencies, cacheUnsafeSources, collections, cacheEnabled: options.cache !== false, gitEnabled: options.git === true, navigation: options.navigation === true,
    authoringEnabled: options.authoring === true,
    exportOptions: parseExportOptions(options.exports),
    protectedLiterals, privateTokens: protectedLiterals, dependencies,
    dependencyDigest: await digest(canonical(dependencies)) };
}

export function observationName(source: string): string {
  return `${encodeURIComponent(source).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)}.json`;
}

export function escapeHtml(value: unknown): string {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}
