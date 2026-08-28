# card kinds — the compose_board payload contracts

The `compose_board` tool schema carries only the kind index (mcp-token-economy
2026-07-19); the per-kind payload contracts live HERE. The vocabulary is open —
an unknown kind 400s with the full allowed list, and any payload mismatch 400s
with `{code, index}` naming the bad item — so composing without this file is
recoverable, just noisier. Read the section you need before composing an
unfamiliar kind.

Kinds with a whole skill of their own are only indexed here:

- **`diagram`** — a whole architecture page in one card (lanes, groups, typed
  nodes, ports, edges; server-laid-out, refreshable from repo truth). Nodes
  take `icon?: <lucide-name>` — a real glyph before the title on every face (a
  short emoji also works). Full vocabulary: the **artifact** skill
  (`../../artifact/references/diagram.md`).
- **`page`** — a Confluence-grade living document (markdown, repo-file-backed
  refresh, `#E<elemNo>` deep links). Full contract: the **artifact** skill
  (`../../artifact/references/pages.md`).

## Text & basics

- **`text`**: payload `{md, role: idea|note|pro|con|risk|heading|caption}` —
  **full GFM markdown** (md-render 2026-08-15): headings, emphasis
  (`**bold**`/`*em*`/`~~del~~`), ordered/unordered/task lists (`- [x]`),
  tables, blockquotes, `---` rules, images, links, fenced code with language
  highlighting (```` ```ts ````), `$…$` / `$$…$$` katex math, and
  `[!icon <name>]` inline Lucide glyphs (any classic Lucide name, e.g.
  `[!icon zap]`). Raw HTML renders as literal text, never markup; unsafe
  link/image schemes are neutralized. The same renderer serves callout md,
  doc-card leaves, diary, and personal boards.
- **`note`**: payload `{text}`.
- **`shape`**: payload `{shape: rect|ellipse, color}`.
- **`callout`**: payload `{tone: info|warn|success|decision, md}`.
- **`checklist`**: payload `{title?, items:[{text, done?}]}` — interactive,
  users tick items live (state persists on the card).

## `viz` — data-only visualizations

Payload `{viz, data, title?}`:

- `table` `{cols, rows}`
- `matrix` `{x:[lo,hi], y:[lo,hi], points:[{label,x,y}]}` with x/y in 0..1
- `flow` `{steps:[label]}`
- `bars` `{items:[{label,value}]}`
- `timeline` `{items:[{label,when}]}`
- `stat` `{items:[{label,value,delta?,unit?}]}` — KPI stats: ONE editorial
  strip (2026-08-27) — big tabular numerals split by hairline columns, the
  delta inline at the value's baseline, mono micro-label underneath. Never
  tile boxes. `frame: "box"` is a RETIRED alias (accepted, renders the same
  strip) — stop emitting it.

CHARTS (recharts-shaped, real axes/ticks/gridlines/hover-tooltips; huge series
auto-swap to a canvas engine, 100k+ points smooth):

- `line`|`area` `{series:[{label, points:[numbers]}], x?:[labels], min?, max?,
  stack?}` (area supports `stack:true`)
- `scatter` `{series:[{label, points:[[x,y],…]}]}`
- `bars` ALSO accepts `{x:[categories], series:[{label, values:[numbers]}],
  stack?}` for grouped/stacked columns
- `pie`|`donut` `{items:[{label,value}]}`
- `heatmap` `{x:[…], y:[…], values:[[row per y]]}`

HUGE DATASETS: pass the data inline — past ~200 KB the client tooling uploads
it as a board data blob automatically and the card carries `dataRef` instead
(raw API: `POST /api/v1/boards/{slug}/data` → `{dataRef}`, then payload
`{viz, dataRef}`); refresh = re-upload + `update_cards`.

## Frames — `cluster` and `section`

- **`cluster`**: payload `{title?}` — a frame; list member refs in `children`
  and they are laid out inside it. A cluster with payload
  `{title, role:"kanban"}` renders as a status column. An UNTITLED cluster
  renders NO chrome at all — it is the invisible row/col group: "these three
  on one row" is `{kind:"cluster", payload:{layout:{mode:"row"}},
  children:[…]}`, no box, no label, pure flow intent (headed-groups D3
  2026-08-27). Use it liberally instead of letting cards stack into a column.
- **`section`**: payload `{title, description?}` — a NAMED JOURNEY FRAME
  ("Onboarding", "Checkout"): always visible (not on the ✦ eve layer),
  auto-indexed (pill navigation + scrape `sections[]`), membership is spatial
  — cards inside it belong to it; `children` lays the listed refs out inside.
  Frames render as HEADED GROUPS, not boxes: a kicker title plus the optional
  one-or-two-line `description` under it (the border only returns on
  hover/selection), so give sections a description whenever the title alone
  doesn't orient a newcomer. Present the NEXT ITERATION of a journey
  ("Checkout — iteration 2") as its own frame beside the original — never mix
  a new take into the old section.

FRAME NESTING: cluster/section `children` may include other frames (depth ≤5),
and any frame payload may carry `layout {mode: column|row|grid|flow|lanes|
masonry, gap: S|M|L|px, cols, padding}` — the server then owns that frame's
inner flow recursively, forever. Any card may carry `payload.lane` (e.g.
`"iphone"`) — the arrange/auto-layout `lanes` mode groups rows by it.

## UI core elements (data-only, ~100-300 tokens each)

- **`step`**: `{n?, title, note?, status: todo|pass|fail, cardId?, image?:
  {project, branch, selector, file}}` — a numbered journey step that EMBEDS its
  screen: `image` names a file inside a set you already pushed (`vitrinka
  snap/push`) and the step carries it directly — the CANONICAL walkthrough
  shape (one steps-only section, NO separate flow of shot cards; the server
  sizes the card to the screen's true aspect and click opens it full-res).
  `cardId` instead references an EXISTING board card for a live thumbnail (its
  face flips with attach-swaps). Use one or the other; never re-upload a
  screen you can reference.
- **`compare`**: `{a:{cardId}, b:{cardId}, mode: wipe|ghost}` — two existing
  cards' faces behind a wipe/ghost slider (iteration pixel-diff).
- **`wireframe`**: `{title?, device: phone|tablet|web, fidelity?: lo|tokens,
  nodes:[{t, label?, …}]}` — a ~100-250-token LO-FI UI MOCKUP (the cheap
  alternative to an HTML artifact; use it to SKETCH proposed screens): nodes
  render top-to-bottom inside a device frame; `t`: `nav {label}`, `tabbar
  {label: "home · search · profile"}`, `heading {label}`, `text {label?}`
  (omit label for gray placeholder lines), `button {label, primary?}`, `input
  {label = placeholder}`, `img {h: s|m|l}` (crossed placeholder box), `list
  {n: rows}`, `listitem {label?}`, `divider`, `chiprow {label: "a, b, c"}`,
  `modal {label}`; unknown `t` renders as a labeled dashed box. `fidelity`
  defaults `"lo"` (sketchy gray — the brainstorming register); `"tokens"`
  tints primaries.
- **`doc`**: `{title?, nodes:[{t, …}]}` — a declarative node DOCUMENT in ONE
  card (~300 tokens for a dense dashboard): containers `t: row|col {nodes:
  […]}` nest freely; content leaves `t: heading|text {md}`,
  `stat|bars|table|line|timeline|flow|matrix` (same data shape as the viz
  kinds, inline), `checklist {items:[{text,done?}]}` (static), `img`,
  `divider`; inner nodes are pixels (not annotatable) — use real cards when
  structure matters.

## External surfaces

- **`link`**: `{url, mode?: preview|phone|widget|live}` — a WEBSITE card: the
  server unfurls title/og:metadata/favicon async, probes iframe embeddability,
  and (when the capture sidecar is configured) takes real 16:10 desktop +
  phone-viewport screenshots; `preview` = 16:10 face, `phone` = mobile frame,
  `widget` = compact favicon+title row with hover peek, `live` = embedded
  iframe when the site allows framing.
- **`board`**: `{board: "<slug>", title?}` — a PORTAL card: a live minimap
  window into another board (click-through, card/open-thread counts); the
  target board must exist, self-portals 400.
- **`api`**: `{spec: {…}, title?}` — an OpenAPI REFERENCE card: send the WHOLE
  raw OpenAPI 3.x (or Swagger 2) document as a JSON object in `spec` — no
  conversion, no summarizing — and the board renders a browsable
  grouped-endpoints reference (tag groups → method chip · path · summary,
  expandable to parameters/body/responses). The spec must carry
  `openapi`/`swagger`, `paths`, and re-marshal under 512 KB; `title` defaults
  to the spec's `info.title`. Complements the openapi→diagram importer
  (`vitrinka import <spec> --board <slug>`): the diagram face shows shape,
  the api face shows the endpoint contract — one spec, two faces.
- **`artifact`**: a SELF-CONTAINED HTML bundle rendered as a sandboxed iframe
  on the board. Two payload shapes — send ONE, never both:
  - `{html: "<!doctype html>…"}` — full document (must start with
    `<!doctype` or `<html>`, ≤8 MiB; the sandbox CSP blocks EXTERNAL network,
    so no CDNs and no fetch/XHR — inline your own assets). The one exception
    is the pinned `/vendor/…` runtime shelf: script and style from the
    vitrinka host are allowed, so a full document imports React, Recharts,
    kit-2 … instead of inlining them (see `runtime.md`, this directory).
  - `{body: "<div class='p-4'>…</div>", runtime: "tw4"}` — MARKUP ONLY; the
    server wraps it with the vendored Tailwind v4 browser build inlined, so
    you pay tokens for markup only. Prefer this whenever the design fits
    Tailwind utilities — dramatically cheaper.

  Optional: `tokens {accent: "#ff3b57"}` → `:root` custom properties;
  `device: phone|tablet|web` (footprint hint); `title`.

## `chat` — conversation threads (AI-testing transcripts)

A multi-turn conversation as a first-class board card: filled bubbles, grouped
by speaker, with the forensic evidence (timing, tools, model, errors) folded
into a collapsed disclosure under each assistant bubble. Built for AI testing —
the thing you were screenshotting before.

Payload:

```
{title?, participants?: {user: {label}, assistant: {label}}, provenance?,
 messages: [{id?, role: "user"|"assistant"|"system", text, ts?,
             timing?: {ttftMs?, completionMs?}, references?: [cardId],
             tools?: [{name, args?, status?}], model?, error?}]}
```

- **Always send `messages` INLINE** — the server persists them to a board data
  blob and stamps `dataRef` + a summary back onto the card (same mechanism as
  huge `viz` data). Never construct `dataRef` yourself. The messages JSON must
  serialize under **1 MiB**; split a longer run into several cards.
- `text` is markdown-lite, same subset as `text` cards. Unicode, whitespace and
  code fences survive verbatim — a transcript is evidence, so it is never
  re-wrapped or prettified.
- `ts` is ISO-8601. Consecutive same-role messages group into one bubble stack
  (tail on the last), and a day boundary between two `ts` draws a separator.
- `timing` and `tools` feed the disclosure line under an assistant bubble
  ("812 ms · 3 tools"); it expands in place. `tools[].status` is free text —
  `"completed"`, `"failed: timeout"`, whatever the run recorded.
- `error` marks a failed turn (the bubble reads as an error state).
- `model` labels which model produced the turn.
- **`references: [cardId]`** links a message to EXISTING board cards — the
  screenshots that turn produced or talked about. The server materializes
  bubble-anchored region wires: a marker sits on the bubble, hover glows both
  ends, click flies to the shot. Reference cards that already exist (push the
  screens first); a dangling id is dropped.
- `provenance` records where the transcript came from —
  `{source: "eve"|"ndjson"|"compose", ref, importedAt?}`; the CLI importer
  stamps it, and it renders as the strip under the thread.
- Transcripts are IMMUTABLE: to change one, replace the whole payload via
  `update_cards`. There is no per-message mutation.

**Importing instead of composing.** `vitrinka import chat --eve <sessionId>
--board <slug>` folds an eve run (user/assistant turns, tools, timing) into
this payload through vitrinka's eve proxy; `--ndjson <file>` does the same for
a retained transcript. Both run a **pre-publish redaction gate**: emails, phone
numbers, API keys/bearer tokens/JWTs, long high-entropy runs and IBANs are
found before anything is published, and the command REFUSES with a masked
report unless you pass `--redact` (mask them) or `--allow-unredacted`. Compose
a transcript by hand only when you built it yourself.

The gate scans **every surface the card persists**, not just the prose —
findings are reported as `turn N (role) · <surface>`:

- `text` — the bubble
- `tool-name`, `tool-status`, `tool-args` (walked recursively through nested
  objects and arrays — tool arguments routinely echo `Authorization` headers
  and request bodies the bubble never mentions)
- `tool-args-key` — captured args are arbitrary JSON, so object KEYS are
  evidence too (`{"user@example.com": {…}}`); `--redact` rewrites the key and
  keeps its value subtree, suffixing `-2`, `-3` when two keys mask alike so no
  entry is lost
- `error` — a failed turn's message
- `title` — the card title, which an eve import derives from the run itself

`--redact` masks in place, inside the nested structure; non-string values and
clean strings are left untouched.

**`chat-evidence` layout preset** — the built-in template for a testing
readout: `compose_board {template: "chat-evidence", params: {title, shots,
chat}}` composes the provenance/title strip and the thread, and positions the
`shots` you name as a right rail beside the thread. It does not RE-PARENT those
cards — they stay where they belong on the board — so place the referenced
shots first and cite them from the transcript via `message.references`, which
is what draws the bubble-anchored wires.
