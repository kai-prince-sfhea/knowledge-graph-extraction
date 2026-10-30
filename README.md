# Knowledge Graph Extraction

An experimental Quarto extension that turns explicit, scoped author declarations into a validated public knowledge graph. Different meanings of the same word retain different identities. Native Quarto pages, definitions, theorems and citations remain the authored source.

Version **0.0.17** is experimental development source targeting ordinary HTML
output from Quarto projects. This candidate improves report wrapping, graph
controls and embedded theme integration. Its pure Node regressions pass; native
rendering and browser review of this revision remain separate checks.
Version 0.0.16 added explicitly reviewed semantic identity and
coreference proposals through a caller-installed local server, with all new AI
working files outside the project and Git repositories. The 0.0.16 full
regression and fourteen installed semantic author-command checks passed on
**Quarto 1.11.5 pre-release on Windows**. Earlier source/review, model-free batch
and combined-project checks retain their recorded scopes. The earlier 0.0.13
browser checks cover labels, full-name alternatives, forces, drag release,
keyboard controls, saved viewport and reduced motion. Earlier progressive,
route/provider and publication checks retain their own version scope. These
bounded results do not establish every platform, future Quarto version or human
accessibility acceptance. Quarto supplies Lua/Pandoc and Deno; authors do not need
Node or npm.

With an updated Interactive CV, the producer can retain exact declared `start`,
`end`, `date` and dataset `as-of` text. Year/month precision and `Present`/`Unknown`
are preserved. The existing graph time filter remains a closed day-level filter:
unsupported or uncertain dates stay undetermined. The CV's source-bound temporal
view supplies its separately labelled uncertainty reasoning; KG does not infer a
current appointment or replace partial dates with invented day bounds.

| Scope | Current support |
|---|---|
| Ordinary project-local QMD → HTML/HTML5 | Default-project, website, nested-page and HTML-book fixtures passed on the baseline above. The 0.0.16 full suite and fourteen installed semantic author commands pass; earlier combined-site checks retain their recorded scope. |
| Native non-HTML output | Produces no invented HTML coverage. Unchanged HTML graphs are retained; known stale producer views are withdrawn even when the successful render creates only a non-HTML document. |
| Other platforms, Quarto versions and formats | Unverified. Revealjs, dashboard, email, notebook/script inputs, manuscripts and competing HTML outputs for one source are outside the extraction target. |

The manifest constraint `>=1.11.5` is a parser minimum, not verified support for every later version. These fixtures do not establish general compatibility or accessibility conformance.

## Install and activate

Install from your Quarto project folder:

```powershell
quarto add kai-prince-sfhea/knowledge-graph-extraction --no-prompt
```

Select `kai-prince-sfhea/knowledge-graph-extraction` in your existing
`filters` list in `_quarto.yml`:

```yaml
filters:
  - kai-prince-sfhea/knowledge-graph-extraction
```

Installation supplies the lifecycle hooks; installing alone
does not activate the filter. Follow [example.qmd](example.qmd) as the tutorial:
it uses the supplied [two-page project](examples/minimal/_quarto.yml), explains
its first render and expected output, then guides a small edit and optional
graph preview. Rendering the instruction page itself does not exercise
project-level extraction.

For a local checkout, the tutorial installs with `quarto add ../..` from
`examples/minimal` and uses the unqualified filter. The GitHub command follows
the experimental `main` branch; it does not select a supported tagged release.
This README is the advanced declaration, configuration and integration reference.

The generated navigator, static report and diagnostics currently use English.
Document `lang` and multilingual catalogue labels do not translate these
interface messages. Authored labels remain separate from semantic identifiers;
language equivalence requires its own review.

## Using extensions together

Enable the installed filters in your ordinary project configuration. Installation alone does not activate them:

```yaml
filters:
  - kai-prince-sfhea/knowledge-graph-extraction
  - kai-prince-sfhea/interactive-cv
knowledge-graph:
  navigation: true
```

With the matching composition-capable Interactive CV version, a `.cv-index` automatically contributes its eligible public records and relationships to a separate **Interactive CV** graph named `cv`. The CV page receives a graph navigator, a direct graph link and a searchable textual alternative. This uses the same public CV catalogue you already author; do not re-enter it in `knowledge.yml`. A CV-only project needs no empty `knowledge.yml`. Normal `quarto render` and `quarto preview` perform the integration; no conversion script, Node build or extra project hook is required.

The website graph remains separate. Native website search includes eligible records from every graph and names the graph in each generated result. The optional **Search within** selector offers all content, original website pages and individual public graphs. A graph can opt out of search without losing its navigator. This extends enabled local Quarto search; it does not enable disabled search or establish external search-engine indexing. See [search compatibility and fallback](#filter-native-website-search).

In the CV's configuration, use `interactive-cv.graph: false` to disable its graph contribution, or a mapping such as `graph: {id: consulting, label: Consultancy, navigation: true, search: true}` to choose another graph. Different CV catalogues need different IDs if their records or graph settings conflict. A self-contained JSON CV graph is accepted through Interactive CV's `graph-file` option; its README describes the import format and publication decisions. Content and consent remain controlled by the producing extension.

The automatic CV navigator defaults to appearing after the CV index document's
content. In the current Interactive CV candidate, `graph.placement: placeholder`
and one empty `.cv-graph` Div on the index page select its location. The graph
view settings below style the inner diagram; Interactive CV's `--cv-graph-height`
CSS property sizes the outer frame. Set `interactive-cv.graph.navigation: false`
to disable the frame. Explicit declaration memberships can place
one author-owned record in several graph views. Cross-graph routes require a
separately enabled [connected view](#connect-explicitly-selected-graphs);
installing companion extensions never merges independent claims automatically.

| Installed and enabled companion | Combined behaviour |
|---|---|
| Interactive CV | Produces its own public graph and dedicated navigator by default. CV record pages remain usable without this extension. |
| Generative Websites | Can consume explicit public `requires` dependencies prepared for the current render. Reviewed authored learning views still control what readers can see; graph labels never establish prerequisite identity. |
| Local AI Websites | Can use the public registry for cross-graph source discovery while retaining graph context. Model downloads and generation remain opt-in Local AI features. |
| Maths Knowledge Graph / Accessible Maths | Preserve authored mathematical identities, semantics and rendering responsibilities. Named, recognised payloads can reuse eligible unchanged AST observations. Their catalogue composition is separate from CV data; ordinary words do not become mathematical identities. |
| Content Security Protocol 0.0.5+ | A current active native audit runs after graph publication, CV enhancement and search updates, regardless of which extension's contributed post-render hook runs first. Its configured finding threshold can still fail the render. Merely installing a disabled audit does not activate it. |

Composition protocol 1 is used with Interactive CV, Generative Websites and Local AI Websites 0.0.5. The local KG 0.0.10 combination was checked in the installed combined test website; older standalone releases do not acquire an adapter just by being installed. The CV diagnoses an older graph coordinator. Filter order still matters for document transformations described in companion READMEs. The KG coordinator prepares once before rendering and publishes graph artifacts after the pages, so producer records and their navigator refer to this render's snapshot. Unrelated custom hooks that subsequently change HTML still need their own explicit final audit.

### Separate named graphs

Declare additional website graphs in `knowledge.yml`, then select a graph on each object. Omission keeps an object in the existing `website` graph:

```yaml
version: 0
namespaces: {research: https://example.org/research/}
graphs:
  research:
    label: Research
    navigation: true
    search: true
objects:
  - id: research:open-education
    graph: research
    type: concept
    scope: education
    labels: {en: Open education}
    public: true
    source: {path: research.qmd, anchor: open-education}
relations: []
```

Graph IDs use lowercase letters, digits and hyphens, beginning with a letter; `federated` is reserved. The corresponding page needs one native `open-education` anchor. Relations default to their source endpoint's primary graph and need both endpoints in every selected membership. Distinct meanings retain distinct semantic IDs; named graphs separate navigation, whereas `scope` remains a domain filter within a graph. Additional graphs default to navigation and search enabled; the legacy website graph retains `knowledge-graph.navigation: false` as its default.

`knowledge-graph/registry.json` lists public graphs, labels, coverage, snapshot IDs and generation-relative graph/index/navigation URLs. Named graphs also supply a complete static `report` URL. Each graph is queryable independently with the existing graph query module. The registry and all graphs belong to the same immutable publication generation; source destinations inside graph data remain relative to the website output root. Private producer observations and reuse pointers stay under `.quarto/knowledge-graph`, outside website resources.

### Share a declaration between graph views

Use `graphs` on an existing object when the **same declared record** belongs in
several views. Keep one canonical declaration and add these fields:

```yaml
graph: website
graphs: [website, research]
```

Both graph IDs must be declared. `graph` selects the primary view and must occur
in `graphs`; if omitted, the alphabetically first membership is primary.
Relations can also declare `graphs`, provided both endpoints belong to every
listed graph. Omitted relation memberships do not automatically expand to all
shared views. Website search combines these explicit shared memberships while
retaining graph context and canonical destinations.

This option does not declare two different meanings equivalent. Independent
producer claims sharing a URI remain separate. The prepared prerequisite
contract includes every explicit membership for compatible learning consumers.

### Connect explicitly selected graphs

Enable a separate combined navigator in the complete project mapping:

```yaml
knowledge-graph:
  navigation: true
  federation:
    graphs: [website, research]
    label: Website and research connections
```

The existing named graphs and default CV graph remain separate. The connected
view is an additional projection, listed under `registry.json`'s `federation`
entry and linked from the main graph report. Every selected graph must enable
its own navigation. Omit `federation`, or use `false`, to retain independent views.

Add deliberate links under the **top level of `knowledge.yml`**, alongside
`objects` and `relations`:

```yaml
navigation-links:
  - id: research:education-route
    from: {graph: website, id: research:open-education}
    to: {graph: research, id: research:study-design}
    public: true
    weight: 1
    source: {path: research.qmd, anchor: research-route}
```

The endpoints must be existing public records in those graphs; this snippet
assumes those declarations and namespace already exist. Add an identified
section to its ordinary QMD source:

```markdown
## How this research connects {#research-route}

The route links the educational context to the study design.
```

Links are directed. Optional `type: requires` expresses a hard cross-graph
prerequisite from dependent to prerequisite, with optional
`properties: {prerequisite-group: alternatives}` for OR alternatives. The
default type is `navigation-link`; weights are finite nonnegative costs.
Links require `public: true`, current source-anchor observation and public
endpoints. Producer URNs can be used as endpoint IDs without changing the
producing catalogue.

If a freshly rendered link source lacks its declared anchor, validation fails.
Correct the declaration or source and render again; a failed render does not
establish a new complete publication.

Federation qualifies identities by their original graph; identical URIs from
independent producers never merge. Explicit same-author memberships add
zero-cost bridges only when their canonical public records and `requires`
projections agree. Missing selected graphs, unavailable links, unobserved link
sources or unresolved membership constraints make coverage incomplete and
withhold the interactive connected navigator. An incomplete static report and
mapping explain the available projection without exposing rejected candidate
IDs. Render the full project after resolving the declarations.

## Declarations and configuration

The built-in vocabulary has `concept` and `assertion` objects, plus `defines`, `references` and `requires` relations. Objects need `id`, `type`, `scope`, language-keyed `labels` and `source`. Relations need their own `id`, `type`, `scope`, `from`, `to` and `source`; optional nonnegative `weight` influences route cost. `requires` points from dependent to prerequisite. IDs are absolute HTTP(S) URIs or use a declared namespace. Omitted `review` means author-declared, rather than independently verified.

`defines` connects an assertion to a concept; `references` connects any declared objects; `requires` targets a concept. Each ungrouped requirement is mandatory. Requirements for one dependent sharing a nonempty `properties.prerequisite-group` form alternatives (OR); distinct groups and ungrouped requirements are jointly required (AND). Public requirements publish that group value. Costs never waive these requirements.

The canonical source always counts as an occurrence. Add further uses under an object's `occurrences: [{path: another.qmd, anchor: native-anchor}]`. Omitted `sources` selects Quarto's applicable filter-enabled QMD inventory; `sources: [{path: index.qmd}]` narrows coverage. Standard provenance identifies the containing page and anchor. The optional [source-origin artifact](#original-tokens-in-included-source-files) adds coordinates for an original literal anchor token, without claiming full definition/proof spans. Labels and aliases can have multiple language keys, but translation equivalence is not verified.

**Publication is opt-in:** records require `public: true`; public relations also require public endpoints. Private graph records stay out of graph serialization. This does not hide prose or attributes already present in ordinary rendered pages. Keep private state, review material and model inputs out of website resources.

Place graph-wide options under `knowledge-graph` in the effective **project** configuration. Unknown extension keys are refused; use YAML Booleans such as `false`, not strings such as `"false"`.

| Option | Default and purpose |
|---|---|
| `enabled` | Active with the selected filter; project `false` is a master veto, including when a page replaces the namespace with its own enabled mapping. |
| `declarations` | `knowledge.yml`; project-relative authoritative declarations. A missing default file means no hand-authored graph objects, allowing producer-only projects. An explicitly configured missing file is refused. |
| `schema` | Omitted uses the built-in vocabulary; a local YAML file can define types, typed properties, endpoint rules and public-field allowlists. |
| `mode` | `update`; `frozen` refuses changed dependency or semantic identity. |
| `cache` | `true`; reuse requires matching dependencies, source bytes, observations and actual HTML hashes. |
| `git` | `false`; records existing Git history and dirty/untracked files privately. Hashes determine reuse; no Git writes or network operations occur. |
| `navigation` | `false`; enables the local draggable graph, HTML list, search and weighted routes. |
| `view` | Optional literal presentation settings for every enabled navigator, including the separate CV graph; see the example below. |
| `query-profiles` | `[]`; named hierarchy, evidence and exact-date questions using explicit schema mappings. |
| `search-filter` | `true`; optional scope selector for supported native local website search; all-content search remains available. |
| `federation` | Disabled; an explicit `{graphs: [...], label: ...}` selects a connected projection while keeping named graphs separate. |
| `delivery` | Disabled; `{mode: topics}` enables verified progressive navigator details and immutable topic fragments. |
| `source-origins` | Disabled; explicit QMD/MD paths whose anchor-token coordinates may appear in the public provenance artifact. |
| `reading` | Enabled for an enabled navigator; `false` disables source-page reading continuity. A mapping can declare local activities; see below. |
| `authoring` | `false`; observes native annotations/definition italics for explicit private discovery and review. |
| `dependencies` | `[]`; extra local files tracked conservatively as global invalidators. |
| `protected-literals` | `[]`; explicit exact strings refused in supported textual publication outputs. A bounded guard, not a whole-site privacy audit. |
| `ai` | Model policy preferences; no inference during rendering. See below. |
| `exports` | Disabled; optional JSON-LD, CSV and public JSON Schema exports. |
| `package` | Disabled; optional public-export package metadata with an author-supplied description and publication date. Requires `exports`. |

Declaration, schema and source paths must stay within the project. A page-level `knowledge-graph.enabled: false` leaves that selected page unobserved and makes coverage incomplete; other graph policy remains project-wide. Quarto profiles, selected inputs and actual `output-file` mappings determine scope and destinations.

Keep one complete graph-policy mapping at its intended project/profile layer;
do not assume arbitrary partial namespace mappings are deep-merged or that a
metadata-file value overrides an explicit document mapping. A document flag
controls that page's observation, not the authoritative project graph policy.
Native hook lists can accumulate across project/profile metadata; add only your
own hooks and let installation contribute the extension's hooks once.

### Customise the navigator in YAML

Keep these settings in the same complete **project** `knowledge-graph` mapping
as your other graph options. No JavaScript or database setup is needed:

```yaml
knowledge-graph:
  navigation: true
  view:
    color-scheme: auto          # auto, light or dark
    motion: paused             # auto or paused
    diagram-height: comfortable # compact, comfortable or large
    repulsion: 85              # 0–200; default 60
    attraction: 0.025          # 0–0.2; default 0.04
```

All keys are optional. Omitted settings preserve the existing automatic colour
scheme, automatic motion and comfortable diagram height. In a same-origin
iframe, `auto` follows the nearest surrounding Quarto page's light/dark toggle.
Standalone pages, other hosts and inaccessible cross-origin ancestors use the
browser's operating-system colour preference. Explicit `light` or `dark` keeps
the configured mode. System forced-colour modes retain
priority. `motion: paused` starts quietly with an explicit **Resume layout**
button; `auto` still starts paused for a reduced-motion preference. Dragging,
force changes and movement buttons do not override a pause.

These are site-wide **initial** presentation preferences for the website,
additional named graphs and the automatic CV navigator. Readers can still
adjust forces, pause, resume, pan and zoom. They change neither graph facts nor
relation weights, difficulty costs or accepted routes. The height preset sizes
the diagram inside its own page; the CV embed's outer height is configured
separately through Interactive CV's documented CSS variable. Arbitrary CSS,
remote style URLs and executable configuration are not accepted here.

Source reports use the same local typography and theme colours, wrap long IDs
and provenance, and remain styled when navigation is disabled. Their stylesheet
is included in the immutable publication and runtime identity. The navigator
places search first and keeps loading counts and diagram guidance in native
disclosures. Source coverage and unavailable-detail messages stay visible.
Labels have a slightly larger screen font; the full source list remains the
alternative when diagram labels cannot fit. None of these presentation choices
changes graph facts, force calculations, route acceptance or reader knowledge.

When delayed search replaces the source list, a focused result keeps its place
if the same record remains; otherwise focus returns to the search input.
Delayed record selection preserves focus that the reader has moved elsewhere.
Forgetting a source-page reading route moves focus from its removed control to
the retained route heading, while leaving focus outside that panel in place.

### Offer named questions without author JavaScript

Every enabled navigator includes record/relation counts, source-page listings
and record- or page-based route choices. Page routes retain the full semantic
record/edge witness; two unrelated concepts appearing on one page are not a
shortcut through that page. Weighted costs remain navigation preferences.

For your own schema, add up to 16 `query-profiles` to the same project mapping:

```yaml
knowledge-graph:
  navigation: true
  query-profiles:
    - id: broader-topics
      label: Find broader topics
      operation: hierarchy
      relations:
        - {type: specializes, direction: child-to-parent}
      direction: ancestors
    - id: supporting-evidence
      label: Find associated evidence
      operation: evidence
      relations:
        - {type: supported-by, direction: target-to-evidence}
    - id: dated-activities
      label: Find dated activities
      operation: time-filter
      fields: {start: started, end: finished}
      match: overlaps
```

This example assumes your schema declares the named relation types and public
`started`/`finished` string properties. Profiles explain existing declarations;
they do not create data or infer relationships. In **Ask a named question**,
choose a profile and run it. Hierarchy/evidence questions use the selected
record. Date questions ask for an exact inclusive `YYYY-MM-DD` window.

Hierarchy mappings use `child-to-parent` or `parent-to-child`, with
`direction: ancestors` or `descendants`. Evidence mappings use
`target-to-evidence` or `evidence-to-target`; optional `types` selects evidence
object types. An evidence association is author-declared, not a proof verdict.
Date profiles use either `fields: {instant: happened}` or a start/end pair,
optional object `types`, and `match: overlaps`, `contained` or `starts-within`.
They read those exact public properties. Missing dates, `Present`, uncertain
dates, timestamps and month/year-only values remain undetermined. This bounded
day filter is not temporal logic or a general interpretation of CV dates.

Results disclose coverage, bounds, domain and snapshot. An incomplete/truncated
graph cannot establish global absence or an optimal route. Relation names and
directions must match your own published vocabulary; no Cypher/Prolog database
or model is required.

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

### Package the public data for reuse

Add `package` to the same complete project mapping to describe the existing
public exports as a small data package:

```yaml
knowledge-graph:
  exports:
    id: https://example.org/datasets/knowledge
    title: My public knowledge graph
  package:
    description: Public concepts and their declared relationships.
    date-published: '2026-10-25'
```

Supply your own real publication date; it is not generated from the render
clock. The normal render adds `ro-crate-metadata.json` and
`reconstruction-manifest.json` beside the four public export files in the
immutable generation selected by `manifest.json`. The JSON-LD metadata targets
[RO-Crate 1.2](https://www.researchobject.org/ro-crate/specification/1.2/root-data-entity.html)
and embeds the relevant context mappings for offline interpretation.

Collection rights, metadata rights and each payload's rights remain separate.
Optional `package.license` declares the collection licence;
`package.metadata-license` covers the two new metadata files. The existing
`exports.license`, when supplied, continues to declare the four data-export
licences. `package.component-rights` can name only `dataset.jsonld`,
`objects.csv`, `relations.csv` and `public-schema.json`. Each entry is either
`unknown` or `{license: https://example.org/your-licence, attribution: Public credit}`.
Use a real licence URI and public credit you are entitled to publish. A per-file
declaration conflicting with `exports.license` is refused. Omitted rights remain
explicitly unknown, including metadata rights; no software or collection licence
is silently substituted. An unknown-rights statement grants no reuse permission.

The reconstruction manifest records exact UTF-8 byte counts and SHA-256 hashes
for the four payloads. RO-Crate metadata additionally hashes that manifest; the
descriptor does not attempt a circular self-hash. These checks identify changed
bytes, not legal clearance or author authentication. The package preserves the
public projections and their interpretation instructions. It does not include
source QMD files, private caches, prompts, models or native HTML, and cannot
rebuild the source website. Incomplete coverage stays explicit. This is a
foundation for FAIR/open-data and OER practice, with no claim of certification,
persistent-identifier registration, repository deposit or preservation service.

## Graph output, navigation and cache

Read `<output-dir>/knowledge-graph/manifest.json` first: it selects immutable
`generations/<snapshotId>/graph.json`, `index.json`, `report.html` and the public
registry. Existing single-graph paths remain the website graph; named graphs have
separate artifacts within that generation. Graphs include typed relations,
containing-page occurrences and explicit complete/incomplete coverage. Snapshot
IDs hash the published graph and composition identities, including enabled
search-corpus and navigator inputs, while excluding run timestamps. An authored
prose edit can therefore change a publication snapshot without changing concept
IDs. Failed validation preserves verified private recovery where possible. Known
producer withdrawals invalidate stale public artifacts even when their replacement
fails; see [failed imports and withdrawal](#failed-imports-and-withdrawal). The
surrounding website is not a transactional publication bundle.

During a partial render, an untouched producer contribution is reused only when its source, declared catalogue dependencies, shared configuration and final HTML still match. A freshly rendered page replaces its old contribution, including an empty/disabled contribution. Changed or missing unrendered producer data is excluded and coverage becomes incomplete. A known stale CV index or detail output is temporarily replaced with an accessible unavailable notice, and its native search snippets are removed. This prevents withdrawn generated content remaining available while another dependent page is being previewed. The QMD source is preserved; make a complete render to restore the current public views. Quarantine covers registered producer outputs, not arbitrary manually copied content, already downloaded documents, reader caches or other deployments. Removed source pages lose their graph contribution. Retired public graph generations are removed after successful publication so withdrawn records do not remain available through an old graph URL.

This check runs on every successful project render, including a page outside an explicitly narrowed graph source list and non-HTML renders. Source context includes native QMD inputs, their includes, inherited metadata and external metadata files even when a CV page selects only its own filter. Companion producers provide byte digests captured when they originally read catalogue files; a file changed after that read causes an actionable failed build rather than publishing old observations under a new digest. A removed source's old output remains unavailable and excluded from native search until the output is removed or a freshly validated producer takes ownership of it. Renaming a CV QMD while retaining its `output-file` therefore keeps the current rendered view available; unrelated stale outputs remain withdrawn.

Reopening an unchanged `quarto preview` can render no input pages. Its hooks prepare a fresh verification run and retain the existing graph when nothing changed; tracked producer withdrawals are still checked. This creates no new HTML coverage. Frozen retention does not satisfy an imported baseline's requirement for a complete fresh native frozen render.

For a combined website, `quarto preview --render all` starts with a complete
graph. Preview can also render pages on demand; companion filters with unknown
transform inputs can make a partial graph incomplete or omit unvisited records.
The tested Windows Quarto 1.11.5 prerelease also has a cache-key separator defect:
direct `.html` requests can re-render unchanged pages even after `--render all`.
For a stable rendered-output preview on that baseline, install Python 3 on PATH
and use Quarto's supported configuration in the project's existing YAML:

```yaml
project:
  preview:
    watch-inputs: false
    serve:
      cmd: 'python -u -m http.server {port} --bind 127.0.0.1'
      ready: 'Serving HTTP'
```

Run Render Project followed by ordinary Preview, or use `quarto preview --render
all`. After edits, render the project and refresh the preview. This uses Python's
standard server through Quarto; no author-written script is required. Python is
an optional preview workaround, not an extension rendering dependency. Quarto
has no supported `project.preview.render` YAML option. Safe automatic replay for
every companion combination remains an optimisation target.

Reader route and diagram storage is separated by graph ID and remains snapshot-bound. With reading continuity enabled and a route explicitly accepted, ordinary activation of a source link continues that journey in the same tab (or containing page for an embedded navigator). Without an accepted reading route, standalone source links retain their separate-tab behavior. Modified clicks and the browser's ordinary new-tab controls remain available. A static source list and direct graph link remain available without the embedding interface. The graph view starts with at most 200 static records and links to that graph's complete static source report, which has no JavaScript requirement or record-count truncation.

Optional navigation supports scoped search, bounded traversal, prerequisites and weighted routes, without a browser database or model. Readers can accept a route, explore nested concept detours and return. Hard AND/OR prerequisites remain mandatory regardless of difficulty preferences; incomplete or truncated results are provisional. The packaged [query.js](_extensions/knowledge-graph-extraction/query.js) exposes the shared query API.

The graph diagram uses a local force layout: declared links attract their endpoints, and a two-dimensional Fast Multipole Method approximates repulsion. It draws at most 120 matching records; this bounded browser view is not a large-graph performance guarantee. Node colours have a text type legend, and size reflects displayed link count. Inspecting or hovering over a node emphasises its neighbours; overlapping ambient labels are hidden while full names and identifiers remain in the source list and details. Diagram proximity does not create a relation or establish conceptual similarity.

The force module is an independent implementation of multipole/local translations
for the derivative of the two-dimensional logarithmic potential, with direct
near interactions and bounded coincident-node handling. The mathematical reference
is [Greengard and Rokhlin's FMM paper](https://www.stat.uchicago.edu/~lekheng/courses/302/classics/greengard-rokhlin.pdf).
This is a visual layout, with damping and cooling, rather than a physical model.

Drag a node and release it to let the running simulation arrange it again. Drag pins last only while the pointer is held; cancellation and loss of focus also release them. **Pause layout** freezes motion, **Resume layout** restarts it, and **Fit graph** brings displayed nodes into view. Pan, zoom and node movement also have buttons. **Layout settings** adjusts repulsion and link attraction without changing graph facts, route weights or difficulty costs. A reduced-motion preference starts the layout paused, and changing to reduced motion pauses an active layout. Only an explicit resume overrides that pause. The diagram, accessible list and complete static report use the same public projection; no additional model, database or remote asset is loaded.

Reader choices and routes stay in browser memory/session storage; persistent retention requires the reader's checkbox. The **Forget** control removes saved copies. Storage failures leave the current in-memory view usable, and changed snapshots require an explicit reader decision. Nothing is uploaded by these controls.

### Continue a route through the source pages

An enabled navigator supplies source-page reading continuity by default. After
explicitly accepting a route, follow a source link to its ordinary rendered
page. A **Your reading route** panel retains the graph, snapshot, current step
and return context. It offers deliberate completion, a concept detour, return
from an exploration and return to the navigator. Returning restores the retained
position and focus where the corresponding current elements remain available.
Simply visiting a page does not mark a concept known; prerequisites and an
accepted route still require explicit completion decisions.

The route normally lasts for the browser session. **Retain this reading route
on this browser after the session** is an explicit persistence choice;
**Forget reading route** removes the stored route. Storage failure is reported,
and a route from an incompatible snapshot must be chosen again or forgotten.
This is reader navigation state, not a learner assessment, proof result or
published declaration. It is not uploaded to a model or server by these controls.

To turn this feature off, set `knowledge-graph.reading: false` in the complete
project mapping. To offer your own existing local activity pages, use a mapping:

```yaml
knowledge-graph:
  navigation: true
  reading:
    activities:
      - id: reflection
        label: Explore a reflection activity
        url: activity.html
```

Create the corresponding ordinary QMD page yourself; `url` names its rendered
HTML destination relative to the website root. Local fragments are allowed;
remote URLs, traversal paths and private state directories are refused. Website
deployment subdirectories retain their prefix. No author-written JavaScript is
needed to leave and return from these local activity detours.

The packaged generic activity bridge admits only bounded, origin/window/nonce-
matched `returned` or `cancelled` statuses. It does not implement a live
Argumentation Sandbox proof roundtrip, import proof evidence, verify a theorem
or change a reader's knowledge automatically. Such interoperability remains
separate work.

Partial renders and preview can reuse eligible unchanged observations. Missing/stale observations make coverage incomplete and retain the last-complete baseline. Computational pages and non-include shortcodes conservatively require fresh observations. Run one render/preview workflow at a time.

Successful partial renders retain their validated per-page observations for the
next render. That observation cache is separate from the last-complete/frozen
baseline. A separate inventory of previously observed native output paths and
the bounded existing public native `search.json` keeps the extension's search
markup current, including with `cache: false`. It admits only known ordinary HTML
destinations; it never supplies missing semantic facts or permits an unknown
transformation to reuse an old observation.

### Filter native website search

With website search enabled, `search-filter: true` (the default) adds **Search
within** to supported native local search. Its default **All content** uses the
original Quarto provider. **Website pages only** restores the original page
metadata; individual graph choices search that graph's public records before
ranking and the native result limit. Shared memberships retain their declared
context; unrelated identities at the same URL remain separate.

No extra index is downloaded until a reader selects a scope. The optional
corpus uses a current immutable snapshot and same-origin local URLs. Scope
filtering and ranking happen in the browser; they do not invoke a model.
Native Quarto result navigation can include the query in a destination's `q`
URL parameter, which normal website logs or browser history may retain. A failed load or
unsupported runtime resets to All content with an unavailable notice. Disabled
search stays disabled, external Algolia search stays native, and a build-time
unsupported/oversized index retains ordinary native search with a build warning.

The adapter is feature-detected against the observed Quarto 1.11.5 pre-release
local search (Autocomplete 1.19.1/Fuse 6.6.2). It uses the public Autocomplete
source/refresh APIs, not edits to generated Quarto search JavaScript. Other
Quarto versions remain unverified. Limits are 32 MiB of optional index data,
100,000 entries, 500 graphs and 200,000 characters per indexed text field;
unsupported data disables the optional filter rather than silently truncating
the corpus. Set `knowledge-graph.search-filter: false` to use native search alone.

### Reuse observations with recognised companions

No extra setting enables companion reuse. The coordinator recognises exact
installed payload hashes as well as versions. The additional reviewed versions
are Accessible Maths 0.0.10, Maths Knowledge Graph 0.0.10, Interactive CV 0.0.11,
Generative Websites 0.0.13, Local AI Websites 0.0.13 and Additional Citation
Options 1.1.0-dev.6. The current pairs include the separately reviewed final
focus updates to Maths Knowledge Graph, Interactive CV, Local AI Websites and
Generative Websites revision 8; their authored-input contracts are unchanged.
Historical exact pairs remain admitted: Accessible Maths
0.0.6, Maths Knowledge Graph 0.0.4, Interactive CV/Generative Websites/Local AI
Websites 0.0.5 and Additional Citation Options 1.1.0-dev.3. Named selectors can be
flat or owner-qualified. A modified payload, different version, arbitrary Lua path
or unknown transform remains conservative and requires fresh AST observation;
a version string alone does not make a package trusted.

Reuse also checks native source/include/metadata, catalogue and configured
resource inputs, original-reader receipts where supplied, and actual final
HTML. MK default catalogue probe precedence/absence is tracked. Local AI asset
publication must retain its current resource checks. This is an optimisation of
KG observations, not a promise that every companion can skip its own rendering
or model/resource verification. Computational content, unknown shortcodes and
other undeclared transform state still require fresh observation. Two successive
combined-project partial renders reused eligible observations while retaining
explicit incomplete coverage for sources needing fresh observation. Use a full
project render when coverage becomes incomplete; this is not a universal warm
preview or whole-site speed guarantee.

For the additional reviewed versions, reuse tracks a conservative union of the
project, directory, metadata-file, format and source/include contexts already
read by the coordinator. No per-page inspection subprocess is added. Literal
maths/proof inputs, CV catalogues and providers, website catalogues and prepared
activity trees, and Local AI manifests/receipts retain bounded dependency checks.
Model bytes are not opened by this collector. Ambiguous paths or providers,
unsupported advanced data/syntax, unknown options and exceeded bounds require
fresh observation for the affected source; unknown transforms still refuse
reuse across the project. A new filesystem observation session checks freshness
again at finalization. These finite contracts do not establish universal
companion compatibility or whole-site incremental rendering.

### Publish optional topic fragments

Add this to the existing complete project mapping when a compatible client
needs smaller record-detail requests:

```yaml
knowledge-graph:
  delivery:
    mode: topics
    max-shard-bytes: 262144
    max-records-per-shard: 128
```

This publishes an immutable `delivery.json` manifest, complete discovery index
and `topics/<sha256>.json` parts for the website and ordinary named graphs, grouped
by their declared `scope`. The additional connected view retains its full projection.
Every record stays whole. The byte limit accepts 16 KiB–1 MiB; the record limit
accepts 1–2,000. A record that cannot fit is refused with a remedy. Ordinary
`graph.json`, graph reports and existing consumers remain available.

The standard navigator uses this delivery when enabled: it first loads the
complete discovery index and one initial scope, together with a conservative
closure of scopes connected by incident relations and prerequisites. Search
can discover indexed records before all details are loaded; choosing a node or
domain requests the corresponding verified details. The interface reports
loaded detail parts separately from source coverage, and **Load all graph
details** remains available. A connected domain can require many or all parts;
this is not a promise that every project transfers less data.

The packaged [delivery.js](_extensions/knowledge-graph-extraction/delivery.js)
also offers the client API. Exact whole-graph questions and route operations
currently verify and assemble **all** declared parts before using the shared
query kernel. Restoring a saved route or continuing on a source page can also
require the complete graph. Missing/corrupt parts never justify a complete
answer, and older delivery indexes without a scope-closure inventory fall back
to full loading. Other companions must explicitly use this API to load fragments
progressively. No service worker, offline installation, persistent browser cache
or PWA is added. Byte/request/time improvements require measurements of the
specific project and operation.

### Discover the public query provider

Custom clients can read `knowledge-graph/registry.json` to discover a versioned
`queryProvider` on each ordinary graph entry and the optional `federation`
entry. Publication supplies this descriptor without another author option.
Ordinary QMD/YAML authoring and the built-in navigator need no custom client.

The descriptor binds a graph ID, snapshot and complete/incomplete status to its
public graph URL, the shared query module's URL, API version, exact UTF-8 byte
count and SHA-256. It includes the normalized author-declared question profiles
and, when enabled for that graph, the topic-delivery manifest's version, size
and hash. These URLs are relative to the registry's directory and stay within
one immutable `generations/<snapshotId>/` tree. Resolve them against the registry
URL so a website's deployment subdirectory is preserved.

The packaged [query-provider.js](_extensions/knowledge-graph-extraction/query-provider.js)
exports `validateQueryProvider`, `validateQueryProviderProfiles` and the
`QUERY_PROVIDER_API` version/function inventory. Named operations cover existing
lookup, search, traversal, prerequisites, weighted paths, hierarchy, evidence,
counts, exact-day filters and source-page routes. The shared module also exposes
label and explicit reader-navigation helpers. This adds discovery metadata;
it does not introduce a Cypher/Prolog interpreter or executable query strings.

Descriptor validation reads literal data only: it fetches and executes nothing.
A consumer must separately check supported API/functions, the requested graph
identity and coverage, and the exact transferred module/manifest bytes before
using them. Unknown fields, unsafe paths, mixed snapshots and incompatible
versions are refused. A matching hash identifies bytes, not trust, consent,
truth or proof validity. Existing companions must explicitly adopt this contract;
publishing a descriptor does not change their behavior automatically.

### Freeze, transfer and reset a graph

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

For a modern composed graph, inspection explicitly reports that composition is
pending a fresh full frozen render. It checks source context and publication
policy immediately; it cannot verify omitted producer observations. The exact
composition digest remains in the expected snapshot and must be recreated
before graph publication or clearing the imported obligation. Rehashing a file
is not approval or verification of its facts. Historical data-only baselines
without that digest keep their earlier policy checks and fresh-render gate.

After a complete render, `build.ts inspect`, `build.ts update` and `build.ts frozen` inspect or assemble eligible cached observations without rendering again. They refuse stale/missing HTML and inputs requiring fresh observations.

To reset reuse, close preview and other renders, then run from the **consuming project's root**:

```powershell
quarto run _extensions/kai-prince-sfhea/knowledge-graph-extraction/build.ts reset --dry-run
quarto run _extensions/kai-prince-sfhea/knowledge-graph-extraction/build.ts reset
quarto render
```

Make the final command a full project render in **update** mode; clear any `KG_MODE=frozen` override first. Reset removes only `.quarto/knowledge-graph/extraction/committed.json`, `.quarto/knowledge-graph/producers/committed.json` and `.quarto/knowledge-graph/run.json`. It retains the last-complete baseline, committed graph/recovery, history, imported baseline receipts and private proposals. It is idempotent, refuses linked/non-file targets, and works without parsing corrupt cache/configuration. It is not secure erasure.

### Failed imports and withdrawal

If an existing producer's inputs change or fail to import, its stale generated
page is quarantined and current managed graph publication is withdrawn until a
successful render can rebuild it. A private withdrawal marker blocks recovery
of the old public graph, including after a reset. Correct the source/import and
make a full update render. Historical bytes remain private; they do not override
withdrawal or permission changes. Recovery and rollback cover managed artifacts,
not a crash-atomic or concurrent whole-site transaction.

### Inspect retained history privately

After newer renders, inspect receipt-bound retained generations from the
**consuming project's root**. These are optional author commands, not extra
steps required to render or preview your current website:

```powershell
quarto run _extensions/kai-prince-sfhea/knowledge-graph-extraction/history.ts list
quarto run _extensions/kai-prince-sfhea/knowledge-graph-extraction/history.ts view --snapshot REPLACE_WITH_SHA256
```

Copy a verified snapshot identity from `list`; replace `REPLACE_WITH_SHA256`
with that 64-character value. Add `--graph cv` to view one recorded graph, or
`--receipt REPLACE_WITH_MANIFEST_HASH` to select an exact listed receipt context.
For a local flat installation, omit `kai-prince-sfhea/` from the installed path.
The command prints a private HTML path under `.quarto/knowledge-graph/history`.
Open it directly in your editor/browser; it is a self-contained static report
and requires no server, model or author JavaScript.

Every receipt-listed artifact is checked before a view is generated. Missing,
damaged or unreceipted generations cannot become verified views. One semantic
snapshot can have several dependency/receipt contexts. Modern receipts record
first capture time; `view --snapshot` selects the newest fully verified capture,
with receipt hashes breaking equal-date ties. Undated legacy receipts sort last.
`list` groups by snapshot identity and shows each context; snapshot hashes are not
a chronology. Historical coverage and facts
are labelled **not current**. Source destinations remain plain text; old source
pages are not reconstructed. Nothing restores a public graph, republishes
withdrawn records, changes current reader state or grants publication permission.
Keep these retained bytes and reports out of website resources; reset is not
secure erasure.

### Disable or remove

To disable, set project `knowledge-graph.enabled: false` or remove the filter. Disabling retains private recovery/history but Quarto's normal output cleanup can remove an older public graph. To uninstall, remove the filter from project/document configuration and run `quarto remove kai-prince-sfhea/knowledge-graph-extraction`. Review declarations and retained local state separately. [Quarto extension management](https://quarto.org/docs/extensions/managing.html).

## Optional authoring and AI assistance

With `authoring: true`, a fresh full HTML render can observe identified native `data-kg-id` annotations and simple italicized terms in identified definition Divs. Discovery keeps them private; it does not infer identities from spelling, insert links or modify canonical declarations:

```powershell
quarto run _extensions/kai-prince-sfhea/knowledge-graph-extraction/author.ts discover
quarto run _extensions/kai-prince-sfhea/knowledge-graph-extraction/author.ts help
```

Review explicitly selects candidates and writes a separate private patch/receipt. Merge approved entries into `knowledge.yml` yourself, then render again. New objects default private. Relation proposals have the separate reviewed workflow below; rendering never infers or approves a relation. Mathematical macro extraction is separate from this producer.

AI policy defaults are **EmbeddingGemma 2** (`google/embeddinggemma-2`, 768 dimensions), **Gemma 4 E2B** (`google/gemma-4-E2B`) and disabled **GLiNER2.5 Multi** (`fastino/gliner2.5-multi-v1`). Nested keys are `ai.embedding.model`, `ai.embedding.dimensions` (128/256/512/768), `ai.generation.model`, `ai.extraction.model` and `ai.extraction.enabled`. Enabling GLiNER inference is refused because that execution path is not implemented.

The explicit local encoder uses EmbeddingGemma 2's text-only profile on CPU in float32, its `SearchQuery`/`Document` retrieval prompts and normalized vectors. It refuses inputs over the smaller of the local runtime's sequence limit and 8,192 tokens, including the prefix. Caller-installed Sentence Transformers must support the model; the current official export requires version 6.1.0 or later. See [Google's inference guide](https://ai.google.dev/gemma/docs/embeddinggemma/inference-embeddinggemma-with-sentence-transformers) and [model configuration](https://huggingface.co/google/embeddinggemma-2/blob/main/config_sentence_transformers.json).

When upgrading from 300M, supply a separately reviewed, hash-pinned local EmbeddingGemma 2 artifact/runtime manifest and rebuild both index and query embeddings. Do not rename an old model directory, change an existing vector's model label or mix the two spaces even at the same dimensions. The original 300M encoder remains available through an explicit manifest and its 2,048-token profile. Model, artifact, runtime, dimensions, prefixes, encoding profile and effective token limit distinguish new vectors; existing vector imports must name their encoder explicitly. Optional embedding files and private suggestions are separate from the deterministic graph cache; `build.ts reset` does not migrate or erase them.

Explicit `assist.ts` commands can probe caller-installed runtimes, encode local embeddings, generate local LiteRT-LM suggestions and accept reviewed IDs into a private patch:

```powershell
quarto run _extensions/kai-prince-sfhea/knowledge-graph-extraction/assist.ts help
```

The model commands require a separate version-0 manifest pinning local runtime/model paths, hashes, immutable revisions and licence metadata; project AI preferences do not supply those artifacts. Nothing installs or downloads a model, and **ordinary update/frozen rendering performs no inference**. Model quality and actual artifact compatibility remain unverified. Human acceptance and structural/source checks do not establish factual truth, faithful interpretation or proof validity.

### Propose semantic identities using a local model

The optional `resolve` command considers surrounding prose and proposes existing
identities, including referring expressions such as pronouns. It can leave a
mention unresolved. It cannot create an identity, assert a relationship, insert
a link or approve its own interpretation. Use `disambiguate` below when explicit
author-written context cues are sufficient.

Start a caller-installed OpenAI-compatible local server with your chosen model.
The default alias is `gemma-4-E2B`; the server must actually load the intended
weights. Model names reported by an API are recorded, not treated as artifact
attestation. The extension neither installs nor downloads models. Keep model
weights and caches on the drive you select in that server.

Create a private folder outside your Quarto project and **outside every Git
checkout**, for example `D:/Quarto-Private`. Put `local-server.yml` there:

```yaml
version: 1
provider: local-openai
base-url: http://127.0.0.1:8941/v1
model: gemma-4-E2B
timeout-seconds: 120
max-tokens: 2048
# Optional: name of an environment variable; never the token itself.
# api-key-env: MY_LOCAL_AI_TOKEN
```

Choose the port and model alias used by your server. Only literal loopback
addresses with an explicit port and `/v1` are accepted. Set any required token in
the named environment variable; keep `.env` and credentials outside repository
files. The command does not load `.env` automatically.

Your public project may contain `context-policy.yml` with only public identity
selection rules:

```yaml
version: 1
defaults:
  language: en
  types: [concept]
senses: []
```

Optional `scopes` narrows the eligible catalogue. The explicit `require-any`,
`require-all` and `exclude` sense rules shown below remain binding when supplied.
At most 256 eligible identities and 12,000 source units per selection are
supported; select a smaller catalogue or source interval for larger material.

From the project, run:

```powershell
quarto run _extensions/kai-prince-sfhea/knowledge-graph-extraction/assist.ts resolve --workspace D:/Quarto-Private --source education.qmd --context context-policy.yml --server local-server.yml
```

The command prints paths relative to the private folder for its JSON suggestions
and `.choices.yml` template. Inspect the exact source evidence and proposed
meaning in your editor. For each accepted entry, retain its offered identity and
set `public: true`. Use `id: null` to decline. Then run:

```powershell
quarto run _extensions/kai-prince-sfhea/knowledge-graph-extraction/assist.ts review-resolution --workspace D:/Quarto-Private --suggestions PATH_FROM_PREVIOUS_COMMAND.json --choices PATH_FROM_PREVIOUS_COMMAND.json.choices.yml --server local-server.yml --reviewed --reviewer "Your name"
```

Review writes a separate occurrence patch and receipt in the private folder.
It rechecks source bytes, catalogue, schema, policy, configuration bytes and code.
Changed inputs require fresh proposals. It does not invoke the model again.
Copy only the deliberately selected public `source` occurrence into the matching
existing object's `occurrences` list in `knowledge.yml`, then render normally.
Never copy prompts, raw responses, credentials or review receipts into QMD,
declarations, repository files or website resources. Only already-public text
belongs in source QMD. The external working directory is not an encryption or
access-control service; protect it through your operating system.

The raw-source profile excludes code, comments, raw HTML, conditional/private
Divs and display mathematics. Raw TeX environments conservatively exclude the
remaining source. Ambiguous or unsupported source structure yields no actionable
proposal. Expanded includes and arbitrary Quarto syntax are not reconstructed.
Exact quotes and author approval do not prove semantic correctness. Local AI
drafting is separate from readers' browser AI and from ordinary update/frozen
rendering, which continue to invoke no model.

The resolver supplies an indexed inspection checklist derived from selected prose:
catalogue wording, possible English referring expressions and author context-rule
permissions. A candidate is not a resolved identity; every proposal needs review.
Other languages retain catalogue wording without English pronoun guesses.

In the default indexed reference protocol, the model chooses an existing glossary
identity or null for literal catalogue wording. For a referring expression it
chooses an earlier source candidate key or null; it does not supply another ID.
The extension mechanically inherits the chosen earlier proposed identity and
rechecks current policy. A glossary concept and the contextual example referred
to in prose remain distinct: this does not equate different instances. Earlier
unresolved wording can retain a proposed linguistic reference with a null ID;
it remains unresolved and cannot become a public identity through review.

English demonstratives adjoining catalogue wording form one source phrase, such
as “this field”. A first such phrase can name a catalogue identity. Later
referring phrases receive source-derived earlier-key hints; the hints never
choose a meaning or require a reference. Generic indexed references require
earlier selected catalogue wording sharing a policy-permitted identity. This
finite supported-scope guard is separate from author policy and is not evidence
that a reference is correct. Cataphora and antecedents outside selected source
are unsupported: include the earlier context or use open discovery. Unrelated
subjects and ambiguous references should remain null even when a key is offered.

The extension supplies exact original wording and occurrence numbers. Horizontal
TAB is retained in exact source phrases; other controls, newlines, malformed
Unicode and oversized phrases are refused. IDs, paths and reasons retain their
stricter bounded-text checks. Request candidates, prompt, response schema, raw
response bytes, provenance and method remain bound together. No malformed result
is repaired, and no ID is extracted from a reason. No new YAML setting is needed;
normal rendering still invokes no model.

For phrases outside that finite checklist, add `--discovery open` to `resolve`.
This advanced mode lets the model propose other exact referring expressions;
it also requires the model to supply correct surface occurrence numbers. The
default is `--discovery indexed`. Review automatically uses the saved discovery
mode, so the review command needs no extra flag. An empty indexed selection
stops before inference with `indexed-no-candidates-select-eligible-prose`;
select prose containing catalogue wording, or use open discovery. A larger
selection exceeding the checklist budget must be narrowed.

A fresh ten-case fictional Gemma 4 E2B evaluation of the separated protocol
produced valid wire data in every case, covering all fifteen required mentions
and six references. Nine complete cases passed; one also proposed an incorrect
reference to an aircraft when “It” referred to an intervening checklist. The
model was allowed to abstain. That proposal remains unreviewed and unpublished;
no response was repaired or retried to turn it into a pass. Earlier failures are
preserved separately. These finite observations do not establish general
entity-linking, coreference quality or human acceptance. Review every proposal:
a valid wire response and matching source quote can still express wrong meaning.

### Review ambiguous terminology without a model

The separate `disambiguate` and `review-context` commands offer deterministic
context rules for existing eligible public identities. They require neither a
model manifest nor `authoring: true`, and do not run during rendering. A term's
spelling alone never authorizes a link. For a catalogue with existing mathematical
and educational `action` labels or aliases, an author-written `context-policy.yml`
might contain:

```yaml
version: 1
defaults:
  language: en
  scopes: [mathematics, higher-education]
  types: [concept]
senses:
  - id: math:group-action
    require-any: [group, symmetry]
    exclude: [curriculum]
  - id: he:action
    require-any: [curriculum, teaching]
    exclude: [group]
```

These IDs and namespace prefixes must already exist in your declarations.
Optional `require-all` cues must all be present; a `require-any` list requires
at least one positive cue. `exclude` blocks that sense in the selected context.
The language chooses catalogue labels/aliases; it does not translate prose or
verify language equivalence. Run the command from the project root:

```powershell
quarto run _extensions/kai-prince-sfhea/knowledge-graph-extraction/assist.ts disambiguate --source education.qmd --context context-policy.yml --output .quarto/knowledge-graph/contextual/review.json
```

Use your installed filter's actual directory, which is unqualified after the
tutorial's local installation. The selected QMD must belong to the current
graph scope. The command inspects at most 12,000 selected source characters;
optional `--start`/`--end` choose the source slice. Its conservative prose scanner
excludes code, links, front matter and existing explicit semantic annotations.
An eligible occurrence needs one explicit authored section/Div anchor. Bounded
paragraph context can propose a unique supported sense; competing, insufficient
or blocked context remains ambiguous, unresolved or blocked. This is a lexical
rule helper, not deep language understanding or a complete Quarto parser.

Inspect the private sidecar. Create `context-choices.yml` with `version: 1` and
an explicit `choices` sequence. Each choice copies a sidecar `mentionId`, then
sets `id` to an existing offered identity and `public: true`, or sets `id: null`
to leave that mention unlinked. After actually reviewing those decisions:

```powershell
quarto run _extensions/kai-prince-sfhea/knowledge-graph-extraction/assist.ts review-context --suggestions .quarto/knowledge-graph/contextual/review.json --choices context-choices.yml --reviewed --reviewer "Your name"
```

Review checks the unchanged source, catalogue, schema, policy and algorithm,
and writes a separate private YAML patch plus review receipt. It cannot accept
blocked/excluded senses or invented identities. Canonical declarations, source
prose and links remain unchanged. To publish an approved occurrence, find its
existing canonical object in `knowledge.yml`, copy the reviewed `source` path
and anchor into that object's `occurrences` list, then render normally. Do not
paste the patch's `occurrenceAdditions` field into the catalogue root. Review
sidecars contain source text and must stay private.

### Propose and review relations

Add relation rules to the same context policy used above. For example, with
existing `math:finite-result` and `math:closure` identities and a schema admitting
`requires`, the corresponding policy entries can be:

```yaml
version: 1
id-prefix: math:relation-
defaults:
  language: en
senses:
  - id: math:finite-result
    require-any: [algebra]
  - id: math:closure
    require-any: [algebra]
relations:
  - type: requires
    phrases: [requires]
    direction: forward
```

An explicitly anchored section containing “In algebra, finite result requires
closure.” can then propose that directed relation. Both endpoint identities need
their own positive sense context. Negated, conditional, competing, protected or
unsupported clauses abstain. This finite English cue helper does not establish
that the relation is true or extract arbitrary natural-language logic.

```powershell
quarto run _extensions/kai-prince-sfhea/knowledge-graph-extraction/assist.ts relate --source algebra.qmd --context relation-policy.yml
```

The default inspects the first 12,000 UTF-16 source units; explicit `--start` and
`--end` select another bounded slice. Inspect the private JSON sidecar's exact
source quotes, endpoints, directions and schema before selecting proposed
relation IDs (`record.id`). For an optional existing local model adapter,
pass `--manifest` explicitly;
the same pinned manifest is required during review. Model output has the same
structural, identity and privacy restrictions and is not a truth verdict.

```powershell
quarto run _extensions/kai-prince-sfhea/knowledge-graph-extraction/assist.ts review-relations --suggestions PRIVATE_JSON --ids RELATION_ID --reviewed --reviewer "Your name"
```

This rechecks the original source, declarations, policy, schema and algorithm,
then writes a separate private YAML patch and review receipt. Public eligibility
defaults to `false`; `--public-ids RELATION_ID` is a separate per-relation
publication choice and requires eligible public endpoints. The command never
edits `knowledge.yml`. After review, copy the approved rows into that file's
`relations` list and render. Native destination checks still apply. Source or
policy changes require fresh proposals; a copied hash cannot authorize an edited
endpoint. Review sidecars contain source text and must stay private.

For a model-free pass over every ordinary QMD source in the current graph scope:

```powershell
quarto run _extensions/kai-prince-sfhea/knowledge-graph-extraction/assist.ts relate-project --context relation-policy.yml
```

The command creates a new private directory under `.quarto/knowledge-graph`.
It covers each selected original source with 12,000-unit windows and 2,048-unit
overlap, retaining the original anchor/private-region context and admitting only
complete supported clauses. UTF-16 surrogate pairs and CRLF boundaries remain
intact. It does not expand native includes into one synthetic source document.
Optional `--source algebra.qmd` restricts the job; `--output` must name a new
private directory. Model and manual slice flags are refused for batch work.

Each sidecar uses the same `review-relations` command above. The final private
`index.json` lists source hashes, covered ranges, sidecar hashes, relation groups
and exact evidence. The same clause in overlapping windows is one witness with
both sidecar references; repeated clauses elsewhere keep their own coordinates.
The index is written last, after input freshness and budget checks. A failure
may leave private staging files but never a newly completed index or a changed
canonical graph. Existing output directories are not overwritten.

Finite limits include 256 selected sources, 1,024 windows, 32 MiB of source and
128 MiB of private output, plus a repeated-scan work budget. A large job can be
refused; narrow its scope or use explicitly reviewed individual slices. Every
covered source unit does not imply that every relationship was understood:
window coverage and semantic completeness are reported separately. These are
explicit author commands; normal rendering still performs no inference.

## Versions and updates

The `0.0.x` series has provisional interfaces: even a patch update can invalidate derived caches or change a contract. Declarations and public graphs currently use version 0; cache and portable-baseline formats are versioned separately. Unsupported versions fail rather than silently reinterpret content. Read the [changelog](CHANGELOG.md) before updating.

Preserve canonical sources, schemas, private reviews and reviewed baselines, then try `quarto update kai-prince-sfhea/knowledge-graph-extraction` in an isolated project copy. Make a complete render in **update** mode and review identities, public eligibility, anchors, relations, coverage and exports. Re-export a portable baseline only after that review; changed dependencies can invalidate an older frozen baseline. Reset clears reuse, not schemas or review history. To roll back, restore the matching extension, sources and reviewed baseline together. Retain installed `_extensions` in your project's version control for reproducibility. [Quarto distribution and version selection](https://quarto.org/docs/extensions/distributing.html).

## Security and private data

This experimental extension has no security certification or supported production release. Its publication and integrity checks are bounded safeguards; they do not secure or audit a whole Quarto website. The separate Content Security Protocol extension owns optional site audits; installing this graph extension does not activate an audit.

Only explicitly public graph records are serialized, but ordinary rendered prose and native `data-kg-*` attributes remain visible. Keep `.quarto/knowledge-graph/`, private review/history, prompts, local model manifests and model artifacts out of publication resources. Review resolved paths and all content before sharing output. Cache reset retains private review/history and is not secure erasure.

Schema/model validation messages omit authored vocabulary, unknown field names
and values; safe entry/rule ordinals refer to input iteration, not source lines.
Observation-write failures give a storage remedy without repeating native
filesystem details. Failed local adapters do not replay arbitrary stderr into
their diagnostic. Explicit private suggestion sidecars retain the exact raw
model response for review. These boundaries do not sanitize ordinary native
output, parser/tool exceptions or complete render/CLI logs; keep those private
and redact them before sharing.

Hashes detect corruption or staleness; they do not authenticate a producer or establish truth. Native subprocesses and caller-selected AI adapters execute code and are not confined by `QUARTO_RUN_NO_NETWORK`. That setting controls Quarto's cached import dispatch, not operating-system network access.

Do not put credentials, confidential text, private prompts, unpublished research or personal/learner data in public issues. No private reporting address is configured yet; request a private route from the maintainer without disclosing vulnerability details publicly. Use synthetic reproductions, safe tool versions and redacted diagnostics. Distinguish extension flaws from authored public content, external adapters and hosting configuration.

## Original source coordinates

Keep ordinary Quarto includes. Optionally name the original source files whose
paths and original coordinates you permit in public graph provenance:

```yaml
knowledge-graph:
  source-origins: [_includes/definition.qmd]
```

The selected file must already belong to the inventoried native source/include
closure. The coordinator verifies UTF-8 source hashes, the containing public
occurrence and the complete relevant include closure before publishing
`source-origins.json` in the immutable generation. The main knowledge-graph report links to it.
Other source candidates and source text are not exported. Removing this option
removes that artifact from the next successful publication.

Coordinates are zero-based UTF-16 offsets with an exclusive end. The original
`start`/`end` describe the literal `#ID` token in a supported explicit heading or
fenced Div. An additional `span` describes the whole original heading section or
fenced Div where its lexical boundaries are unambiguous, including an original
definition or proof file. It records `kind`, `start`, `end`, the exact selected
UTF-8 bytes' SHA-256 and `precision: source-structure`. The enclosing origin hash
still binds the whole original file. BOMs, line endings and Unicode are not
normalized. These are source coordinates, not a semantic or formal-proof mapping.
Ambiguous IDs, hidden/conditional content, code, raw HTML/TeX and unsupported
inline syntax remain unavailable. The rendered containing page remains the
canonical navigation destination. Included files remain separate source origins:
the expanded rendered document is not reported as one continuous original span.
Naming a source here does not publish its file
contents or establish reuse rights.

Each available row retains its graph ID, public occurrence identity, semantic
target and rendered destination, plus the permitted original path, source hash,
anchor and token offsets. Resolution checks all relevant source/include
candidates before applying the public-path selection: making only one candidate
public does not resolve a duplicated anchor. An unavailable row has
`sourceOrigin: null` and a generic reason, without candidate filenames, source
hashes or excerpts. Work/size bounds also leave unsupported resolutions
unavailable rather than inventing coordinates. This artifact is separate from
the four-file public export package and changes neither occurrence IDs nor
canonical HTML navigation.

## Licence, transparency and support boundaries

Copyright 2026 Kai Prince. Licensed under **Apache License 2.0**, selected by the repository owner after third-party and AI-assisted contribution review. See the [repository licence](LICENSE) and [packaged licence](_extensions/knowledge-graph-extraction/LICENSE). This covers repository code, examples and documentation unless an explicit notice states otherwise. The minimal example and its bibliography entries are fictional original test material. Your authored research, prose, personal data and graph datasets retain their separate rights.

The extension bundles no Quarto runtime, model weights, ONNX/LiteRT artifacts or browser inference libraries. Quarto supplies Pandoc/Lua, Deno and the `stdlib/path`/`stdlib/yaml` imports under their own terms; consult your Quarto distribution's `share/COPYRIGHT` and `share/COPYING`. Optional assistance uses caller-installed artifacts and libraries without installing or downloading them. Check model, conversion, tokenizer and runtime terms separately; a recorded licence string or hash is not proof of permission.

Generated sites can redistribute extension JavaScript/CSS. Retain their Apache notices and include the provided licence and [copyright notice](_extensions/knowledge-graph-extraction/COPYRIGHT) when sharing those assets. This does not automatically license your research, prose or graph data under Apache 2.0.

**OpenAI Codex assisted development** of code, synthetic fixtures, expected/oracle records, tests, documentation and research/planning. It generated/revised material, investigated failures and helped inspect sources. Automated checks are not an independent human audit; the author retains responsibility for implementation acceptance and publication. This development disclosure is separate from optional runtime AI.

There is no published release yet.

Remaining limits include serial rendering, explicit canonical YAML, no certified assistive-technology behavior, no general cross-platform/Unicode-path promise, and no general real-model quality guarantee. Manuscripts, arbitrary format combinations, browser databases/Prolog, general temporal reasoning, PWA/offline delivery, richer semantic parsing/translation preservation and a live Argumentation Sandbox proof roundtrip remain separate work or research. Deterministic context proposals, public data packaging, progressive details and reading continuity have bounded contracts; they do not establish faithful semantic interpretation, pedagogical effectiveness, FAIR/OER certification or completion of the full KG-0 plan.
