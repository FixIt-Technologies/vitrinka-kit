---
name: artifact
description: Author content on vitrinka — a standalone interactive document (report, analysis, dashboard), a Confluence-grade page card, an architecture diagram, or a whole living-docs board. Use for "artifact", "vitrinka this", "publish this analysis/report", "make this a page/diagram", "document this repo". Capturing UI work is publish.
---

# artifact — one skill, four authored surfaces

Everything *authored* lands here; everything *captured* (screenshots,
journeys, sessions) is the **publish** skill. Pick the surface, read its
reference, share the core below.

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
- **Hand back only server-returned URLs**: a board's `url` field carries
  `/w/<workspace>` — never hand-compose `{base}/boards/<slug>`; a standalone
  artifact hands back the URL `vitrinka push` prints. The link goes in your
  final summary, always.
- **Delegation**: compose-heavy authoring (standalone doc.json, docs-board
  narrative) can run in the `vitrinka-publisher` agent, dispatched in the
  background — brief it with this skill's base directory and the surface's
  reference path; it returns the live URL. Capture never delegates (there is
  none here); on runtimes without the agent (Codex), work inline from the
  same references.
- Boards are live: after creating a board (docs board included), arm the
  listener yourself per the listen skill — a subagent can never arm the
  parent's monitor. A standalone artifact is a page, not a board — nothing to
  listen to.
