// Declarative ontology rules. This module deliberately has no code-loading API.
export type Scalar = string | number | boolean;
export type PropertyRule = { type: "string" | "number" | "boolean"; required: boolean; enum?: Scalar[]; minimum?: number; maximum?: number };
export type ObjectRule = { properties: Record<string, PropertyRule>; publicFields: string[]; description?: string };
export type RelationRule = ObjectRule & { from: string[]; to: string[] };
export type SchemaContract = { version: 0; objectTypes: Record<string, ObjectRule>; relationTypes: Record<string, RelationRule> };
type Mapping = Record<string, unknown>;

function fail(message: string): never {
  throw new Error(`knowledge-graph-extraction: ${message}`);
}
function mapping(value: unknown, name: string): Mapping {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${name} must be a mapping`);
  return value as Mapping;
}
function keys(value: Mapping, allowed: string[], name: string): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`${name} contains an unsupported field; use the documented schema fields`);
}
function name(value: string, context: string): string {
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(value) || ["__proto__", "constructor", "prototype"].includes(value)) {
    fail(`${context} needs a case-sensitive identifier containing letters, digits, '_' or '-'`);
  }
  return value;
}
function description(value: unknown, context: string): string {
  if (typeof value !== "string" || !value.trim() || value.includes("\u0000")) fail(`${context} must be nonempty text`);
  return value;
}
function scalar(value: unknown, type: PropertyRule["type"], context: string): Scalar {
  if (typeof value !== type || (typeof value === "number" && !Number.isFinite(value)) ||
      (typeof value === "string" && value.includes("\u0000"))) fail(`${context} must be a finite ${type} value`);
  return value as Scalar;
}
const reservedProperties = ["id", "type", "scope", "labels", "aliases", "review", "public", "source", "occurrences",
  "origin", "eligible", "properties", "from", "to", "weight"];
function properties(value: unknown, context: string): Record<string, PropertyRule> {
  const result: Record<string, PropertyRule> = {};
  let ordinal = 0;
  for (const [key, raw] of Object.entries(mapping(value === undefined ? {} : value, `${context}.properties`))) {
    const field = `${context}.properties entry ${++ordinal}`;
    name(key, "property name");
    if (reservedProperties.includes(key)) fail(`${field} is reserved by the identity/provenance contract`);
    const rule = mapping(raw, field);
    keys(rule, ["type", "required", "enum", "minimum", "maximum"], field);
    if (!["string", "number", "boolean"].includes(rule.type as string)) fail(`${field} has an unsupported scalar type`);
    if (rule.required !== undefined && typeof rule.required !== "boolean") fail(`${field}.required must be boolean`);
    const parsed: PropertyRule = { type: rule.type as PropertyRule["type"], required: rule.required === true };
    for (const bound of ["minimum", "maximum"] as const) {
      if (rule[bound] !== undefined) {
        if (parsed.type !== "number" || typeof rule[bound] !== "number" || !Number.isFinite(rule[bound])) {
          fail(`${field}.${bound} requires a finite number constraint on a number property`);
        }
        parsed[bound] = rule[bound];
      }
    }
    if (parsed.minimum !== undefined && parsed.maximum !== undefined && parsed.minimum > parsed.maximum) {
      fail(`${field} has minimum greater than maximum`);
    }
    if (rule.enum !== undefined) {
      if (!Array.isArray(rule.enum) || !rule.enum.length) fail(`${field}.enum must be a nonempty sequence`);
      parsed.enum = rule.enum.map(value => scalar(value, parsed.type, `${field}.enum`));
      if (new Set(parsed.enum.map(value => JSON.stringify(value))).size !== parsed.enum.length) fail(`${field}.enum contains duplicates`);
      if (parsed.enum.some(value => typeof value === "number" &&
        ((parsed.minimum !== undefined && value < parsed.minimum) || (parsed.maximum !== undefined && value > parsed.maximum)))) {
        fail(`${field}.enum exceeds its numeric bounds`);
      }
      parsed.enum.sort((a, b) => JSON.stringify(a) < JSON.stringify(b) ? -1 : JSON.stringify(a) > JSON.stringify(b) ? 1 : 0);
    }
    result[key] = parsed;
  }
  return result;
}
function publicFields(value: unknown, rules: Record<string, PropertyRule>, context: string): string[] {
  if (!Array.isArray(value) || value.some(field => typeof field !== "string")) fail(`${context}.public-fields must be a sequence of property names`);
  if (new Set(value).size !== value.length) fail(`${context}.public-fields contains duplicates`);
  for (const field of value) if (!Object.hasOwn(rules, field)) fail(`${context}.public-fields names an undeclared property; declare it first`);
  return [...value].sort();
}
function objectRule(raw: unknown, context: string, base?: ObjectRule, relation = false): ObjectRule {
  const rule = mapping(raw, context);
  keys(rule, ["properties", "public-fields", "description", ...(relation ? ["from", "to"] : [])], context);
  const additions = properties(rule.properties, context);
  const merged = { ...base?.properties, ...additions };
  for (const key of Object.keys(additions)) {
    if (base && Object.hasOwn(base.properties, key) && JSON.stringify(base.properties[key]) !== JSON.stringify(additions[key])) {
      fail(`${context} cannot change inherited property rules; select a new schema/type and migrate explicitly`);
    }
  }
  const result: ObjectRule = { properties: merged,
    publicFields: rule["public-fields"] === undefined ? [...base?.publicFields ?? []] : publicFields(rule["public-fields"], merged, context) };
  if (rule.description !== undefined) result.description = description(rule.description, `${context}.description`);
  else if (base?.description !== undefined) result.description = base.description;
  return result;
}
function endpoints(raw: unknown, objectTypes: Record<string, ObjectRule>, context: string): string[] {
  if (!Array.isArray(raw) || !raw.length || raw.some(value => typeof value !== "string")) fail(`${context} must be a nonempty sequence of object types`);
  if (new Set(raw).size !== raw.length) fail(`${context} contains duplicate object types`);
  if (raw.includes("*")) {
    if (raw.length !== 1) fail(`${context}: '*' must be the only endpoint type`);
    return ["*"];
  }
  for (const type of raw) if (!Object.hasOwn(objectTypes, type)) fail(`${context} refers to an unknown object type; declare each endpoint type first`);
  return [...raw].sort();
}

/** A fresh default contract preserves the existing declared relation semantics. */
export function defaultSchema(): SchemaContract {
  return { version: 0, objectTypes: { concept: { properties: {}, publicFields: [] }, assertion: { properties: {}, publicFields: [] } },
    relationTypes: {
      defines: { from: ["assertion"], to: ["concept"], properties: {}, publicFields: [] },
      references: { from: ["*"], to: ["*"], properties: {}, publicFields: [] },
      requires: { from: ["*"], to: ["concept"],
        properties: { "prerequisite-group": { type: "string", required: false } }, publicFields: ["prerequisite-group"] },
    } };
}

/** Compile data-only v0 rules. There are no external imports or executable rules. */
export function parseSchema(value?: unknown): SchemaContract {
  if (value === undefined) return defaultSchema();
  const input = mapping(value, "schema");
  keys(input, ["version", "extends", "object-types", "relation-types"], "schema");
  if (input.version !== 0) fail("only schema version 0 is supported");
  if (input.extends !== undefined && input.extends !== "default") fail("schema.extends only supports 'default'; external or executable inheritance is unsupported");
  const result: SchemaContract = input.extends === "default" ? defaultSchema() : { version: 0, objectTypes: {}, relationTypes: {} };
  const objectTypes = mapping(input["object-types"] === undefined && input.extends === "default" ? {} : input["object-types"], "schema.object-types");
  let objectOrdinal = 0;
  for (const [type, raw] of Object.entries(objectTypes)) {
    name(type, "object type");
    result.objectTypes[type] = objectRule(raw, `schema.object-types entry ${++objectOrdinal}`, Object.hasOwn(result.objectTypes, type) ? result.objectTypes[type] : undefined);
  }
  if (!Object.keys(result.objectTypes).length) fail("schema needs at least one object type");
  const relations = mapping(input["relation-types"] === undefined && input.extends === "default" ? {} : input["relation-types"], "schema.relation-types");
  const builtins = defaultSchema().relationTypes;
  let relationOrdinal = 0;
  for (const [type, raw] of Object.entries(relations)) {
    const field = `schema.relation-types entry ${++relationOrdinal}`;
    name(type, "relation type");
    const inputRule = mapping(raw, field);
    const inherited = Object.hasOwn(result.relationTypes, type) ? result.relationTypes[type] : undefined;
    const from = endpoints(inputRule.from === undefined ? inherited?.from : inputRule.from, result.objectTypes, `${field}.from`);
    const to = endpoints(inputRule.to === undefined ? inherited?.to : inputRule.to, result.objectTypes, `${field}.to`);
    const fixed = Object.hasOwn(builtins, type) ? builtins[type] : undefined;
    if (fixed && (JSON.stringify(from) !== JSON.stringify(fixed.from) || JSON.stringify(to) !== JSON.stringify(fixed.to))) {
      fail(`${field} cannot change built-in endpoint meanings; choose a new relation name and migrate explicitly`);
    }
    result.relationTypes[type] = { ...objectRule(raw, field, inherited, true), from, to };
  }
  // Also validate inherited endpoints after the complete object vocabulary exists.
  for (const rule of Object.values(result.relationTypes)) {
    endpoints(rule.from, result.objectTypes, 'selected relation.from');
    endpoints(rule.to, result.objectTypes, 'selected relation.to');
  }
  return result;
}

export function validateObjectType(schema: SchemaContract, type: unknown): string {
  if (typeof type !== "string" || !Object.hasOwn(schema.objectTypes, type)) fail('unsupported object type in selected schema; select a declared object type');
  return type;
}
export function validateRelationEndpoints(schema: SchemaContract, type: unknown, fromType: unknown, toType: unknown): string {
  if (typeof type !== "string" || !Object.hasOwn(schema.relationTypes, type)) fail('unsupported relation type in selected schema; select a declared relation type');
  const from = validateObjectType(schema, fromType), to = validateObjectType(schema, toType);
  const rule = schema.relationTypes[type];
  if (!(rule.from.includes("*") || rule.from.includes(from)) || !(rule.to.includes("*") || rule.to.includes(to))) {
    fail('selected relation requires permitted endpoints; match its declared from/to type rules');
  }
  return type;
}
export function validateProperties(schema: SchemaContract, kind: "object" | "relation", type: string, value?: unknown): Record<string, Scalar> {
  const rules = kind === "object" ? schema.objectTypes : schema.relationTypes;
  if (!Object.hasOwn(rules, type)) fail(`unsupported ${kind} type in selected schema; select a declared type`);
  const input = mapping(value === undefined ? {} : value, `${kind}.properties`);
  const result: Record<string, Scalar> = {};
  for (const key of Object.keys(input)) if (!Object.hasOwn(rules[type].properties, key)) fail(`${kind} has an unknown property; use its declared property rules`);
  let ordinal = 0;
  for (const [key, rule] of Object.entries(rules[type].properties)) {
    const field = `${kind}.properties rule ${++ordinal}`;
    if (!Object.hasOwn(input, key)) {
      if (rule.required) fail(`${field} requires property presence; supply its declared value`);
      continue;
    }
    const parsed = scalar(input[key], rule.type, field);
    if (rule.enum && !rule.enum.includes(parsed)) fail(`${field} is outside its declared enum`);
    if (typeof parsed === "number" && ((rule.minimum !== undefined && parsed < rule.minimum) ||
      (rule.maximum !== undefined && parsed > rule.maximum))) fail(`${field} is outside its numeric bounds`);
    result[key] = parsed;
  }
  return result;
}
export function validateWeight(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) fail("relation weight must be a finite nonnegative number");
  return value;
}

/** Explicit publication allowlist; caller still applies observed source coverage. */
export function publicRecord(schema: SchemaContract, kind: "object" | "relation", value: Record<string, any>): Record<string, unknown> {
  if (value.eligible !== true) fail(`cannot project an ineligible ${kind}`);
  const type = String(value.type);
  const rule = (kind === "object" ? schema.objectTypes : schema.relationTypes)[type];
  if (!rule) fail(`unsupported ${kind} type in selected schema; select a declared type`);
  const values = validateProperties(schema, kind, type, value.properties);
  if (kind === "relation" && type === "requires" && typeof values["prerequisite-group"] === "string" &&
    values["prerequisite-group"].length > 0 && !rule.publicFields.includes("prerequisite-group")) {
    fail("public requires relation cannot hide a nonempty prerequisite-group; publish the group or make the relation ineligible");
  }
  const fields = kind === "object" ? ["id", "type", "scope", "labels", "review", "origin"]
    : ["id", "type", "from", "to", "scope", "review", "origin"];
  const projected = Object.fromEntries(fields.map(field => [field, value[field]]));
  if (kind === "object" && value.aliases !== undefined) projected.aliases = structuredClone(value.aliases);
  const source = mapping(value.source, "public source");
  projected.source = Object.fromEntries(["path", "anchor", "precision"].map(field => [field, source[field]]));
  if (kind === "relation" && Object.hasOwn(value, "weight")) projected.weight = validateWeight(value.weight);
  const published = Object.fromEntries(rule.publicFields.filter(field => Object.hasOwn(values, field)).map(field => [field, values[field]]));
  if (Object.keys(published).length) projected.properties = published;
  return projected;
}
