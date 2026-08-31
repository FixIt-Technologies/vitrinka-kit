# Surface: standalone — self-contained interactive documents

Author a **self-contained artifact** (report, analysis, review, dashboard, showcase) and deploy it to vitrinka. There is **no build step**: pushing the file IS the deployment — the share link is live in under a second, and every re-push updates the same URL instantly. Capturing UI work in progress belongs to the **publish** skill; delegation to `vitrinka-publisher` per Shared core in `../SKILL.md`.

## Workflow

1. **Scaffold**: `vitrinka artifact init --slug <slug> --kind <report|analysis> --title "<Human title>"` → `.vitrinka/artifacts/<slug>/` with an editable `index.html` (import map: `react`, `htm`, `kit-3`, `kit-2`, `zipstore-1`; the load-bearing theme contract) and a `doc.json` skeleton that renders through kit-3's `<Doc>` out of the box. From this session's screenshot set instead: `vitrinka artifact-from-set --slug <slug> [--select 1,3-5]`.
2. **Fill** — data-first by default: author only `doc.json`, never open `index.html`; the push validates every block server-side and the kit owns every visual decision. Compose components only when the document needs behavior or a block that doesn't exist: edit `index.html`, replacing or surrounding `<Doc>` with kit-3 components in htm.
3. **Look up, don't recall.** Every shape table, prop list, chart form and component palette lives in the deploy's own docs layer — `artifact_docs(topic)` over MCP, or `vitrinka docs <topic>` (`vitrinka docs` for the index). Topics: `docjson` (the block vocabulary), `charts` (the viz language), `scaffold`, `theme`, `shelf` (the vendored runtime), `design`, `gotchas`, plus one per kit component (`stats`, `chart`, `finding`, `table`, `compare`, `meter`, `timeline`, …). The docs are extracted from the kit the deploy actually serves, so they never drift — trust them over anything remembered.
4. **Push**: `vitrinka push --root .vitrinka/artifacts/<slug> --title "<Human title>"`.
5. **Verify, then iterate**: read the push's diagnostics AND `render.png` beside the artifact — the proof the page renders, not just serves. A render error (`render.console`, blank `render.root`) is unfinished work even though the push succeeded: fix and re-push (same key → same URL). doc.json mistakes reject with exact machine-readable diagnostics; mechanical typos are autofixed at preflight (`fixed:` lines, `--no-fix` disables). Diagnostics carry `see` pointers into the docs layer — follow them.

## Laws that stay in force while composing

- **Compose kit blocks first; never re-implement a kit block.** Bespoke markup only for what no block expresses — kit-rendered blocks keep improving retroactively with every deploy.
- **The theme contract in `<head>` is load-bearing**: bespoke markup styles with the tokens (`--bg/--surface/--ink/--muted/--rule/--accent`; Tailwind arbitrary values read them: `text-[var(--muted)]`) — never hardcode a palette, never delete the block.
- **htm renders HTML entities literally** — write `→`, `·`, `—`, never `&rarr;`.
- **Tone is explicit meaning, never sign-inference.** A number only colors when you state its meaning (`tone: good|warn|bad|neutral`) — +79% frame time is *bad* despite the plus sign.
- **A finding must carry its proof**: `status`, `cause`, `summary`, `evidence` — the exact log, file, query or check. A finding without evidence reads as an opinion.
- **A repo `DESIGN.md` is the style authority** (tokens + prose brief; discovered and sent with every artifact push — `design: <path>` in the narration; resolution is server-side: repo ▸ workspace DESIGN ▸ kit presets; explicit `meta.direction`/`meta.accentColor` always win). Pick `meta.direction` deliberately — `editorial · dossier · terminal · gallery` are four genuinely distinct identities.
- **Never drive Playwright/Chrome to "check it renders"** — the viewer is login-gated and the push's own render already saw the page. Where no screenshot came back, fall back to a token curl (Bearer header via stdin, never argv). **The link goes in your final summary, always.**
- The artifact appears in the sidebar under its project's **artifacts** group, labeled by title — pick a real `--title`. The project slug comes from the committed `.vitrinka/project.json`; `--project` only overrides.

Everything else — block shapes, meta fields, chart data forms, the runtime shelf, sandbox and offline gotchas — is `vitrinka docs`, not this file.
