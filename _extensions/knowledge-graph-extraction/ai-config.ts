// Preferred models for the optional authoring-time assistance workstream.
// This module selects/validates policy; it does not download or run a model.
export const AI_DEFAULTS = Object.freeze({
  embedding: Object.freeze({ model: "google/embeddinggemma-2", dimensions: 768 }),
  generation: Object.freeze({ model: "google/gemma-4-E2B" }),
  extraction: Object.freeze({ model: "fastino/gliner2.5-multi-v1", enabled: false }),
});
type Mapping = Record<string, unknown>;
function mapping(value: unknown, name: string): Mapping {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`knowledge-graph-extraction: ${name} must be a mapping`);
  }
  return value as Mapping;
}
function fields(value: Mapping, allowed: string[], name: string): void {
  const unknown = Object.keys(value).find(key => !allowed.includes(key));
  if (unknown) throw new Error(`knowledge-graph-extraction: ${name} contains an unsupported field; see the AI model configuration reference`);
}
function model(value: unknown, fallback: string, name: string): string {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !value.trim() || /[\u0000-\u001f]/.test(value)) {
    throw new Error(`knowledge-graph-extraction: ${name}.model must be nonempty text`);
  }
  return value;
}
export function parseAIConfig(value: unknown): Record<string, unknown> {
  const config = mapping(value ?? {}, "knowledge-graph.ai");
  fields(config, ["embedding", "generation", "extraction"], "knowledge-graph.ai");
  const embedding = mapping(config.embedding ?? {}, "knowledge-graph.ai.embedding");
  const generation = mapping(config.generation ?? {}, "knowledge-graph.ai.generation");
  const extraction = mapping(config.extraction ?? {}, "knowledge-graph.ai.extraction");
  fields(embedding, ["model", "dimensions"], "knowledge-graph.ai.embedding");
  fields(generation, ["model"], "knowledge-graph.ai.generation");
  fields(extraction, ["model", "enabled"], "knowledge-graph.ai.extraction");
  const dimensions = embedding.dimensions ?? AI_DEFAULTS.embedding.dimensions;
  if (![128, 256, 512, 768].includes(dimensions as number)) {
    throw new Error("knowledge-graph-extraction: knowledge-graph.ai.embedding.dimensions must be 128, 256, 512 or 768");
  }
  const enabled = extraction.enabled ?? false;
  if (typeof enabled !== "boolean") throw new Error("knowledge-graph-extraction: knowledge-graph.ai.extraction.enabled must be boolean");
  if (enabled) throw new Error("knowledge-graph-extraction: GLiNER inference is an evaluation feature, not implemented in this deterministic build; set knowledge-graph.ai.extraction.enabled: false");
  return {
    embedding: { model: model(embedding.model, AI_DEFAULTS.embedding.model, "embedding"), dimensions },
    generation: { model: model(generation.model, AI_DEFAULTS.generation.model, "generation") },
    extraction: { model: model(extraction.model, AI_DEFAULTS.extraction.model, "extraction"), enabled },
    status: "policy-only",
  };
}
