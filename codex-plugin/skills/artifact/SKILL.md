---
name: artifact
description: Author content on vitrinka — a standalone interactive document (report, analysis, dashboard), a Confluence-grade page card, an architecture diagram, or a whole living-docs board. Use for "artifact", "vitrinka this", "publish this analysis/report", "make this a page/diagram", "document this repo". Capturing UI work is publish.
metadata:
  vitrinka-contract: "2026-08-30"
---

# artifact — one skill, four authored surfaces

Everything *authored* lands here; everything *captured* (screenshots,
journeys, sessions) is the **publish** skill. Pick the surface, read its
reference, share the core below.

**The element model (2026-09-01):** board and artifact are one thing. Every
authored unit is an **element** (`{kind, payload}` — chart, table, prose,
diagram, mockup, doc, …), the SAME shape as a board card's content; a
standalone artifact is the solo view of one element (`/a/<card>`), and a
semantic push mints/updates a `doc` card on the project's artifacts board —
the push response carries both URLs (field names:
`../publish/references/wire-fields.md`). The vocabulary is **canonical-only**:
the strict element door rejects legacy shapes and retired kind names; look
every shape up, never recall it.
pin: e2e/render-audit.spec.ts#the solo view mounts the board's own faces for every card kind
pin: e2e/render-audit.spec.ts#a fully canonical document mints its doc card and the solo view paints every block, nested diagram included

| Surface | Deliverable | Reference |
|---|---|---|
| **standalone** | self-contained interactive page — report, analysis, review, dashboard, showcase | `references/standalone.md` |
| **page** | Confluence-grade living document card on a board, markdown-native, repo-file-backable | `references/pages.md` |
| **diagram** | ONE architecture diagram card — server-laid-out, refreshable from repo truth | `references/diagram.md` |
| **docs board** | a repo's living documentation board — diagrams + pages + deep links, orchestrated | `references/docs.md` |

Routing when the ask is ambiguous:

- A composed *document to share* (report, analysis, comparison) → **standalone**.
- Prose that lives *on a board* beside other cards, or that mirrors a repo
  markdown file → **page**.
- "Diagram this / how does X fit together", one system picture → **diagram**.
- "Document this repo / living docs / keep the docs in sync" → **docs board**
  (it composes the diagram + page references; read those for payload
  vocabulary, it owns the end-to-end flow).
- UI work in progress, flows, "screenshot as I go" → not here; **publish**.

## Shared core (all surfaces)

- Vitrinka is **WireGuard-mesh-only** (default base `https://app.vitrinka.ai`,
  override `VITRINKA_URL`). Write auth: `VITRINKA_TOKEN` env or `vitrinka
  token` — never echo it; on the public host feed Bearer headers via stdin
  (`printf 'Authorization: Bearer %s' "$TOKEN" | curl -H @- …`), never argv.
- **The deploy documents itself.** Element payload contracts, component
  props, doc.json block shapes, chart forms and the runtime shelf are served
  by the deployment's own layered docs tree — the `docs` MCP tool
  (`artifact_docs` is its alias) or `vitrinka docs <topic>` (no topic → the
  index; three families: element / board / artifact, `family:topic`
  disambiguates collisions) — generated from the validator and kit the
  deploy actually runs, so it never drifts. Look up, don't recall; the
  references here carry workflow and laws, never prop tables.
- **Hand back only server-returned URLs**: a board's `url` field carries
  `/w/<workspace>` — never hand-compose `{base}/boards/<slug>`; a standalone
  artifact hands back the URL `vitrinka push` prints. The link goes in your
  final summary, always.
- **Delegation**: compose-heavy authoring (standalone doc.json/components, docs-board
  narrative) can run in the `vitrinka-publisher` agent, dispatched in the
  background — brief it with this skill's base directory and the surface's
  reference path; it returns the live URL. Capture never delegates (there is
  none here); on runtimes without the agent (Codex), work inline from the
  same references.
- **Apply publisher write-backs**: when the publisher returns `writebacks`,
  validate every `ref` as a safe repo-relative path in the active worktree,
  replace it with the complete supplied `md`, commit and push it with the
  current work, then refresh the matching repo-backed card from pushed
  content. If any item cannot be applied safely, report it and do not claim
  the artifact is complete. `writebacks: none` needs no repo action.
- Boards are live: after creating a board (docs board included), arm the
  listener yourself per the listen skill — a subagent can never arm the
  parent's monitor. A standalone artifact is a page, not a board — nothing to
  listen to.
