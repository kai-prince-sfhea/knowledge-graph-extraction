import { buildExports } from "./exports.ts";
import type { ExportOptions } from "./exports.ts";
import type { SchemaContract } from "./schema.ts";

type Mapping = Record<string, any>;
export type ComponentRights = { status: "unknown" } | { status: "declared"; license: string; attribution?: string };
export type PackageOptions = {
  version: 0; description: string; datePublished: string; license?: string; metadataLicense?: string;
  componentRights: Record<string, ComponentRights>;
};
export const PUBLIC_EXPORT_FILES = ["dataset.jsonld", "objects.csv", "relations.csv", "public-schema.json"] as const;
export const PACKAGE_METADATA_FILES = ["ro-crate-metadata.json", "reconstruction-manifest.json"] as const;
const PROFILE = "https://w3id.org/ro/crate/1.2";
const VOCABULARY = "https://example.org/knowledge-graph-extraction/v0#";
const UNKNOWN_RIGHTS = "Rights unknown: no reuse licence has been supplied. Obtain permission from the relevant rights holder.";
// RO-Crate 1.2 permits an embedded, relevant context subset. Keeping its
// mappings inline makes this package readable without fetching a context:
// https://www.researchobject.org/ro-crate/specification/1.2/appendix/jsonld.html
const CONTEXT = {
  "@version": 1.1, CreativeWork: "http://schema.org/CreativeWork", Dataset: "http://schema.org/Dataset",
  File: "http://schema.org/MediaObject", Thing: "http://schema.org/Thing",
  about: "http://schema.org/about", conformsTo: "http://purl.org/dc/terms/conformsTo",
  contentSize: "http://schema.org/contentSize", creator: "http://schema.org/creator", datePublished: "http://schema.org/datePublished",
  description: "http://schema.org/description", encodingFormat: "http://schema.org/encodingFormat", hasPart: "http://schema.org/hasPart",
  identifier: "http://schema.org/identifier", isBasedOn: "http://schema.org/isBasedOn", license: "http://schema.org/license",
  name: "http://schema.org/name", version: "http://schema.org/version", sha256: "http://schema.org/sha256",
  creditText: "http://schema.org/creditText", kg: VOCABULARY,
};
const MEDIA: Record<string, string> = {
  "dataset.jsonld": "application/ld+json", "objects.csv": "text/csv", "relations.csv": "text/csv",
  "public-schema.json": "application/schema+json", "reconstruction-manifest.json": "application/json",
};
function fail(message: string): never { throw new Error(`knowledge-graph-extraction: package: ${message}`); }
function mapping(value: unknown, field: string): Mapping {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${field} must be a mapping`);
  return value as Mapping;
}
function keys(value: Mapping, allowed: readonly string[], field: string): void {
  if (Object.keys(value).some(key => !allowed.includes(key))) fail(`${field} contains an unsupported field`);
}
function text(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim() || /[\u0000-\u001f]/.test(value)) fail(`${field} must be nonempty text without controls`);
  return value;
}
function http(value: unknown, field: string): string {
  const result = text(value, field);
  let url: URL;
  try { url = new URL(result); } catch { return fail(`${field} must be an absolute HTTP(S) URI`); }
  if (!/^https?:\/\//i.test(result) || !["http:", "https:"].includes(url.protocol) || !url.hostname ||
      url.username || url.password || /[\s\\]/.test(result)) fail(`${field} must be an HTTP(S) URI without credentials, whitespace or backslashes`);
  return result;
}
function date(value: unknown): string {
  const result = text(value, "date-published");
  if (!/^\d{4}-\d\d-\d\d$/.test(result) || Number.isNaN(Date.parse(`${result}T00:00:00Z`)) ||
      new Date(`${result}T00:00:00Z`).toISOString().slice(0, 10) !== result) fail("date-published must be a real YYYY-MM-DD calendar date supplied by the author");
  return result;
}
function canonical(value: any): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
async function hash(value: string): Promise<{ sha256: string; bytes: number }> {
  const bytes = new TextEncoder().encode(value);
  return { bytes: bytes.byteLength, sha256: Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), byte => byte.toString(16).padStart(2, "0")).join("") };
}
function componentRights(value: unknown): ComponentRights {
  if (value === "unknown") return { status: "unknown" };
  const input = mapping(value, "component-rights declaration");
  keys(input, ["license", "attribution"], "component-rights declaration");
  return { status: "declared", license: http(input.license, "component licence"),
    ...(input.attribution !== undefined ? { attribution: text(input.attribution, "component attribution") } : {}) };
}

/** This opt-in package records public data, never the extension's software
 * licence. Dates and rights are declarations; neither is guessed from a clock,
 * repository, creator name, licence filename or metadata found on the machine. */
export function parsePackageOptions(raw?: unknown): PackageOptions | null {
  if (raw === undefined || raw === null || raw === false) return null;
  const input = mapping(raw, "configuration");
  keys(input, ["description", "date-published", "license", "metadata-license", "component-rights"], "configuration");
  const rights = input["component-rights"] === undefined ? {} : mapping(input["component-rights"], "component-rights");
  keys(rights, PUBLIC_EXPORT_FILES, "component-rights");
  return {
    version: 0, description: text(input.description, "description"), datePublished: date(input["date-published"]),
    ...(input.license !== undefined ? { license: http(input.license, "package licence") } : {}),
    ...(input["metadata-license"] !== undefined ? { metadataLicense: http(input["metadata-license"], "metadata licence") } : {}),
    componentRights: Object.fromEntries(Object.keys(rights).sort().map(name => [name, componentRights(rights[name])])),
  };
}

/** Validate normalized public policy from a portable baseline without accepting
 * new arbitrary fields, private paths, unspecified dates or a forged status. */
export function validatePackageOptions(raw: unknown): PackageOptions {
  const input = mapping(raw, "normalized policy");
  keys(input, ["version", "description", "datePublished", "license", "metadataLicense", "componentRights"], "normalized policy");
  if (input.version !== 0) fail("unsupported normalized policy version");
  const rights = mapping(input.componentRights, "normalized component rights");
  keys(rights, PUBLIC_EXPORT_FILES, "normalized component rights");
  const original = Object.fromEntries(Object.keys(rights).map(name => {
    const item = mapping(rights[name], "normalized rights declaration");
    if (item.status === "unknown") {
      keys(item, ["status"], "unknown rights declaration");
      return [name, "unknown"];
    }
    if (item.status !== "declared") fail("unsupported rights status");
    keys(item, ["status", "license", "attribution"], "declared rights declaration");
    return [name, { license: item.license, ...(item.attribution !== undefined ? { attribution: item.attribution } : {}) }];
  }));
  return parsePackageOptions({ description: input.description, "date-published": input.datePublished,
    ...(input.license !== undefined ? { license: input.license } : {}),
    ...(input.metadataLicense !== undefined ? { "metadata-license": input.metadataLicense } : {}),
    "component-rights": original })!;
}

/** The existing DCAT distributions already carry the dataset licence. Do not
 * publish a second, contradictory per-component rights assertion for them. */
export function validatePackageExportPolicy(packageOptions: PackageOptions | null, exports: Pick<ExportOptions, "license"> | null): void {
  if (packageOptions === null) return;
  const options = validatePackageOptions(packageOptions);
  if (exports === null) fail("packaging requires explicit knowledge-graph.exports metadata");
  for (const declared of Object.values(options.componentRights)) {
    if (exports.license && (declared.status !== "declared" || declared.license !== exports.license)) {
      fail("component rights conflict with the licence declared by knowledge-graph.exports");
    }
  }
}

/** Return the base exports and, when explicitly enabled, two metadata files.
 * Calling the existing public exporter here preserves its schema allowlist;
 * callers cannot add arbitrary file bytes, source files or private graph state.
 * This function reads no files, starts no processes and makes no network calls.
 * Its embedded JSON-LD context requires no external context loader. */
export async function buildPackageExports(graph: unknown, schema: SchemaContract, exports: ExportOptions | null,
    packageOptions: PackageOptions | null = null): Promise<{ files: Record<string, string> }> {
  if (packageOptions === null) return buildExports(graph, schema, exports);
  const options = validatePackageOptions(packageOptions);
  if (exports === null) fail("packaging requires explicit knowledge-graph.exports metadata");
  validatePackageExportPolicy(options, exports);
  const base = buildExports(graph, schema, exports), files = { ...base.files };
  const dataset = JSON.parse(files["dataset.jsonld"])["@graph"].find((item: Mapping) => item["@id"] === exports.id);
  const payloadRights = (name: string): ComponentRights => {
    const declared = options.componentRights[name];
    return declared ?? (exports.license ? { status: "declared", license: exports.license } : { status: "unknown" });
  };
  const packageRights: ComponentRights = options.license ? { status: "declared", license: options.license } : { status: "unknown" };
  const metadataRights: ComponentRights = options.metadataLicense ? { status: "declared", license: options.metadataLicense } : { status: "unknown" };
  const payload = await Promise.all([...PUBLIC_EXPORT_FILES].sort().map(async name => ({
    path: name, mediaType: MEDIA[name], ...await hash(files[name]), rights: payloadRights(name),
  })));
  const manifest = {
    packageVersion: 0, kind: "knowledge-graph-public-data-package",
    dataset: { id: exports.id, title: exports.title, snapshotId: dataset["dcat:version"], status: dataset["kg:coverage"],
      contractVersion: dataset["kg:contractVersion"], extractorVersion: dataset["kg:extractorVersion"] },
    description: options.description, datePublished: options.datePublished,
    rights: { package: packageRights, metadata: metadataRights }, artifacts: payload,
    reconstruction: {
      scope: "public-export-integrity", characterEncoding: "UTF-8", hashAlgorithm: "SHA-256",
      instructions: [
        "Keep the four named payload files beside ro-crate-metadata.json and reconstruction-manifest.json.",
        "Verify each payload's exact UTF-8 bytes against its byte count and SHA-256 before reuse.",
        "Read dataset.jsonld for semantic records, objects.csv and relations.csv for tabular projections, and public-schema.json for the public contract.",
        "Read each component's rights declaration before reuse; unknown rights do not grant permission.",
      ],
      sourceDocumentsIncluded: false, privateStateIncluded: false, nativeHtmlIncluded: false,
      rerenderInputsComplete: false, semanticReconstructionFromCsvSupported: false,
      limitations: "This inventory preserves public export integrity. It cannot recreate the source website, private extraction cache or native rendered destinations. Hashes detect changes; they do not authenticate authors or grant rights. No registry deposit, preservation service or FAIR/OER certification is asserted.",
    },
  };
  const manifestName = "reconstruction-manifest.json";
  files[manifestName] = `${canonical(manifest)}\n`;
  const artifacts = [...payload, { path: manifestName, mediaType: MEDIA[manifestName], ...await hash(files[manifestName]), rights: metadataRights }];
  const licenses = [...new Set([packageRights, metadataRights, ...payload.map(item => item.rights)]
    .filter((rights): rights is Extract<ComponentRights, { status: "declared" }> => rights.status === "declared").map(rights => rights.license))].sort();
  const rightsProperties = (rights: ComponentRights): Mapping => ({
    license: rights.status === "declared" ? { "@id": rights.license } : UNKNOWN_RIGHTS,
    "kg:licenseStatus": rights.status,
    ...(rights.status === "declared" && rights.attribution ? { creditText: rights.attribution } : {}),
  });
  const creators = exports.creators.map((name, index) => ({ "@id": `#creator-${index + 1}`, "@type": "Thing", name,
    description: "Public creator name explicitly supplied by the author; person or organization type is not inferred." }));
  const metadata = {
    "@context": CONTEXT,
    "@graph": [
      { "@id": "ro-crate-metadata.json", "@type": "CreativeWork", name: "Public knowledge graph package metadata",
        about: { "@id": "./" }, conformsTo: { "@id": PROFILE }, ...rightsProperties(metadataRights) },
      { "@id": "./", "@type": "Dataset", name: exports.title, description: options.description,
        datePublished: options.datePublished, identifier: exports.id, version: dataset["dcat:version"],
        "kg:coverage": dataset["kg:coverage"], "kg:contractVersion": dataset["kg:contractVersion"],
        ...rightsProperties(packageRights), hasPart: artifacts.map(item => ({ "@id": item.path })),
        ...(creators.length ? { creator: creators.map(item => ({ "@id": item["@id"] })) } : {}),
        isBasedOn: { "@id": "dataset.jsonld" } },
      ...artifacts.map(item => ({ "@id": item.path, "@type": "File", name: item.path,
        encodingFormat: item.mediaType, contentSize: String(item.bytes), sha256: item.sha256,
        ...rightsProperties(item.rights) })),
      ...creators,
      ...licenses.map(license => ({ "@id": license, "@type": "CreativeWork", name: "Author-declared licence",
        description: `Licence URI supplied by the author: ${license}. No legal clearance is inferred.` })),
    ],
  };
  files["ro-crate-metadata.json"] = `${canonical(metadata)}\n`;
  return { files };
}
