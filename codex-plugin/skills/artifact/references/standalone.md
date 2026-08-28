# Surface: standalone — self-contained semantic documents

Author a **self-contained artifact** (report, analysis, review, dashboard, showcase) and deploy it to vitrinka. There is **no build step**: pushing the file IS the deployment — the share link is live in under a second, and every re-push updates the same URL instantly. All mechanics run through the vitrinka CLI: `vitrinka <cmd>`.

**Routing note — vitrinka is board-first.** This is the *document* lane. Capturing/sharing UI work in progress (screens, flows, design changes) belongs to the **publish** skill's annotation boards; reach for a standalone artifact only when the deliverable is a composed document, not the UI itself.

**Delegation:** authoring + push can run in the `vitrinka-publisher` agent — see Shared core in `../SKILL.md`. Brief it with this file's path (and the data/narrative it needs); it authors doc.json and returns the live URL.

## The semantic model (default — author doc.json, never HTML)

You supply **meaning**; the kit owns **every visual decision** — palette, type scale, spacing, light + dark, and the design direction. Artifacts follow the viewer's theme automatically (the viewer stamps it into the sandboxed iframe; you do nothing). A semantic artifact cannot come out "white in a dark viewer", and you never spend tokens on hex values or Tailwind classes.

1. **Scaffold**:
   ```bash
   vitrinka artifact-init --slug <slug> --kind <report|analysis> --title "<Human title>"
   ```
   Writes `.vitrinka/artifacts/<slug>/` with a **fixed** `index.html` (never edit it) and a `doc.json` skeleton — the only file you author. From this session's screenshot set instead: `vitrinka artifact-from-set --slug <slug> [--select 1,3-5]` — shots land in `data.json`, sections + `{"kind":"figure","shot":N}` references are pre-composed, you write only the narrative.
2. **Author `doc.json`**: `{meta, blocks}`. Delete the `_help` key when done.
   - `meta`: `title`, `kicker`, `accent` (phrase inside the title, highlighted), `intro`, `chips: [{k,v}]`, `project` (drives the deterministic per-project accent color), `direction`, optional `accentColor` (named: `red coral amber olive teal azure violet magenta`, or `{light,dark}` hexes).
   - `blocks` (nestable via `section`):
     | kind | shape |
     |---|---|
     | `section` | `{label, title, note?, blocks: […]}` |
     | `prose` | `{text}` — blank lines split paragraphs |
     | `stats` | `{items: [{label, value, note?, tone?, spark?: [numbers]}]}` — `tone: good\|warn\|bad` colors the number, `spark` draws a trend line under it |
     | `verdict` | `{state, text?, tone: good\|warn\|bad\|info}` |
     | `chart` | `{viz, title?, data, caption?}` — the board's viz language verbatim: `line\|area\|scatter` take `{series: [{label, points\|values}], x?: [labels], stack?}`; `bars` takes `{series…}` (axis chart) or `{items: [{label, value, tone?, display?}]}` (labeled rows); `pie\|donut` take `{items}`; `heatmap` takes `{x, y, values: [[row per y]]}`. Axes, crosshair, palette and legend are the kit's |
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
   - **The push validates doc.json** (server-side, mirrored as CLI pre-flight): unknown kinds, tone typos, malformed chart data and dimension mismatches REJECT with exact messages; design lint (7+ stats in a row, over-long intro, a finding without evidence) warns and publishes. Fix errors and re-push — nothing broken goes live.
   - **A finding must carry its proof.** `status` renders as a verification chip (`verified`/`confirmed`/`fixed` green · `suspected`/`likely`/`open` amber · `refuted` red); `cause` says what produced the defect; `summary` is the one bold conclusion sentence; `evidence` (string or array) is the mono receipt footer — cite the exact log, file, query or check that proves the claim (`` "prod `auth.log.4.gz` · every IP checked against [api.github.com/meta](https://api.github.com/meta) → 17/17 match" ``). A finding without evidence reads as an opinion.
3. **Pick the direction** (`meta.direction`) — four genuinely distinct identities; a report, a dashboard and a showcase must not look like the same page:
   - `editorial` — vitrinka's warm journey voice; reports of shipped work (default for `--kind report`).
   - `dossier` — cool archival document, serif display, ruled tables; reviews, audits, analyses (default for `--kind analysis`).
   - `terminal` — mono data surface, dense; benchmarks, ops, dashboards.
   - `gallery` — image-forward plates, quiet chrome; UI showcases.
4. **Publish**:
   ```bash
   vitrinka push --root .vitrinka/artifacts/<slug> --title "<Human title>"
   ```
   (`push --source <project/branchSlug/key>` sets the screenshot-set cross-link when the scaffold didn't record it; a successful push persists `--source`/`--title` into `.vitrinka` for later plain pushes.)
5. **Verify with `curl`, never a browser** — the push already proves the sync:
   ```bash
   printf 'Authorization: Bearer %s' "$(vitrinka token)" | curl -s -H @- \
     -o /tmp/art.html -w '%{http_code} %{size_download}\n' <printed-url>/raw/index.html
   ```
   (header via stdin — the token never lands in argv/process lists)
   `200` + a plausible byte count = done. **The link goes in your final summary, always.** Do NOT drive Playwright/Chrome to "check it renders" — the viewer is login-gated; a fresh browser context shows the login wall.
6. **Iterate = edit `doc.json` + push again.** Same key → same URL, updated live.

## The custom escape hatch (`--custom` — interactivity only)

**The gate: `--custom` is for behavior the semantic kit cannot express** — an interactive calculator, a live-filtering dashboard, a clickable prototype. A report, analysis, comparison, or review NEVER needs it: if you are picking hex values or Tailwind classes for prose, you are hand-making ~160 styling micro-decisions the kit already owns — go back to doc.json. `vitrinka artifact-init --slug <slug> --custom` emits the full no-build shell: import map (`react`, `htm`, `kit-1`, `kit-2`, `zipstore-1`), Tailwind v4 in-browser (`/vendor/tailwind.js`), htm bound to React. Rules that keep bespoke from meaning broken:

- **The theme contract in `<head>` is load-bearing.** The scaffold ships `--bg/--surface/--ink/--muted/--rule/--accent` tokens for both themes plus the `vitrinka-theme=native` marker. Style with the tokens (Tailwind arbitrary values read them: `text-[var(--muted)]`); never hardcode a palette, never delete the block. Tailwind's `dark:` variant is rebound to the viewer's theme by the scaffold.
- **kit-1 prefabs are light-editorial only** — on the themed canvas prefer `kit-2` (its `dark:` variants track the viewer) or hand-rolled markup on the tokens.
- **htm renders HTML entities literally** — write `→`, not `&rarr;`. `push` warns when it finds entities inside template literals.
- **Runtime shelf** (all vendored, pinned, mesh-local — `GET /api/v1/runtime` lists the deploy's truth): Recharts, TanStack Table, motion/react, highlight.js, KaTeX, xyflow, `apiref-1`. Beyond it: exact-pinned `https://esm.sh/<pkg>@<x.y.z>` only.
- **Downloads**: `import { makeZip, downloadZip } from 'zipstore-1'` — never hand-write a zip, never pull JSZip. The `/raw` sandbox carries `allow-downloads`; without it the browser silently blocks saves.

## Gotchas

- Push failure (mesh down) writes `.vitrinka-offline` in the artifact dir — warn once, keep the file, re-push later.
- Absolute `/vendor/...` paths only resolve when served by vitrinka — preview by pushing (it's instant), not via `file://`.
- Artifacts render inside a sandboxed iframe with an opaque origin: no cookies, no storage, no parent DOM — never depend on them. All data must be in the pushed file(s).
- The artifact appears in the sidebar under its project's **artifacts** group, labeled by title — pick a real `--title`.
