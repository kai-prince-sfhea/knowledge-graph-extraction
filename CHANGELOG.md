# Changelog

## 0.0.7 — EmbeddingGemma 2 migration — 12 October 2026

- Default to `google/embeddinggemma-2` at 768 dimensions for embedding policy and explicit local authoring manifests; deterministic renders still perform no inference or downloads.
- Admit the official standard module paths, use text-only CPU float32 loading and explicit `SearchQuery`/`Document` prompts. Respect the smaller of the pinned runtime limit and 8,192 tokens without silent truncation; retain explicit legacy 300M manifests at 2,048 tokens.
- Record encoding-profile/token-limit provenance and require model identity on imported vectors. Refuse mismatched model/artifact/runtime/dimension/prefix/profile identities. Rebuild index and query embeddings for the new space; do not relabel or mix old vectors.
- Preserve hash-pinned local artifact/runtime inventories, private review material and native deterministic authoring. Real-model compatibility and retrieval quality remain unverified; fake adapters establish protocol behavior only.
- No declaration/public format migration is introduced. Changed extractor dependency hashes invalidate prior reuse/frozen contexts; make a reviewed complete update render. Embedding files require a separate explicit re-encoding workflow.

## 0.0.6 — initial experimental public source — 9 October 2026

- Adopt Apache License 2.0 after the owner's third-party and AI-assisted contribution review; retain separate terms for caller-installed runtimes/models and consumer-authored content/data.
- Keep the distribution focused on the installable runtime, minimal example, user instructions and legal/security notices.
- Make the README self-contained for installation, activation, declarations, configuration, cache reset, optional workflows and AI transparency. No extraction contract or runtime behavior changes are intended.
- Document the GitHub installation namespace, tested support scope, custom-schema/prerequisite authoring, HTTP graph loading and provisional update/rollback policy.
- Explicit `build.ts reset [--dry-run]` clears only extraction reuse and the ephemeral run pointer, with file-only/link refusal and all-target preflight validation. Complete/public-recovery/Git/imported baselines, source/declarations and private review/history remain intact.
- Initial/unborn Git comparison provenance reports `not-established` with a null change set; invalid old revisions remain unknown. Content/HTML hashes retain invalidation authority.
- Disclose AI assistance and clarify configuration, cache-reset and support boundaries in the README.
- No declaration/public/cache/baseline format migration is introduced. As with other runtime changes, extractor dependency hashes invalidate old reuse/frozen contexts: make a reviewed complete update render. See the README for reset instructions and support boundaries.

## 0.0.5 — local correctness and performance development

- Case-insensitive QMD dependency scanning, including includes, inherited metadata and executable-content freshness guards.
- Bounded normal/escaped/double-escaped script text scanning prevents phantom HTML anchors while preserving ordinary legacy comment wrappers.
- Iterative prerequisite traversal, streaming alias scoring and validated saved route summaries/cost components; request-local prerequisite groups avoid repeated edge sorting.
- Stable per-source/target grouping replaces repeated full-graph filters without changing record order or public eligibility.
- Factored invariant dependency serialization preserves source-key bytes/digests; recovery verifies every cached artifact but only rewrites damaged or missing destinations.

## 0.0.4 — local development implementation

- Opt-in native compact-annotation and definition-italic proposals, private selections/review patches and finalized source/HTML/observation freshness checks. Canonical declarations remain authoritative.
- Data-only reviewed frozen-baseline export/import for fresh checkouts, followed by required complete native reconstruction and semantic matching.
- Navigation fixes for actual-start prerequisite diagnostics, keyboard focus, nested search/domain restoration, bounded prerequisite uncertainty and step-limited route search.
- Fragment-free public JSON Schema identity matching JSON-LD `conformsTo`, following an independent draft-2020-12 validator failure.

## 0.0.3 — local development implementation

- Custom data schemas, typed properties, endpoint rules, public-field selection and language-tagged aliases.
- Per-source extraction reuse guarded by source/include/dependency and rendered-HTML hashes; explicit cached-only inspection/update/frozen commands.
- Private existing-Git provenance and local source collections with committed source/resource/metadata byte checks.
- Shared bounded queries, weighted routes with hard AND/OR prerequisites, local graph navigation and preserved nested detours.
- Opt-in JSON-LD/DCAT/PROV, CSV and public JSON Schema exports with explicit dataset identity and rights metadata.
- Explicit local LiteRT-LM suggestions and EmbeddingGemma encoding, private sidecars and human-reviewed declaration patches; no inference during rendering or automatic model acquisition.
- Generation-coherent recovery for optional assets, partial output clearing and successful removal of superseded public generations.

## 0.0.2 — local development implementation

- Automatic metadata-contributed prepare/finalize hooks from a readable packaged bootstrap, with flat and owner-namespaced discovery and a local data-module workaround for paths with spaces.
- Inactive/project-disabled no-op lifecycle, document-disabled incomplete coverage, and native non-HTML fallback without invented HTML observations. Empty native preview inventories retain the validated graph and clear the ephemeral run pointer.
- Native effective configuration, project YAML variants, profiles, inherited metadata and observed document output mappings.
- Applicable native input inventory by default, canonical source occurrences, stable occurrence IDs and default author-declared review status.
- Explicit protected literals in place of a private-word blacklist; public projection remains opt-in.
- Policy-only EmbeddingGemma 300M/768 and Gemma 4 E2B preferences, with optional GLiNER2.5 Multi disabled; no inference or model downloads.
- Document Windows path and platform limitations.

The 0.0.2 milestone deferred schema/corpus/cache work, now implemented in 0.0.3. Author review and optional engine experiments remain separate gates.

## 0.0.1 — development prototype

- Explicit, scoped version-0 author declarations with stable URI identities.
- File-backed Quarto prepare, AST observation and finalize lifecycle.
- Validated native HTML destinations and reused-include occurrences.
- Public graph/index/report generations selected by a manifest.
- Partial-coverage and dependency-matching frozen modes.
- Named read-only scoped query operations.

No published release yet.
