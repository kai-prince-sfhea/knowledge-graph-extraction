import { canonical, sha256 } from "./assistance.ts";
import { publicRecord, validateObjectType, validateProperties, type SchemaContract } from "./schema.ts";

type Data = Record<string, any>;
export const AUTHORING_VERSION = 0;
const LIMIT = 500;
function fail(message: string): never { throw new Error(`knowledge-graph-extraction: ${message}`); }
function mapping(value: unknown, name: string): Data {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${name} must be a mapping`);
  return value as Data;
}
function fields(value: Data, allowed: string[], name: string): void {
  if (Object.keys(value).some(key => !allowed.includes(key))) fail(`${name} contains an unsupported field`);
}
function text(value: unknown, name: string, limit = 256): string {
  if (typeof value !== "string" || !value.trim() || value.length > limit || /[\u0000-\u001f]/.test(value)) fail(`${name} needs bounded nonempty text`);
  return value;
}
function uri(value: unknown, namespaces: Data): string {
  const original = text(value, "reviewed semantic ID", 2048), split = original.indexOf(":"), prefix = original.slice(0, split);
  const id = split > 0 && Object.hasOwn(namespaces, prefix) ? `${namespaces[prefix]}${original.slice(split + 1)}` : original;
  if (id.length > 2048) fail("expanded semantic ID exceeds its length bound");
  let parsed: URL;
  try { parsed = new URL(id); } catch { fail("semantic IDs need an HTTP(S) URI or declared namespace"); }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password || /\s/.test(id)) fail("semantic IDs need an HTTP(S) URI without credentials or whitespace");
  return id;
}
function source(value: unknown, path: string, anchors: string[]): Data {
  const anchor = text(value, "authoring anchor", 512);
  if (/[\s"'<>]/.test(anchor) || !anchors.includes(anchor)) fail("authoring proposal needs an actually observed native anchor");
  return { path, anchor };
}
function labels(value: unknown): Data {
  const result = mapping(value, "reviewed labels");
  if (!Object.keys(result).length || Object.keys(result).length > 20) fail("reviewed labels need 1 to 20 language entries");
  for (const [language, label] of Object.entries(result)) {
    if (!/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(language)) fail("invalid authoring label language");
    text(label, "authoring label");
  }
  return { ...result };
}
export type AuthoringPolicy = { namespaces: Data; schema: SchemaContract; objects: Data[]; relations: Data[] };

function inventory(value: unknown, expected: string[], name: string): void {
  if (!Array.isArray(value) || value.length !== expected.length || new Set(value).size !== value.length
    || value.some(path => typeof path !== "string" || !expected.includes(path))) fail(`${name} requires a fresh complete full observation run`);
}
export function authoringObservations(observations: Data[]): Data[] {
  return observations.map(value => ({ source: value.source, anchors: value.anchors, authoring: value.authoring }))
    .sort((a, b) => a.source < b.source ? -1 : a.source > b.source ? 1 : 0);
}
/** Pure freshness gate, also exercised with a fake native CLI filesystem. */
export async function verifyAuthoringRun(project: Data, run: Data, finalized: Data, currentKeys: Data,
  actualHtml: Data, observations: Data[]): Promise<Data> {
  const sources: string[] = project.sources;
  if (!Array.isArray(sources) || !sources.length || project.authoringEnabled !== true || run.authoringEnabled !== true
    || finalized.authoringEnabled !== true) fail("enable knowledge-graph.authoring and make a fresh complete full observation run");
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(run.runId ?? "") || finalized.runId !== run.runId || run.full !== true
    || run.cacheOnly === true || finalized.cacheOnly === true || finalized.status !== "complete") fail("authoring requires a fresh complete full observation run");
  inventory(run.sources?.map((item: Data) => item.path), sources, "prepared source inventory");
  inventory(run.renderedSources, sources, "prepared source coverage");
  inventory(finalized.renderedSources, sources, "finalized source coverage");
  inventory(observations.map(item => item.source), sources, "native authoring observations");
  if (project.dependencyDigest !== run.dependencyDigest || project.dependencyDigest !== finalized.dependencyDigest
    || canonical(currentKeys) !== canonical(run.sourceKeys)) fail("authoring source/include/configuration/runtime context changed; make a fresh full render");
  inventory(Object.keys(mapping(finalized.htmlOutputs, "finalized HTML outputs")), sources, "native HTML inventory");
  if (canonical(actualHtml) !== canonical(finalized.htmlOutputs)) fail("native HTML changed after rendering; make a fresh full render");
  if (!/^[a-f0-9]{64}$/.test(finalized.snapshotId ?? "")) fail("authoring needs a finalized graph snapshot");
  for (const item of observations) {
    if (item.runId !== run.runId || item.status !== "observed" || item.sourcePrecision !== "anchor"
      || item.authoring?.complete !== true) fail("authoring needs complete fresh native observations for every selected page");
  }
  const observationDigest = await sha256(canonical(authoringObservations(observations)));
  if (!/^[a-f0-9]{64}$/.test(finalized.authoringObservationDigest ?? "") || finalized.authoringObservationDigest !== observationDigest) fail("native authoring observations changed after finalization; make a fresh full render");
  return { runId: run.runId, dependencyDigest: project.dependencyDigest, snapshotId: finalized.snapshotId,
    sources, sourceKeys: currentKeys, htmlOutputs: actualHtml, observationDigest };
}

/** Context is verified by the native CLI; it contains hashes, not source spans. */
export async function contextIdentity(context: Data): Promise<string> {
  const { runId: _runId, ...stable } = context;
  return await sha256(canonical(stable));
}

/** Native observations suggest declarations; they never become authority. */
export async function createProposals(context: Data, observations: Data[], policy: AuthoringPolicy): Promise<Data> {
  if (context.observationDigest !== await sha256(canonical(authoringObservations(observations)))) fail("authoring observations do not match their current native context");
  const existing = new Map(policy.objects.map(item => [item.id, item]));
  const occupied = new Set([...existing.keys(), ...policy.relations.map(item => item.id)]);
  const candidates: Data[] = [], diagnostics: Data[] = [], seen = new Set<string>();
  for (const observation of observations) {
    const observed = mapping(observation, "authoring observation"), path = text(observed.source, "authoring containing page", 2048);
    const data = mapping(observed.authoring, "private authoring observation");
    fields(data, ["version", "complete", "annotations", "terms", "diagnostics"], "private authoring observation");
    if (data.version !== 0 || data.complete !== true || !Array.isArray(data.annotations) || !Array.isArray(data.terms)
      || !Array.isArray(data.diagnostics) || data.annotations.length + data.terms.length > LIMIT) fail("authoring observation is incomplete or exceeds its candidate bound; narrow the document");
    if (!Array.isArray(observed.anchors)) fail("authoring observation needs native anchors");
    for (const diagnostic of data.diagnostics) {
      if (diagnostics.length >= LIMIT) fail("too many authoring diagnostics; narrow the document");
      diagnostics.push({ source: path, code: text(diagnostic.code, "authoring diagnostic", 80) });
    }
    for (const [method, entries] of [["annotation", data.annotations], ["italic-definition", data.terms]] as const) {
      for (const raw of entries) {
        const item = mapping(raw, "native authoring candidate");
        fields(item, method === "annotation" ? ["anchor", "id", "type", "scope", "language", "label"] : ["anchor", "label", "language", "scope"], "native authoring candidate");
        const reference = source(item.anchor, path, observed.anchors);
        const record: Data = { source: reference };
        if (item.id !== undefined) record.id = uri(item.id, policy.namespaces);
        if (item.type !== undefined) record.type = text(item.type, "annotation type", 80);
        if (item.scope !== undefined) record.scope = text(item.scope, "annotation scope");
        if (item.label !== undefined) record.labels = labels({ [item.language ?? "en"]: item.label });
        const known = record.id ? existing.get(record.id) : undefined;
        if (record.id && occupied.has(record.id) && !known) {
          diagnostics.push({ source: path, anchor: reference.anchor, code: "id-is-existing-relation" }); continue;
        }
        if (known && ((record.type !== undefined && record.type !== known.type) || (record.scope !== undefined && record.scope !== known.scope)
          || (record.labels !== undefined && Object.entries(record.labels).some(([lang, label]) => known.labels[lang] !== label)))) {
          diagnostics.push({ source: path, anchor: reference.anchor, code: "annotation-conflicts-with-authority" }); continue;
        }
        if (known?.occurrences.some((entry: Data) => entry.path === path && entry.anchor === reference.anchor)) continue;
        const kind = known ? "occurrence" : record.id ? "object" : "term";
        const proposal = { kind, method, record, sourcePrecision: "anchor", origin: "deterministic-proposed", review: "unreviewed" };
        const candidateId = `sha256:${await sha256(canonical(proposal))}`;
        if (seen.has(candidateId)) continue;
        seen.add(candidateId); candidates.push({ ...proposal, candidateId });
        if (candidates.length > LIMIT) fail("authoring run exceeds 500 candidates; narrow the selected sources");
      }
    }
  }
  if (diagnostics.length > LIMIT) fail("too many authoring diagnostics; narrow the selected sources");
  candidates.sort((a, b) => a.candidateId < b.candidateId ? -1 : a.candidateId > b.candidateId ? 1 : 0);
  const body = { version: AUTHORING_VERSION, context, contextHash: await contextIdentity(context),
    schemaDigest: await sha256(canonical(policy.schema)), observations, candidates, diagnostics };
  return { ...body, proposalsHash: await sha256(canonical(body)) };
}

export async function validateProposals(sidecar: Data, context: Data, policy: AuthoringPolicy): Promise<void> {
  const { proposalsHash, ...body } = mapping(sidecar, "authoring proposal sidecar");
  if (sidecar.version !== AUTHORING_VERSION || proposalsHash !== await sha256(canonical(body))) fail("authoring proposal integrity mismatch");
  if (sidecar.contextHash !== await contextIdentity(context)) fail("authoring source/include/configuration/runtime/HTML context changed; make a fresh full render and discover again");
  const rebuilt = await createProposals(sidecar.context, sidecar.observations, policy);
  if (canonical(rebuilt) !== canonical(sidecar)) fail("authoring proposals differ from validated native observations");
}

/** The patch is private review material; canonical knowledge.yml is untouched. */
export async function reviewProposals(sidecar: Data, context: Data, policy: AuthoringPolicy, input: unknown,
  reviewed: boolean, reviewerValue: unknown): Promise<Data> {
  await validateProposals(sidecar, context, policy);
  if (!reviewed) fail("authoring review requires explicit --reviewed confirmation");
  const reviewer = text(reviewerValue, "reviewer"), selection = mapping(input, "authoring selections");
  fields(selection, ["version", "selections"], "authoring selections");
  if (selection.version !== 0 || !Array.isArray(selection.selections) || !selection.selections.length || selection.selections.length > LIMIT) fail("authoring review needs version 0 and 1 to 500 selections");
  const existing = new Map(policy.objects.map(item => [item.id, item])), relationIds = new Set(policy.relations.map(item => item.id));
  const created = new Map<string, Data>(), additions: Data[] = [], selected: Data[] = [], ids = new Set<string>(), occurrenceKeys = new Set<string>();
  for (const raw of selection.selections) {
    const item = mapping(raw, "authoring selection");
    fields(item, ["candidate", "id", "type", "scope", "labels", "properties", "public"], "authoring selection");
    const candidate = sidecar.candidates.find((candidate: Data) => candidate.candidateId === item.candidate);
    if (!candidate || ids.has(candidate.candidateId)) fail("select distinct existing authoring candidate IDs");
    ids.add(candidate.candidateId);
    const proposal = candidate.record, id = uri(item.id ?? proposal.id, policy.namespaces);
    if (proposal.id && id !== proposal.id) fail("an explicit annotation ID cannot be replaced during review; correct the annotation or choose another candidate");
    if (relationIds.has(id)) fail("reviewed object ID collides with an existing relation");
    if (item.public !== undefined && typeof item.public !== "boolean") fail("reviewed publication eligibility must be boolean");
    const publicValue = item.public === true, known = existing.get(id), pending = created.get(id);
    const source = proposal.source;
    const key = `${id}\n${source.path}\n${source.anchor}`;
    if (occurrenceKeys.has(key)) fail("review selections duplicate one semantic occurrence");
    occurrenceKeys.add(key);
    if (known) {
      if ((item.type !== undefined && item.type !== known.type) || (item.scope !== undefined && item.scope !== known.scope)
        || (item.labels !== undefined && canonical(labels(item.labels)) !== canonical(known.labels)) || item.properties !== undefined) fail("occurrence review cannot override canonical object fields");
      if (known.eligible && !publicValue) fail("adding an occurrence to a public object requires explicit public: true; eligibility is inherited from the canonical target");
      if (!known.eligible && publicValue) fail("occurrence review cannot change a private canonical object's publication eligibility");
      if (!known.occurrences.some((entry: Data) => entry.path === source.path && entry.anchor === source.anchor)) additions.push({ target: id, source, public: publicValue });
    } else {
      const type = validateObjectType(policy.schema, item.type ?? proposal.type ?? "concept");
      const properties = validateProperties(policy.schema, "object", type, item.properties);
      const record: Data = { id, type, scope: text(item.scope ?? proposal.scope, "reviewed scope"), labels: labels(item.labels ?? proposal.labels),
        source, review: "declared", public: publicValue, ...(Object.keys(properties).length ? { properties } : {}) };
      if (record.public) publicRecord(policy.schema, "object", { ...record, eligible: true, origin: "author-declared", source: { ...source, precision: "anchor" } });
      if (pending) {
        const { source: _recordSource, ...recordFields } = record;
        const { source: _pendingSource, occurrences: _occurrences, ...pendingFields } = pending;
        if (canonical(recordFields) !== canonical(pendingFields)) fail("selected same-ID proposals disagree; homonyms require different IDs");
        (pending.occurrences ??= []).push(source);
      } else created.set(id, record);
    }
    selected.push({ candidateId: candidate.candidateId, id, source, public: publicValue });
  }
  return { patch: { version: 0, objects: [...created.values()], relations: [], occurrenceAdditions: additions },
    review: { version: 0, proposalsHash: sidecar.proposalsHash, contextHash: sidecar.contextHash,
      reviewer, decision: "author-declared", sourcePrecision: "anchor", selections: selected } };
}

export const AUTHORING_HELP = `Knowledge Graph Extraction: private native authoring proposals
  quarto run _extensions/knowledge-graph-extraction/author.ts discover [--output PRIVATE_JSON]
  quarto run _extensions/knowledge-graph-extraction/author.ts review --proposals PRIVATE_JSON --selections PRIVATE_YML --reviewed --reviewer NAME [--output PRIVATE_YML]
Enable knowledge-graph.authoring: true and make a complete full HTML render first.
All review files stay under .quarto/knowledge-graph/. No model or network is used.
Review writes a separate patch and receipt. Canonical knowledge.yml is unchanged.`;
export function authoringPrivatePath(value: unknown): string {
  const path = text(value, "private authoring path", 2048).replaceAll("\\", "/");
  if (!path.startsWith(".quarto/knowledge-graph/") || path.includes(":")
    || path.split("/").some(part => !part || part === "." || part === "..")) fail("authoring files must stay under private .quarto/knowledge-graph/");
  return path;
}
export type AuthoringHost = {
  snapshot(): Promise<{ context: Data; observations: Data[]; policy: AuthoringPolicy }>;
  readJson(path: string): Promise<Data>;
  readSelections(path: string): Promise<unknown>;
  writeProposals(path: string, value: Data): Promise<void>;
  writeReview(path: string, value: Data): Promise<void>;
};
/** Thin command orchestration accepts a fake host for lifecycle tests. */
export async function authoringCommand(args: string[], host: AuthoringHost): Promise<string> {
  const command = args[0] ?? "help", values: Data = {};
  if (["help", "--help", "-h"].includes(command)) {
    if (args.length > 1) fail("help takes no authoring arguments");
    return AUTHORING_HELP;
  }
  const allowed = command === "discover" ? ["output"] : command === "review" ? ["proposals", "selections", "reviewed", "reviewer", "output"] : [];
  if (!allowed.length) fail("unknown authoring command; use help");
  for (let index = 1; index < args.length; index++) {
    const key = args[index].replace(/^--/, "");
    if (!args[index].startsWith("--") || !allowed.includes(key) || Object.hasOwn(values, key)) fail("unknown or repeated authoring argument; use help");
    if (key === "reviewed") { values[key] = true; continue; }
    if (index + 1 >= args.length || args[index + 1].startsWith("--")) fail(`--${key} needs a value`);
    values[key] = args[++index];
  }
  if (command === "review" && (values.reviewed !== true || typeof values.reviewer !== "string")) fail("review requires explicit --reviewed and --reviewer NAME");
  const input = command === "review" ? authoringPrivatePath(values.proposals) : undefined;
  const selections = command === "review" ? authoringPrivatePath(values.selections) : undefined;
  const explicitOutput = values.output === undefined ? undefined : authoringPrivatePath(values.output);
  const { context, observations, policy } = await host.snapshot();
  if (command === "discover") {
    const sidecar = await createProposals(context, observations, policy);
    const output = explicitOutput ?? `.quarto/knowledge-graph/authoring/${sidecar.contextHash}.proposals.json`;
    await host.writeProposals(output, sidecar);
    return `Private authoring proposals: ${output}; ${sidecar.candidates.length} candidates; ${sidecar.diagnostics.length} diagnostics.`;
  }
  const sidecar = await host.readJson(input!);
  const result = await reviewProposals(sidecar, context, policy, await host.readSelections(selections!), true, values.reviewer);
  const output = explicitOutput ?? `.quarto/knowledge-graph/authoring/${sidecar.proposalsHash}.reviewed.yml`;
  if (output === input || output === selections || `${output}.review.json` === input || `${output}.review.json` === selections) fail("review output must be separate from its inputs");
  await host.writeReview(output, result);
  return `Reviewed private patch: ${output}; canonical declarations unchanged; new objects default to public: false.`;
}
