import type { SchemaContract, PropertyRule } from "./schema.ts";

export type ExportOptions = {
  id: string; title: string; creators: string[]; license?: string; baseUrl?: string;
};
type Mapping = Record<string, any>;
const VOCABULARY = "https://example.org/knowledge-graph-extraction/v0#";
const FILES = ["dataset.jsonld", "objects.csv", "relations.csv", "public-schema.json"] as const;

function fail(message: string): never {
  throw new Error(`knowledge-graph-extraction: exports: ${message}`);
}
function mapping(value: unknown, name: string): Mapping {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${name} must be a mapping`);
  return value as Mapping;
}
function text(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim() || /[\u0000-\u001f]/.test(value)) fail(`${name} must be nonempty text without control characters`);
  return value;
}
function http(value: unknown, name: string): string {
  const result = text(value, name);
  let uri: URL;
  try { uri = new URL(result); } catch { return fail(`${name} must be an absolute HTTP(S) URI`); }
  if (!["http:", "https:"].includes(uri.protocol) || uri.username || uri.password || /\s/.test(result)) {
    fail(`${name} must be an absolute HTTP(S) URI without credentials or whitespace`);
  }
  return result;
}
function sorted<T>(values: T[], key: (value: T) => string): T[] {
  return [...values].sort((left, right) => key(left) < key(right) ? -1 : key(left) > key(right) ? 1 : 0);
}
function canonical(value: any): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Exports are opt-in; an explicit identity is required before metadata exists. */
export function parseExportOptions(raw?: unknown): ExportOptions | null {
  if (raw === undefined || raw === null || raw === false) return null;
  const value = mapping(raw, "configuration");
  const allowed = ["id", "license", "creators", "title", "base-url"];
  if (Object.keys(value).some(key => !allowed.includes(key))) fail("configuration contains an unsupported field");
  const id = http(value.id, "dataset id");
  const title = value.title === undefined ? "Public knowledge graph" : text(value.title, "title");
  if (value.creators !== undefined && !Array.isArray(value.creators)) fail("creators must be a sequence of explicitly publishable names");
  const creators = (value.creators ?? []).map((name: unknown) => text(name, "creator"));
  if (new Set(creators).size !== creators.length) fail("creators contains duplicate names");
  const options: ExportOptions = { id, title, creators: creators.sort() };
  if (value.license !== undefined) options.license = http(value.license, "license");
  if (value["base-url"] !== undefined) {
    const base = new URL(http(value["base-url"], "base-url"));
    if (base.search || base.hash) fail("base-url must identify the published website root without a query or fragment");
    if (!base.pathname.endsWith("/")) base.pathname += "/";
    options.baseUrl = base.href;
  }
  return options;
}

function minted(options: ExportOptions, suffix: string): string {
  return `${options.id}${options.id.includes("#") ? "-" : "#"}${suffix}`;
}
function schemaIdentity(options: ExportOptions): string {
  // JSON Schema 2020-12 forbids non-empty fragments in $id. Preserve the
  // dataset's original fragment as a query value so distinct dataset
  // identities still produce distinct schema identities.
  const identity = new URL(options.id), fragment = identity.hash.slice(1);
  identity.hash = "";
  identity.searchParams.set("kg-schema", "public-graph-v0");
  if (fragment) identity.searchParams.set("kg-dataset-fragment", fragment);
  return identity.href;
}
function publicProperties(schema: SchemaContract, kind: "object" | "relation", record: Mapping): Mapping {
  const types = kind === "object" ? schema.objectTypes : schema.relationTypes;
  const rule = types[record.type];
  if (!rule) fail(`unknown ${kind} type`);
  const raw = record.properties === undefined ? {} : mapping(record.properties, "public properties");
  const result: Mapping = {};
  for (const field of [...rule.publicFields].sort()) {
    const property = rule.properties[field];
    if (!property) fail("public field has no selected schema rule");
    if (!Object.hasOwn(raw, field)) {
      if (property.required) fail("required public property is missing");
      continue;
    }
    const value = raw[field];
    if (typeof value !== property.type || (typeof value === "number" && !Number.isFinite(value)) ||
      (typeof value === "string" && value.includes("\u0000"))) fail("public property has an invalid scalar value");
    if (property.enum && !property.enum.includes(value)) fail("public property is outside its selected enum");
    if (typeof value === "number" && ((property.minimum !== undefined && value < property.minimum) ||
      (property.maximum !== undefined && value > property.maximum))) fail("public property is outside its numeric bounds");
    result[field] = value;
  }
  return result;
}
function publicSource(raw: unknown): Mapping {
  const source = mapping(raw, "public source");
  const path = text(source.path, "source path");
  if (path.startsWith("/") || path.includes("\\") || path.includes(":") ||
    path.split("/").some(part => !part || part === "." || part === "..")) fail("public source path must stay within the project");
  const anchor = text(source.anchor, "source anchor");
  if (/[\s"'<>]/.test(anchor)) fail("source anchor is unsupported");
  if (!["document", "anchor", "span"].includes(source.precision)) fail("source precision is unsupported");
  return { path, anchor, precision: source.precision };
}
function publicRecord(schema: SchemaContract, kind: "object" | "relation", raw: unknown): Mapping {
  const input = mapping(raw, "public record");
  if (input.public === false || input.eligible === false) fail("an explicitly ineligible record cannot be exported");
  const id = http(input.id, "semantic id");
  const type = text(input.type, "record type");
  const scope = text(input.scope, "record scope");
  if (input.review !== "declared" || input.origin !== "author-declared") fail("unsupported review/origin status in the v0 export");
  const output: Mapping = { id, type, scope, review: input.review, origin: input.origin,
    source: publicSource(input.source), properties: publicProperties(schema, kind, input) };
  if (kind === "object") {
    const labels = mapping(input.labels, "labels");
    if (!Object.keys(labels).length) fail("public object needs at least one language-labelled label");
    output.labels = {};
    for (const language of Object.keys(labels).sort()) {
      if (!/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(language)) fail("label language is unsupported");
      output.labels[language] = text(labels[language], "label");
    }
    if (input.aliases !== undefined) {
      const aliases = mapping(input.aliases, "aliases");
      if (!Object.keys(aliases).length) fail("aliases must contain at least one language");
      output.aliases = {};
      for (const language of Object.keys(aliases).sort()) {
        if (!/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(language)) fail("alias language is unsupported");
        if (!Array.isArray(aliases[language]) || !aliases[language].length) fail("language aliases must be a nonempty sequence");
        const values = aliases[language].map((alias: unknown) => text(alias, "alias"));
        if (new Set(values).size !== values.length) fail("language aliases must be distinct");
        output.aliases[language] = values.sort();
      }
    }
  } else {
    output.from = http(input.from, "relation from");
    output.to = http(input.to, "relation to");
    if (input.weight !== undefined) {
      if (typeof input.weight !== "number" || !Number.isFinite(input.weight) || input.weight < 0) fail("relation weight must be finite and nonnegative");
      output.weight = input.weight;
    }
  }
  return output;
}
function publishedUrl(options: ExportOptions, destination: string): string | undefined {
  if (!options.baseUrl) return undefined;
  if (!destination || destination.startsWith("/") || destination.includes("\\") || /^[A-Za-z][A-Za-z\d+.-]*:/.test(destination)) {
    fail("published destination must be project-relative");
  }
  const base = new URL(options.baseUrl);
  const target = new URL(destination, base);
  if (target.origin !== base.origin || !target.pathname.startsWith(base.pathname) || target.search) fail("published destination escapes base-url");
  return target.href;
}
function sourceUrl(graph: Mapping, record: Mapping, options: ExportOptions): string | undefined {
  if (!options.baseUrl) return undefined;
  const occurrences = Array.isArray(graph.occurrences) ? graph.occurrences : [];
  const matching = occurrences.filter((occurrence: Mapping) => occurrence.source?.path === record.source.path &&
    occurrence.source?.anchor === record.source.anchor && typeof occurrence.destination === "string");
  const destinations = [...new Set(matching.map((occurrence: Mapping) => occurrence.destination))];
  if (destinations.length > 1) fail("source has ambiguous rendered destinations");
  return destinations.length === 1 ? publishedUrl(options, destinations[0] as string) : undefined;
}
function sourceEntity(graph: Mapping, record: Mapping, options: ExportOptions): Mapping {
  const url = sourceUrl(graph, record, options);
  return { ...(url ? { "@id": url } : {}), "@type": "prov:Entity",
    "kg:anchor": record.source.anchor, "kg:precision": record.source.precision };
}
function csvCell(value: unknown): string {
  let result = value === undefined ? "" : String(value);
  // Quote escaping handles structure. An apostrophe separately neutralizes
  // common spreadsheet formula triggers, including whitespace-prefixed forms.
  if (/^[\t\r\n]|^[\s\uFEFF]*[=+\-@]/u.test(result)) result = `'${result}`;
  return `"${result.replaceAll('"', '""')}"`;
}
function csv(rows: unknown[][]): string { return `${rows.map(row => row.map(csvCell).join(",")).join("\r\n")}\r\n`; }

function propertySchema(rule: PropertyRule): Mapping {
  return { type: rule.type, ...(rule.enum ? { enum: [...rule.enum] } : {}),
    ...(rule.minimum !== undefined ? { minimum: rule.minimum } : {}),
    ...(rule.maximum !== undefined ? { maximum: rule.maximum } : {}) };
}
function recordSchemas(schema: SchemaContract, kind: "object" | "relation"): Mapping[] {
  const types = kind === "object" ? schema.objectTypes : schema.relationTypes;
  return Object.keys(types).sort().map(type => {
    const rule = types[type];
    const publicRules = Object.fromEntries([...rule.publicFields].sort().map(field => [field, propertySchema(rule.properties[field])]));
    const publicRequired = rule.publicFields.filter(field => rule.properties[field].required).sort();
    const properties: Mapping = {
      id: { $ref: "#/$defs/httpIdentifier" }, type: { const: type }, scope: { type: "string", minLength: 1 },
      review: { const: "declared" }, origin: { const: "author-declared" }, source: { $ref: "#/$defs/source" },
      properties: { type: "object", additionalProperties: false, properties: publicRules,
        ...(publicRequired.length ? { required: publicRequired } : {}) },
    };
    if (kind === "object") {
      properties.labels = { $ref: "#/$defs/labels" };
      properties.aliases = { $ref: "#/$defs/aliases" };
    }
    else {
      properties.from = { $ref: "#/$defs/httpIdentifier" };
      properties.to = { $ref: "#/$defs/httpIdentifier" };
      properties.weight = { type: "number", minimum: 0 };
    }
    const required = ["id", "type", "scope", "review", "origin", "source",
      ...(kind === "object" ? ["labels"] : ["from", "to"]), ...(publicRequired.length ? ["properties"] : [])];
    return { type: "object", additionalProperties: false, properties, required,
      ...(kind === "relation" ? { "x-kg-endpoint-types": { from: (rule as any).from, to: (rule as any).to } } : {}) };
  });
}
function publicSchema(schema: SchemaContract, options: ExportOptions): Mapping {
  const objectAlternatives = recordSchemas(schema, "object"), relationAlternatives = recordSchemas(schema, "relation");
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema", $id: schemaIdentity(options),
    title: "Public knowledge graph contract v0", type: "object", additionalProperties: false,
    required: ["contractVersion", "extractorVersion", "snapshotId", "status", "scope", "objects", "relations", "occurrences"],
    properties: {
      contractVersion: { const: 0 }, extractorVersion: { type: "string", minLength: 1 },
      schema: { type: "object", additionalProperties: false, required: ["version", "digest"],
        properties: { version: { const: 0 }, digest: { type: "string", pattern: "^[a-f0-9]{64}$" } } },
      publication: { type: "object", additionalProperties: false, properties: {
        navigation: { type: "boolean" }, runtimeDigest: { type: "string", pattern: "^[a-f0-9]{64}$" },
        exports: { type: "object", additionalProperties: false, required: ["id", "title", "creators"], properties: {
          id: { $ref: "#/$defs/httpIdentifier" }, title: { type: "string", minLength: 1 },
          creators: { type: "array", items: { type: "string", minLength: 1 }, uniqueItems: true },
          license: { $ref: "#/$defs/httpIdentifier" }, baseUrl: { $ref: "#/$defs/httpIdentifier" },
        } },
      } },
      snapshotId: { type: "string", pattern: "^[a-f0-9]{64}$" }, status: { enum: ["complete", "incomplete"] },
      scope: { type: "object", additionalProperties: false, required: ["sources", "renderedSources", "skippedSources"],
        properties: {
          sources: { type: "array", items: { type: "string" }, uniqueItems: true },
          renderedSources: { type: "array", items: { type: "string" }, uniqueItems: true },
          skippedSources: { type: "array", items: { type: "object", additionalProperties: false, required: ["path", "reason"],
            properties: { path: { type: "string" }, reason: { enum: ["disabled", "unsupported-format"] } } } },
        } },
      objects: { type: "array", items: { oneOf: objectAlternatives } },
      relations: { type: "array", items: relationAlternatives.length ? { oneOf: relationAlternatives } : false },
      occurrences: { type: "array", items: { type: "object", additionalProperties: false,
        required: ["id", "target", "source", "destination"], properties: {
          id: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" }, target: { $ref: "#/$defs/httpIdentifier" },
          source: { $ref: "#/$defs/source" }, destination: { type: "string", minLength: 1 },
        } } },
    },
    $defs: {
      httpIdentifier: { type: "string", format: "uri", pattern: "^[Hh][Tt][Tt][Pp][Ss]?://[^\\s]+$" },
      labels: { type: "object", minProperties: 1, additionalProperties: false,
        patternProperties: { "^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$": { type: "string", minLength: 1 } } },
      aliases: { type: "object", minProperties: 1, additionalProperties: false,
        patternProperties: { "^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$": {
          type: "array", minItems: 1, uniqueItems: true, items: { type: "string", minLength: 1 },
        } } },
      source: { type: "object", additionalProperties: false, required: ["path", "anchor", "precision"], properties: {
        path: { type: "string", minLength: 1 }, anchor: { type: "string", minLength: 1 },
        precision: { enum: ["document", "anchor", "span"] },
      } },
    },
    $comment: "Only public property constraints are included. Endpoint foreign keys/types, publication eligibility, URI safety and rendered destinations require application validation; x-kg-endpoint-types is an annotation.",
  };
}

/** Input is the already validated public snapshot; defense-in-depth allowlists
 * prevent unrelated graph/debug fields and private schema properties escaping.
 * This pure function reads no files and performs no network operations. */
export function buildExports(graphValue: unknown, schema: SchemaContract, options: ExportOptions | null): { files: Record<string, string> } {
  if (options === null) return { files: {} };
  const graph = mapping(graphValue, "public graph");
  if (graph.contractVersion !== 0 || !["complete", "incomplete"].includes(graph.status) ||
    typeof graph.snapshotId !== "string" || !/^[a-f0-9]{64}$/.test(graph.snapshotId)) fail("unsupported public snapshot envelope");
  if (!Array.isArray(graph.objects) || !Array.isArray(graph.relations)) fail("public graph needs object/relation arrays");
  const objects = sorted(graph.objects.map((value: unknown) => publicRecord(schema, "object", value)), value => value.id);
  const relations = sorted(graph.relations.map((value: unknown) => publicRecord(schema, "relation", value)), value => value.id);
  const byId = new Map(objects.map(object => [object.id, object]));
  const semanticIds = [...objects, ...relations].map(record => record.id);
  if (new Set(semanticIds).size !== semanticIds.length || semanticIds.includes(options.id)) fail("dataset/semantic identities conflict");
  for (const relation of relations) {
    const from = byId.get(relation.from), to = byId.get(relation.to);
    const rule = schema.relationTypes[relation.type];
    if (!from || !to || (!rule.from.includes("*") && !rule.from.includes(from.type)) ||
      (!rule.to.includes("*") && !rule.to.includes(to.type))) fail("relation endpoints are outside the validated public vocabulary");
  }
  const recordNode = (record: Mapping, kind: "Object" | "Relation"): Mapping => ({
    "@id": record.id, "@type": ["prov:Entity", `kg:${kind}`], "kg:recordType": record.type,
    "kg:scope": record.scope, "kg:review": record.review, "kg:origin": record.origin,
    "prov:wasDerivedFrom": sourceEntity(graph, record, options),
    ...(kind === "Object" ? { "rdfs:label": Object.entries(record.labels).map(([language, label]) => ({ "@value": label, "@language": language })),
      ...(record.aliases ? { "skos:altLabel": Object.entries(record.aliases).flatMap(([language, aliases]) =>
        (aliases as string[]).map(alias => ({ "@value": alias, "@language": language }))) } : {}) }
      : { "kg:from": { "@id": record.from }, "kg:to": { "@id": record.to },
        ...(record.weight !== undefined ? { "kg:weight": record.weight } : {}) }),
    ...(Object.keys(record.properties).length ? { "kg:properties": Object.entries(record.properties).map(([name, value]) => ({ "kg:name": name, "rdf:value": value })) } : {}),
  });
  const media: Record<string, string> = { "graph.json": "application/json", "dataset.jsonld": "application/ld+json",
    "objects.csv": "text/csv", "relations.csv": "text/csv", "public-schema.json": "application/schema+json" };
  const distributions = Object.keys(media).sort().map(name => {
    const url = publishedUrl(options, `knowledge-graph/generations/${graph.snapshotId}/${name}`);
    return { "@id": minted(options, `distribution-${name}`), "@type": "dcat:Distribution",
      "dcterms:title": name, "dcat:mediaType": { "@id": `https://www.iana.org/assignments/media-types/${media[name]}` },
      ...(url ? { "dcat:downloadURL": { "@id": url } } : {}),
      ...(options.license ? { "dcterms:license": { "@id": options.license } } : {}),
    };
  });
  const dataset = {
    "@id": options.id, "@type": ["dcat:Dataset", "prov:Entity"], "dcterms:title": options.title,
    "dcterms:identifier": options.id, "dcat:version": graph.snapshotId, "kg:coverage": graph.status,
    "kg:contractVersion": 0, "kg:extractorVersion": text(graph.extractorVersion, "extractor version"),
    "kg:licenseStatus": options.license ? "declared" : "unknown",
    ...(options.license ? { "dcterms:license": { "@id": options.license } } : {}),
    ...(options.creators.length ? { "dcterms:creator": options.creators.map(name => ({ "@type": "prov:Agent", "rdfs:label": name })) } : {}),
    "dcterms:conformsTo": { "@id": schemaIdentity(options) },
    "dcterms:hasPart": semanticIds.sort().map(id => ({ "@id": id })), "dcat:distribution": distributions,
  };
  const jsonld = { "@context": { "@version": 1.1, dcat: "http://www.w3.org/ns/dcat#",
    dcterms: "http://purl.org/dc/terms/", prov: "http://www.w3.org/ns/prov#", rdfs: "http://www.w3.org/2000/01/rdf-schema#",
    rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#", skos: "http://www.w3.org/2004/02/skos/core#", kg: VOCABULARY },
    "@graph": [dataset, ...objects.map(object => recordNode(object, "Object")), ...relations.map(relation => recordNode(relation, "Relation"))] };
  const objectRows: unknown[][] = [["id", "type", "scope", "language", "label", "review", "origin", "source_anchor", "source_precision", "source_url", "aliases_json", "properties_json"]];
  for (const object of objects) for (const [language, label] of Object.entries(object.labels)) {
    objectRows.push([object.id, object.type, object.scope, language, label, object.review, object.origin,
      object.source.anchor, object.source.precision, sourceUrl(graph, object, options), canonical(object.aliases ?? {}), canonical(object.properties)]);
  }
  const relationRows: unknown[][] = [["id", "type", "from", "to", "scope", "review", "origin", "weight", "source_anchor", "source_precision", "source_url", "properties_json"]];
  for (const relation of relations) relationRows.push([relation.id, relation.type, relation.from, relation.to,
    relation.scope, relation.review, relation.origin, relation.weight, relation.source.anchor,
    relation.source.precision, sourceUrl(graph, relation, options), canonical(relation.properties)]);
  return { files: Object.fromEntries([
    [FILES[0], `${canonical(jsonld)}\n`], [FILES[1], csv(objectRows)], [FILES[2], csv(relationRows)],
    [FILES[3], `${canonical(publicSchema(schema, options))}\n`],
  ]) };
}
