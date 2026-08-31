# Surface: standalone — self-contained interactive documents

Author a **self-contained artifact** (report, analysis, review, dashboard, showcase) and deploy it to vitrinka. There is **no build step**: pushing the file IS the deployment — the share link is live in under a second, and every re-push updates the same URL instantly. All mechanics run through the vitrinka CLI: `vitrinka <cmd>`.

**Routing note — vitrinka is board-first.** This is the *document* lane. Capturing/sharing UI work in progress (screens, flows, design changes) belongs to the **publish** skill's annotation boards; reach for a standalone artifact only when the deliverable is a composed document, not the UI itself.

**Delegation:** authoring + push can run in the `vitrinka-publisher` agent — see Shared core in `../SKILL.md`. Brief it with this file's path (and the data/narrative it needs); it authors the artifact and returns the live URL.

## ONE scaffold, two ways to fill it

```bash
vitrinka artifact init --slug <slug> --kind <report|analysis> --title "<Human title>"
```

Writes `.vitrinka/artifacts/<slug>/` with an **editable** `index.html` (the component scaffold — import map with `react`, `htm`, `kit-3`, `kit-2`, `zipstore-1`; Tailwind v4 in-browser; the load-bearing theme-token contract) and a `doc.json` skeleton. The scaffold renders `doc.json` through kit-3's `<Doc>` component out of the box. From this session's screenshot set instead: `vitrinka artifact-from-set --slug <slug> [--select 1,3-5]` — shots land in `data.json` and flow into `<Doc doc=${doc} shots=${shots}>`.

There is no fork and no `--custom` flag. You choose *how much* of the scaffold you touch:

- **Data-first (default — cheapest, most validated).** Author only `doc.json`; never open `index.html`. Right for any static report, analysis, comparison, review. The push validates every block server-side and the kit owns every visual decision.
- **Component composition (when the document needs behavior or a block that doesn't exist).** Edit `index.html`: replace or surround `<Doc>` with kit-3 components composed directly in htm. **Compose kit blocks first; write bespoke markup only for what no kit block expresses — never re-implement a kit block.** The kit ships the interactivity that used to force hand-rolling: `SortableTable` (column sort), `Tabs`, `FilterRow` (+ `facetFilters` helper), and chart legends toggle series natively.

```js
import { Page, Hero, Section, Prose, Stats, Finding, FilterRow, facetFilters,
         SortableTable, Tabs, Chart, Doc } from 'kit-3';

function App() {
  const meta = { title, kicker, project };
  return html`<${Page} meta=${meta}>
    <${Hero} ...${meta} />
    <${Stats} items=${stats} />
    <${Tabs} items=${[
      { label: "by PR", panel: html`<${Chart} viz="line" data=${byPr} />` },
      { label: "by day", panel: html`<${Chart} viz="area" data=${byDay} />` },
    ]} />
    <${FilterRow} items=${findings} filters=${facetFilters(findings, "sev")}>
      ${(f) => html`<${Finding} ...${f} />`}
    <//>
  <//>`;
}
```

Full palette: `Page, Section, Prose, Stats, Verdict, Finding, Timeline, Table, SortableTable, Tabs, FilterRow, Code, Figure, List, Compare, Meter, Chart, Chips, Hero, Doc` — same props as the doc.json block shapes below.

## The doc.json vocabulary (shared by `<Doc>` and the components)

`{meta, blocks}`. Delete the `_help` key when done.

- `meta`: `title`, `kicker`, `accent` (phrase inside the title, highlighted), `intro`, `chips: [{k,v}]`, `project` (drives the deterministic per-project accent color), `direction`, optional `accentColor` (named: `red coral amber olive teal azure violet magenta`, or `{light,dark}` hexes).
- `blocks` (nestable via `section`):
  | kind | shape |
  |---|---|
  | `section` | `{label, title, note?, blocks: […]}` |
  | `prose` | `{text}` — blank lines split paragraphs |
  | `stats` | `{items: [{label, value, note?, tone?, spark?: [numbers]}]}` — `tone: good\|warn\|bad` colors the number, `spark` draws a trend line under it |
  | `verdict` | `{state, text?, tone: good\|warn\|bad\|info}` |
  | `chart` | `{viz, title?, data, caption?}` — the board's viz language verbatim: `line\|area\|scatter` take `{series: [{label, points\|values}], x?: [labels], stack?}`; `bars` takes `{series…}` (axis chart) or `{items: [{label, value, tone?, display?}]}` (labeled rows); `pie\|donut` take `{items}`; `heatmap` takes `{x, y, values: [[row per y]]}`. Axes, crosshair, palette, legend and series toggles are the kit's |
  | `compare` | `{a: {label, blocks}, b: {label, blocks}}` — two labeled columns of nested blocks; before/after, on/off, A/B |
  | `meter` | `{items: [{label, value, max, threshold?, unit?, note?, tone?}]}` — a value drawn against its scale with the budget tick visible ("11 ms against the 200 ms bar" as geometry) |
  | `finding` | `{sev: high\|medium\|low, tag?, status?, title, where?, body?, cause?, summary?, cost?, fix?, trace?: {before: {key,dest,note?}, after: {…}}, evidence?}` |
  | `timeline` | `{items: [{when, title, status?, text?, summary?, evidence?}]}` — cards along a dated spine; incidents, investigations, rollouts |
  | `table` | `{columns, rows, caption?}` |
  | `code` | `{lang?, code, caption?}` — highlighted, theme-aware |
  | `figure` | `{src, alt?, caption?}` — or `{shot: N}` into `data.json` |
  | `chips` | `{items: [{k,v}]}` |
  | `list` | `{style: bullet\|check\|number, items: [text]}` |
  | `html` | `{html}` — escape hatch for one bespoke fragment |
- Every string supports `**bold**`, `*italic*`, `` `code` ``, `[text](url)`, and **HTML entities are decoded** — but just write the plain characters (`→`, `·`, `—`), never `&rarr;`.
- **Tone is explicit meaning, never sign-inference.** A number only colors when you state its meaning: `tone: good|warn|bad|neutral` on stats items, table cells (`{v, tone}`), chart/meter items. +79% frame time is *bad* despite the plus sign — say so. No tone (or `neutral`) = default ink, never a guessed color. Table columns take `{label, type: "delta"|"number"}` for mono right-aligned numerals.
- **The push validates doc.json** (server-side, mirrored as CLI pre-flight): unknown kinds, tone typos, malformed chart data and dimension mismatches REJECT with exact machine-readable diagnostics (`{severity, path, message, fix?}` — e.g. `blocks[0].items[2].tone`); design lint (7+ stats in a row, over-long intro, a finding without evidence) warns and publishes. **Mechanical mistakes are autofixed at preflight** (unique edit-distance-1 enum typos, HTML entities outside code/html blocks, BOM, trailing commas) — the CLI prints `fixed: <path> <what>` lines and rewrites `doc.json`; `--no-fix` disables. Ambiguous near-misses stay errors carrying a `fix` suggestion. Fix errors and re-push — nothing broken goes live.
- **Directly-composed components validate their own props at runtime** — invalid props render a loud in-page error block with the exact path (`stats.items[2].tone: "goood" is not one of …`) in place of that component only; the rest of the page still renders. The `<Doc>` path stays lenient (its input already passed the server gate).
- **A finding must carry its proof.** `status` renders as a verification chip (`verified`/`confirmed`/`fixed` green · `suspected`/`likely`/`open` amber · `refuted` red); `cause` says what produced the defect; `summary` is the one bold conclusion sentence; `evidence` (string or array) is the mono receipt footer — cite the exact log, file, query or check that proves the claim. A finding without evidence reads as an opinion.

**Pick the direction** (`meta.direction`) — four genuinely distinct identities; a report, a dashboard and a showcase must not look like the same page: `editorial` (warm journey voice; shipped-work reports, default for `--kind report`) · `dossier` (cool archival document, serif display; reviews, audits, default for `--kind analysis`) · `terminal` (mono data surface, dense; benchmarks, ops) · `gallery` (image-forward plates; UI showcases).

## DESIGN.md steers the style

A repo `DESIGN.md` (the [google-labs design.md format](https://github.com/google-labs-code/design.md): YAML frontmatter tokens + prose rationale) is the artifact style authority. Resolution is server-side, most-specific-first: **repo `DESIGN.md` ▸ the workspace DESIGN stored on the server (settings-editable) ▸ kit presets** (the four directions). `set push` discovers the repo file by the same walk-up as `.vitrinka/project.json` and sends it with every artifact push — you'll see `design: <path>` in the narration; `--no-design` skips. Never run the npm linter yourself; the server validates and its findings ride the push diagnostics.

- **Frontmatter tokens set kit defaults deterministically** — colors and type map onto the theme tokens, and the vitrinka `artifact:` extension key (`direction` / `accent` / `density` / `type`) seeds the kit's direction and accent.
- **The prose body is the style brief** for bespoke parts — `artifact init` quotes it into the scaffold's guidance comment so the design language sits where you compose.
- **Artifact meta always wins**: an explicit `meta.direction` / `meta.accentColor` overrides DESIGN tokens; DESIGN fills in only what the artifact doesn't say.

## Rules that keep composed pages from meaning broken

- **The theme contract in `<head>` is load-bearing.** The scaffold ships `--bg/--surface/--ink/--muted/--rule/--accent` tokens for both themes plus the `vitrinka-theme=native` marker. Bespoke markup styles with the tokens (Tailwind arbitrary values read them: `text-[var(--muted)]`); never hardcode a palette, never delete the block. Tailwind's `dark:` variant is rebound to the viewer's theme by the scaffold. Kit components theme themselves.
- **htm renders HTML entities literally** — write `→`, not `&rarr;`. `push` warns when it finds entities inside template literals.
- **Runtime shelf** (all vendored, pinned, mesh-local — `GET /api/v1/runtime` lists the deploy's truth): Recharts, TanStack Table, motion/react, highlight.js, KaTeX, xyflow, `apiref-1`. Prefer the kit's own `Chart` before reaching for Recharts. Beyond the shelf: exact-pinned `https://esm.sh/<pkg>@<x.y.z>` only.
- **kit-1 prefabs are light-editorial only** — don't use them on the themed canvas; kit-3 components and `kit-2` are theme-correct.
- **Downloads**: `import { makeZip, downloadZip } from 'zipstore-1'` — never hand-write a zip, never pull JSZip. The `/raw` sandbox carries `allow-downloads`; without it the browser silently blocks saves.

## Publish, verify, iterate

```bash
vitrinka push --root .vitrinka/artifacts/<slug> --title "<Human title>"
```

(`push --source <project/branchSlug/key>` sets the screenshot-set cross-link when the scaffold didn't record it; a successful push persists `--source`/`--title` into `.vitrinka` for later plain pushes.)

**Verify by looking at the render the push hands back.** On deploys with the capture sidecar (the SaaS included), a successful push smoke-renders the published page and returns:

- **`render.png` beside the artifact** (`.vitrinka/artifacts/<slug>/render.png`) — a full-page screenshot of the real themed render. **Read that image**; it is the proof the page renders, not just serves.
- **Render diagnostics** (`render.console[i]`, `render.root`) printed by the push — a `ReferenceError` or a blank root arrives as an error diagnostic even though the push itself succeeded. Treat any render error as unfinished work: fix and re-push.
- `--no-render` skips the wait; air-gapped deploys without a sidecar degrade to one info diagnostic and no screenshot.

Where no screenshot is available, fall back to `curl`, never a browser:

```bash
printf 'Authorization: Bearer %s' "$(vitrinka token)" | curl -s -H @- \
  -o /tmp/art.html -w '%{http_code} %{size_download}\n' <printed-url>/raw/index.html
```

(header via stdin — the token never lands in argv/process lists.) **The link goes in your final summary, always.** Do NOT drive Playwright/Chrome to "check it renders" — the viewer is login-gated; a fresh browser context shows the login wall, and the push's own render already saw the page.

**Iterate = edit `doc.json` (or `index.html`) + push again.** Same key → same URL, updated live. Kit-rendered blocks keep improving retroactively with every deploy — one more reason to compose kit blocks instead of bespoke markup.

## Gotchas

- Push failure (mesh down) writes `.vitrinka-offline` in the artifact dir — warn once, keep the file, re-push later.
- Absolute `/vendor/...` paths only resolve when served by vitrinka — preview by pushing (it's instant), not via `file://`.
- Artifacts render inside a sandboxed iframe with an opaque origin: no cookies, no storage, no parent DOM — never depend on them. Root-level `*.json` is inlined by the serve-time adapter (that's how the scaffold's `fetch('./doc.json')` works); never add a cookie-dependent fetch.
- The artifact appears in the sidebar under its project's **artifacts** group, labeled by title — pick a real `--title`.
- The project slug comes from the committed `.vitrinka/project.json` (walked up from cwd); pass `--project` only to override it.
