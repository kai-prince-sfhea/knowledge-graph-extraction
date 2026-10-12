# Knowledge Graph Extraction

An experimental Quarto extension that turns explicit, scoped author declarations into a validated public knowledge graph. Different meanings of the same word retain different identities. Native Quarto pages, definitions, theorems and citations remain the authored source.

Version **0.0.7** targets ordinary HTML output from Quarto projects. The verified baseline is **Quarto 1.11.5 pre-release on Windows**. Quarto supplies Lua/Pandoc and Deno; authors do not need Node or npm.

| Scope | Current support |
|---|---|
| Ordinary project-local QMD → HTML/HTML5 | Small default-project, website, nested-page and HTML-book fixtures passed on the baseline above. |
| Native non-HTML output | Can render without producing new HTML graph coverage; an existing graph is retained when no HTML pages are observed. |
| Other platforms, Quarto versions and formats | Unverified. Revealjs, dashboard, email, notebook/script inputs, manuscripts and competing HTML outputs for one source are outside the extraction target. |

The manifest constraint `>=1.11.5` is a parser minimum, not verified support for every later version. These fixtures do not establish general compatibility or accessibility conformance.

## Install and activate

From your Quarto project's directory, install from GitHub:

```powershell
quarto add kai-prince-sfhea/knowledge-graph-extraction --no-prompt
```

Add the filter to your existing `_quarto.yml` or `_quarto.yaml`:

```yaml
filters:
  - kai-prince-sfhea/knowledge-graph-extraction
knowledge-graph:
  navigation: true  # Optional draggable graph and route controls.
```

Installation contributes the prepare/finalize hooks automatically. No manual project hooks are needed. An installed but unselected filter creates no initial graph state. GitHub installs use `_extensions/kai-prince-sfhea/knowledge-graph-extraction/`; the commands below use that path. For a local-copy installation with `quarto add "C:/path/to/knowledge-graph-extraction" --no-prompt`, select the unqualified `knowledge-graph-extraction` filter and omit the owner directory in commands.

Create `knowledge.yml` at the project root:

```yaml
version: 0
namespaces:
  math: https://example.org/math/
objects:
  - id: math:group-action
    type: concept
    scope: mathematics
    labels: {en: group action}
    public: true
    source: {path: index.qmd, anchor: def-group-action}
relations: []
```

Give the native block in `index.qmd` its declared anchor:

```markdown
::: {#def-group-action}
## Group action

A group action assigns compatible transformations to group elements.
:::
```

Run `quarto render`, then open `knowledge-graph/report.html` inside your native output directory, normally `_site` for a website or `_book` for an HTML book. For the optional interactive graph, use `quarto preview` and follow the report's **Explore the graph** link over HTTP. Browser `file:` restrictions can prevent JavaScript modules and graph loading; the static report remains usable. An anchor must be observed in the native AST and occur exactly once in the final HTML.

To try the supplied synthetic two-page website, run from this repository:

```powershell
Push-Location examples/minimal
try {
  quarto add ../.. --no-prompt
  quarto render
} finally {
  Pop-Location
}
```

Open `examples/minimal/_site/index.html`. The [compact declarations](examples/minimal/knowledge-compact.yml) demonstrate separate mathematical and educational meanings of "action"; the [full example](examples/minimal/knowledge.yml) also includes private records. Matching words never automatically create links or merge identities.

## Declarations and configuration

The built-in vocabulary has `concept` and `assertion` objects, plus `defines`, `references` and `requires` relations. Objects need `id`, `type`, `scope`, language-keyed `labels` and `source`. Relations need their own `id`, `type`, `scope`, `from`, `to` and `source`; optional nonnegative `weight` influences route cost. `requires` points from dependent to prerequisite. IDs are absolute HTTP(S) URIs or use a declared namespace. Omitted `review` means author-declared, rather than independently verified.

`defines` connects an assertion to a concept; `references` connects any declared objects; `requires` targets a concept. Each ungrouped requirement is mandatory. Requirements for one dependent sharing a nonempty `properties.prerequisite-group` form alternatives (OR); distinct groups and ungrouped requirements are jointly required (AND). Public requirements publish that group value. Costs never waive these requirements.

The canonical source always counts as an occurrence. Add further uses under an object's `occurrences: [{path: another.qmd, anchor: native-anchor}]`. Omitted `sources` selects Quarto's applicable filter-enabled QMD inventory; `sources: [{path: index.qmd}]` narrows coverage. Provenance identifies the containing page and anchor, without original-file character spans. Labels and aliases can have multiple language keys, but translation equivalence is not verified.

**Publication is opt-in:** records require `public: true`; public relations also require public endpoints. Private graph records stay out of graph serialization. This does not hide prose or attributes already present in ordinary rendered pages. Keep private state, review material and model inputs out of website resources.

Place graph-wide options under `knowledge-graph` in the effective **project** configuration. Unknown extension keys are refused; use YAML Booleans such as `false`, not strings such as `"false"`.

| Option | Default and purpose |
|---|---|
| `enabled` | Active with the selected filter; project `false` disables graph work. |
| `declarations` | `knowledge.yml`; project-relative authoritative declarations. |
| `schema` | Omitted uses the built-in vocabulary; a local YAML file can define types, typed properties, endpoint rules and public-field allowlists. |
| `mode` | `update`; `frozen` refuses changed dependency or semantic identity. |
| `cache` | `true`; reuse requires matching dependencies, source bytes, observations and actual HTML hashes. |
| `git` | `false`; records existing Git history and dirty/untracked files privately. Hashes determine reuse; no Git writes or network operations occur. |
| `navigation` | `false`; enables the local draggable graph, HTML list, search and weighted routes. |
| `authoring` | `false`; observes native annotations/definition italics for explicit private discovery and review. |
| `dependencies` | `[]`; extra local files tracked conservatively as global invalidators. |
| `protected-literals` | `[]`; explicit exact strings refused in supported textual publication outputs. A bounded guard, not a whole-site privacy audit. |
| `ai` | Model policy preferences; no inference during rendering. See below. |
| `exports` | Disabled; optional JSON-LD, CSV and public JSON Schema exports. |

Declaration, schema and source paths must stay within the project. A page-level `knowledge-graph.enabled: false` leaves that selected page unobserved and makes coverage incomplete; other graph policy remains project-wide. Quarto profiles, selected inputs and actual `output-file` mappings determine scope and destinations.

<details>
<summary>Custom schema and difficulty properties</summary>

Set `knowledge-graph.schema: knowledge-schema.yml` in project configuration. This example extends the built-in vocabulary:

```yaml
version: 0
extends: default
object-types:
  concept:
    properties:
      difficulty:
        type: number
        minimum: 0
    public-fields: [difficulty]
```

Then add `properties: {difficulty: 2}` to a concept declaration. Extra record values belong in `properties`; only fields allowed by that type's `public-fields` can enter public output. Properties support `string`, `number` or `boolean`, optional `required`/`enum`, and numeric `minimum`/`maximum`. New `relation-types` declare `from`/`to` type arrays, their properties and public-field allowlist; a sole quoted `'*'` accepts any object type. Omitting `extends` defines a complete vocabulary with `object-types` and `relation-types`. Inherited meanings cannot be redefined; use a new name for a different meaning.

</details>

For open-data exports, provide an explicit dataset identity and only publishable metadata:

```yaml
knowledge-graph:
  exports:
    id: https://example.org/datasets/knowledge
    title: My public knowledge graph
    creators: [Author name]
    license: https://creativecommons.org/licenses/by/4.0/
    base-url: https://example.org/
```

`id` is required; other export keys are optional. Set `license` only when you can grant those data rights; omission leaves rights unknown. The software licence does not choose your site's data licence or prove consent, FAIR compliance, hosting or search indexing.

## Graph output, navigation and cache

Read `<output-dir>/knowledge-graph/manifest.json` first: it selects immutable `generations/<snapshotId>/graph.json`, `index.json` and `report.html`. Graphs include typed relations, containing-page occurrences and explicit complete/incomplete coverage. Snapshot IDs hash semantic content, excluding run timestamps. Failed validation retains the previous committed graph/recovery; the surrounding website is not a transactional publication bundle.

Optional navigation supports scoped search, bounded traversal, prerequisites and weighted routes, without a browser database or model. Readers can accept a route, explore nested concept detours and return. Hard AND/OR prerequisites remain mandatory regardless of difficulty preferences; incomplete or truncated results are provisional. The packaged [query.js](_extensions/knowledge-graph-extraction/query.js) exposes the shared query API.

Reader choices and routes stay in browser memory/session storage; persistent retention requires the reader's checkbox. The **Forget** control removes saved copies. Storage failures leave the current in-memory view usable, and changed snapshots require an explicit reader decision. Nothing is uploaded by these controls.

Partial renders and preview can reuse eligible unchanged observations. Missing/stale observations make coverage incomplete and retain the last-complete baseline. Computational pages and non-include shortcodes conservatively require fresh observations. Run one render/preview workflow at a time.

For an unchanged, previously complete local project, set `mode: frozen` or use the environment override:

```powershell
$kgPreviousMode = $env:KG_MODE
try {
  $env:KG_MODE = 'frozen'
  quarto render
} finally {
  $env:KG_MODE = $kgPreviousMode
}
```

A fresh checkout needs a reviewed data-only baseline followed by a **full frozen render**. After a complete update render and review, `baseline.ts export --reviewed` writes `knowledge-graph-baseline.json`; transfer it through your trusted process, then run `baseline.ts import --reviewed` in the matching checkout. Import supplies expected fingerprints, not cached pages or observations. Run `quarto run _extensions/kai-prince-sfhea/knowledge-graph-extraction/baseline.ts help` for paths and commands.

After a complete render, `build.ts inspect`, `build.ts update` and `build.ts frozen` inspect or assemble eligible cached observations without rendering again. They refuse stale/missing HTML and inputs requiring fresh observations.

To reset reuse, close preview and other renders, then run from the **consuming project's root**:

```powershell
quarto run _extensions/kai-prince-sfhea/knowledge-graph-extraction/build.ts reset --dry-run
quarto run _extensions/kai-prince-sfhea/knowledge-graph-extraction/build.ts reset
quarto render
```

Make the final command a full project render in **update** mode; clear any `KG_MODE=frozen` override first. Reset removes only `.quarto/knowledge-graph/extraction/committed.json` and `.quarto/knowledge-graph/run.json`. It retains the last-complete baseline, committed graph/recovery, history, imported baseline receipts and private proposals. It is idempotent, refuses linked/non-file targets, and works without parsing corrupt cache/configuration. It is not secure erasure.

To disable, set project `knowledge-graph.enabled: false` or remove the filter. Disabling retains private recovery/history but Quarto's normal output cleanup can remove an older public graph. To uninstall, remove the filter from project/document configuration and run `quarto remove kai-prince-sfhea/knowledge-graph-extraction`. Review declarations and retained local state separately. [Quarto extension management](https://quarto.org/docs/extensions/managing.html).

## Optional authoring and AI assistance

With `authoring: true`, a fresh full HTML render can observe identified native `data-kg-id` annotations and simple italicized terms in identified definition Divs. Discovery keeps them private; it does not infer identities from spelling, insert links or modify canonical declarations:

```powershell
quarto run _extensions/kai-prince-sfhea/knowledge-graph-extraction/author.ts discover
quarto run _extensions/kai-prince-sfhea/knowledge-graph-extraction/author.ts help
```

Review explicitly selects candidates and writes a separate private patch/receipt. Merge approved entries into `knowledge.yml` yourself, then render again. New objects default private; mathematical macro extraction and automatic relation inference are not implemented.

AI policy defaults are **EmbeddingGemma 2** (`google/embeddinggemma-2`, 768 dimensions), **Gemma 4 E2B** (`google/gemma-4-E2B`) and disabled **GLiNER2.5 Multi** (`fastino/gliner2.5-multi-v1`). Nested keys are `ai.embedding.model`, `ai.embedding.dimensions` (128/256/512/768), `ai.generation.model`, `ai.extraction.model` and `ai.extraction.enabled`. Enabling GLiNER inference is refused because that execution path is not implemented.

The explicit local encoder uses EmbeddingGemma 2's text-only profile on CPU in float32, its `SearchQuery`/`Document` retrieval prompts and normalized vectors. It refuses inputs over the smaller of the local runtime's sequence limit and 8,192 tokens, including the prefix. Caller-installed Sentence Transformers must support the model; the current official export requires version 6.1.0 or later. See [Google's inference guide](https://ai.google.dev/gemma/docs/embeddinggemma/inference-embeddinggemma-with-sentence-transformers) and [model configuration](https://huggingface.co/google/embeddinggemma-2/blob/main/config_sentence_transformers.json).

When upgrading from 300M, supply a separately reviewed, hash-pinned local EmbeddingGemma 2 artifact/runtime manifest and rebuild both index and query embeddings. Do not rename an old model directory, change an existing vector's model label or mix the two spaces even at the same dimensions. The original 300M encoder remains available through an explicit manifest and its 2,048-token profile. Model, artifact, runtime, dimensions, prefixes, encoding profile and effective token limit distinguish new vectors; existing vector imports must name their encoder explicitly. Optional embedding files and private suggestions are separate from the deterministic graph cache; `build.ts reset` does not migrate or erase them.

Explicit `assist.ts` commands can probe caller-installed runtimes, encode local embeddings, generate local LiteRT-LM suggestions and accept reviewed IDs into a private patch:

```powershell
quarto run _extensions/kai-prince-sfhea/knowledge-graph-extraction/assist.ts help
```

These commands require a separate version-0 manifest pinning local runtime/model paths, hashes, immutable revisions and licence metadata; project AI preferences do not supply those artifacts. Nothing installs or downloads a model, and **ordinary update/frozen rendering performs no inference**. Model quality and actual artifact compatibility remain unverified. Human acceptance and structural/source checks do not establish factual truth, faithful interpretation or proof validity.

## Versions and updates

The `0.0.x` series has provisional interfaces: even a patch update can invalidate derived caches or change a contract. Declarations and public graphs currently use version 0; cache and portable-baseline formats are versioned separately. Unsupported versions fail rather than silently reinterpret content. Read the [changelog](CHANGELOG.md) before updating; there is no automatic migration from the original Schema extension.

Preserve canonical sources, schemas, private reviews and reviewed baselines, then try `quarto update kai-prince-sfhea/knowledge-graph-extraction` in an isolated project copy. Make a complete render in **update** mode and review identities, public eligibility, anchors, relations, coverage and exports. Re-export a portable baseline only after that review; changed dependencies can invalidate an older frozen baseline. Reset clears reuse, not schemas or review history. To roll back, restore the matching extension, sources and reviewed baseline together. Retain installed `_extensions` in your project's version control for reproducibility. [Quarto distribution and version selection](https://quarto.org/docs/extensions/distributing.html).

## Security and private data

This experimental extension has no security certification or supported production release. Its publication and integrity checks are bounded safeguards; they do not secure or audit a whole Quarto website. The planned Content Security Protocol extension is not implemented here.

Only explicitly public graph records are serialized, but ordinary rendered prose and native `data-kg-*` attributes remain visible. Keep `.quarto/knowledge-graph/`, private review/history, prompts, local model manifests and model artifacts out of publication resources. Review resolved paths and all content before sharing output. Cache reset retains private review/history and is not secure erasure.

Hashes detect corruption or staleness; they do not authenticate a producer or establish truth. Native subprocesses and caller-selected AI adapters execute code and are not confined by `QUARTO_RUN_NO_NETWORK`. That setting controls Quarto's cached import dispatch, not operating-system network access.

Do not put credentials, confidential text, private prompts, unpublished research or personal/learner data in public issues. No private reporting address is configured yet; request a private route from the maintainer without disclosing vulnerability details publicly. Use synthetic reproductions, safe tool versions and redacted diagnostics. Distinguish extension flaws from authored public content, external adapters and hosting configuration.

## Licence, transparency and support boundaries

Copyright 2026 Kai Prince. Licensed under **Apache License 2.0**, selected by the repository owner after third-party and AI-assisted contribution review. See the [repository licence](LICENSE) and [packaged licence](_extensions/knowledge-graph-extraction/LICENSE). This covers repository code, examples and documentation unless an explicit notice states otherwise. The minimal example and its bibliography entries are fictional original test material. Your authored research, prose, personal data and graph datasets retain their separate rights.

The extension bundles no Quarto runtime, model weights, ONNX/LiteRT artifacts or browser inference libraries. Quarto supplies Pandoc/Lua, Deno and the `stdlib/path`/`stdlib/yaml` imports under their own terms; consult your Quarto distribution's `share/COPYRIGHT` and `share/COPYING`. Optional assistance uses caller-installed artifacts and libraries without installing or downloading them. Check model, conversion, tokenizer and runtime terms separately; a recorded licence string or hash is not proof of permission.

Generated sites can redistribute extension JavaScript/CSS. Retain their Apache notices and include the provided licence and [copyright notice](_extensions/knowledge-graph-extraction/COPYRIGHT) when sharing those assets. This does not automatically license your research, prose or graph data under Apache 2.0.

**OpenAI Codex assisted development** of code, synthetic fixtures, expected/oracle records, tests, documentation and research/planning. It generated/revised material, investigated failures and helped inspect sources. Automated checks are not an independent human audit; the author retains responsibility for implementation acceptance and publication. This development disclosure is separate from optional runtime AI.

There is no published release yet.

Remaining limits include serial rendering, explicit canonical YAML, no automatic Schema migration, no certified assistive-technology behavior, no general cross-platform/Unicode-path promise, and no real-model quality evaluation. Manuscripts, arbitrary format combinations, browser databases/Prolog, progressive delivery shards and formal Argumentation Sandbox interoperability require further work.
