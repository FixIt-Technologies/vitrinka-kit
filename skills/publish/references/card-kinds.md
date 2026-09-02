# card kinds — index + doctrine (shapes live in the docs verb)

Payload shapes are NOT in this file. The deploy documents itself: call the
`docs` MCP tool (no topic → the index; `docs {topic:"<kind>"}` → the
contract with an example) or `vitrinka docs <kind>`. The tree is generated
from the validator, so it never drifts — trust it over anything remembered.
This file keeps only the kind index, routing advice, and cross-cutting
doctrine. The vocabulary is **canonical-only** (migrate-and-drop, 2026-09-01):
legacy `viz`/`wireframe` payload shapes are rejected by the strict element
door — compose `chart`/`mockup` per their docs topics.

## Element kinds (one vocabulary — board card, doc block, or solo artifact)

`chart` · `table` · `prose` · `page` · `diagram` · `mockup` · `compare` ·
`meter` · `stat` · `code` · `figure` · `media` · `html` · `doc` — each is a
`docs` topic carrying the exact payload contract. The same shape works as a
board card, nested inside a fractal `doc`, and full-screen at its solo `/a/…`
URL. Highlights the index alone won't tell you:

- **`chart`** — one charting language, eleven vizes over three data slots
  (series / items / grid). Data past the spill threshold: send inline anyway —
  the server spills to `dataRef` and board reads carry a summary.
- **`table`** — database-grade: typed columns, keyed rows, saved
  filter/sort/group views, aggregates. Humans edit cells in place; compose
  canonical keyed rows, never positional arrays.
- **`diagram`** — semantics only, server layout; the quality loop and import
  paths are the artifact skill's `references/diagram.md`.
- **`page`** — markdown truth; the round-trip vocabulary is the artifact
  skill's `references/pages.md`.
- **`mockup`** — frames of primitive trees, the cheap UI sketch; direct
  drag/resize editing on the board.
- **`doc`** — the fractal composite: `{title?, elements:[…]}` of the kinds
  above. This is what `vitrinka push` mints from a semantic artifact.
- **`html`** — the sandboxed escape hatch when no hard component fits; also
  accepts the `{body, runtime:"tw4"}` markup-only form (server wraps it).
  Sandbox CSP allows only the pinned `/vendor/…` shelf (`runtime.md`, this
  directory) — no CDNs, no fetch.

## Board-level kinds (spatial / capture-born — not elements)

- **`text`** `{md, role}` · **`note`** `{text}` · **`shape`** · **`callout`**
  `{tone, md}` · **`checklist`** (interactive, state persists) — see their
  docs topics; text md is full GFM + `$…$` math + `[!icon <name>]`.
- **`cluster`** / **`section`** — the frames. Doctrine: untitled cluster = the
  invisible row/col group (use liberally; never let cards stack into a
  column); section = a named journey frame, always visible, auto-indexed;
  next iteration of a journey gets its OWN frame beside the original. Nesting
  ≤5; frames may carry `layout {mode, gap, cols}`; any card may carry
  `payload.lane`. Full doctrine: `docs {topic:"board:sections"}` and
  `board:composing`.
- **`step`** — a numbered journey step embedding its screen (`image` from a
  pushed set, or `cardId` for a live thumbnail — never re-upload a screen you
  can reference). The canonical walkthrough shape: one steps-only section.
- **`compare`** — two existing cards behind a wipe/ghost slider
  (`{a:{cardId}, b:{cardId}, mode}`); the element `compare` (fractal sides)
  is the docs topic of the same name in the element family.
- **`link`** (website unfurl) · **`board`** (live portal; self-portals 400) ·
  **`api`** (whole OpenAPI 3.x/Swagger 2 doc in `spec`, ≤512 KB re-marshaled;
  complements the openapi→diagram importer — one spec, two faces).
- **`chat`** — a transcript is EVIDENCE: messages always sent inline (server
  stages to a blob + `dataRef`; ≤1 MiB serialized, split longer runs),
  byte-exact whitespace, immutable (replace whole payload to change).
  `references:[cardId]` draws bubble-anchored wires to existing shots — place
  shots first. **The redaction gate is law**: `vitrinka import chat --eve <id>`
  / `--ndjson <file>` scans EVERY persisted surface (text, tool names/status/
  args recursively, arg KEYS, errors, title) for emails, phones, keys/JWTs,
  high-entropy runs, IBANs — and REFUSES with a masked report unless
  `--redact` (masks in place) or `--allow-unredacted`. Compose a transcript by
  hand only when you built it yourself. `chat-evidence` template composes the
  readout strip + right-rail shots (cites via `message.references`; it never
  re-parents).
- Upload-born kinds (`shot`/`media`/`file`/`site`) are minted by their doors,
  never composed.

## Cross-cutting doctrine

- **Batch-or-bust**: one `compose_board` call per thought; intent
  (section/anchor/layout), never coordinates — `docs {topic:"board:composing"}`.
- Payload mismatches 400 with `{code, index}` naming the bad item and a `see`
  pointer into the docs tree — follow it; composing without a topic page is
  recoverable, just noisier.
- Kinds with a whole workflow of their own: `diagram` and `page` →
  the **artifact** skill's references (quality loop, imports, round-trip,
  deep links).
