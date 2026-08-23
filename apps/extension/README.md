# Vitrinka Journey Recorder (browser extension)

Records manual-testing journeys — screenshots, clicks, API calls (full bodies
via CDP), console errors, rrweb DOM stream, quick notes — into vitrinka as a
live session that projects onto a journey board with the tab-lanes timeline
sidebar. What is captured and where it goes: `docs/PROTOCOL.md` at the repo
root — the source in this folder is public precisely so you can verify it.

## Install (dev)

1. `chrome://extensions` → Developer mode → **Load unpacked** → `apps/extension/`.
2. Open the extension's **Settings** (or right-click the icon → Options): set
   your vitrinka base URL (a hosted instance, or a local
   `http://127.0.0.1:8896`) and a token when the instance requires one.
3. In vitrinka, give the project its domain rules
   (`PUT /api/v1/projects/{project}/settings`), e.g.
   `{"domains":[{"pattern":"*.staging.example.com","environment":"development"}]}` —
   the popup shows which project/environment the current tab resolves to.

Loading `apps/extension/` straight from the checkout is the dev flow; testers
install the released folder via `vitrinka extension setup` (see `INSTALL.md`).

## Updates (how the popup can install one)

An unpacked extension never auto-updates, but Chrome re-reads the whole folder
on `chrome.runtime.reload()` — so an update is "swap the files, then reload".
The extension cannot write its own folder, so the `vitrinka` CLI does it, reached
over a native-messaging host (`in.vitrinka.updater` → `vitrinka extension host`,
4-byte-length + JSON frames on stdio). Three commands: `config` hands the
extension this machine's base URL + token, `check` compares the folder on disk
against the marketplace, `update` downloads + checksum-verifies + swaps.

Two things to know before touching any of it:

- **`manifest.json` pins `key`.** An unpacked extension's id is otherwise a hash
  of its install path, and the host manifest's `allowed_origins` must name one
  fixed id — so the key is what makes the pair line up on every machine. It is
  a public key; nothing there is secret. Changing it changes the id, which
  orphans every installed copy's `chrome.storage.local`. `extension.test.ts`
  asserts the key still derives `lidjccailicbgjdfaplpgmbmmecehlfo`.
- **`version.js` is shared** by the worker and the popup so both answer "is
  there an update?" identically; the CLI's `compareVersions` is pinned against
  it by the same test. Anything added to the folder must also be listed in
  `dist.sh`, or the release ships an extension that dies on first import.

Without the host (no CLI on the machine) every path above degrades to the old
manual banner — download, unzip over the folder, ↻.

## Use

- **Start** from the popup on any tab whose host matches a project rule. Other
  tabs on the same project's domains join the session automatically (multi-tab
  journeys: admin + web side by side).
- The **corner HUD** shows rec · timer · a sync glyph · pause · ✎ note · ⌖
  annotate. Shortcuts: `Alt+Shift+S` annotate (click an element OR drag any
  region, note, Enter sends), `Alt+Shift+N` note, `Alt+Shift+P` pause.
- **The glyph is the health answer** (honest-health design): `✓` once the server
  confirms it holds everything captured, `⟳` while a backlog drains, `⚠` when
  vitrinka is unreachable, `⛔` when the session was closed or deleted
  server-side. Only trouble unfolds a second line; the popup carries the full
  picture (queued items, bytes on disk, last sync, server-confirmed seq).
- **⌖ annotations become real board annotations** on the exact frame you
  snapped — open, assigned to claude, dispatchable through the normal
  annotation work wire.
- **Continue a journey**: the popup lists the project's recent finished
  sessions — Continue reopens one, the event stream resumes from its last
  sequence, and stop appends the new steps to the SAME set + board.
- **The board is live** (by design): a recording session is projected as you work, so
  it is there to open mid-test — screenshots wired by your clicks, notes and
  failed requests folded into shot meta, the timeline inspector (filters ·
  search · per-step network detail) on the left.
- **Stop** closes the session, showing the real upload drain rather than a
  frozen button; closing the popup is safe, the worker finishes either way.
  Reaching the board is a **separate act**: the popup grows an
  `⧉ Open board` row and a notification fires when the server has finished
  building it. Stopping never hijacks a tab.

## What gets captured

| what | how | notes |
|------|-----|-------|
| screenshots | `captureVisibleTab` on click/nav/snap, throttled | active tab only; background tabs catch up on tab-switch |
| clicks | content script (capture phase) | selector, text, element rect in image px |
| navigation | `webNavigation` (full + SPA history) | no page-world patching needed |
| network | `chrome.debugger` CDP, XHR/fetch/document + worker/SW targets | req+resp bodies capped 64 KiB, headers capped 8 KiB/side; WS connections logged (frames NOT captured yet); degrades gracefully when DevTools holds the tab |
| DOM stream | rrweb (vendored record bundle, `inlineImages` + `collectFonts` on) | uploaded as chunks; failed uploads retry from a disk-backed queue; watched via the board's session Watch mode (scrub replay); no-CORS cross-origin images can't inline and stay hotlinked |
| console errors | CDP `Runtime` (page world, incl. uncaught exceptions) | |
| notes / snaps | HUD | ⌖ = element pick OR region drag + note + forced screenshot → board annotation |

Capture-everything is a deliberate design decision: this is a testing tool
for your own applications and environments, where full request/response
bodies are exactly the evidence a journey board needs. The corollary is a
rule, stated wherever the extension is documented: record only against
environments you own. Redaction-before-capture is the planned hardening for
any exposure beyond that trust boundary.

## Known limits

- `chrome.debugger` shows Chrome's "is debugging this browser" banner while
  recording (a deliberate tradeoff: CDP is the only way to full network bodies) and cannot attach while DevTools is open on the
  same tab — recording continues without network capture.
- The capture queue is **IndexedDB** (`db.js`) and the small hot state
  (config, session) is `chrome.storage.local` — SW restarts AND full browser
  restarts keep the undelivered tail, which drains on the next launch. Only
  requests mid-flight across a SW restart lose their response body.
- **Nothing is ever dropped to make room** (by design): the queue grows for as long as
  vitrinka is unreachable and the HUD turns loud instead. Space is reclaimed by
  reaping sessions the SERVER reports as done/deleted/gone — a live recording
  is never touched — and Settings shows per-session usage with a manual clear.
- `vendor/rrweb-record.min.js` is `@rrweb/record@2.1.1` (`dist/record.umd.min.cjs`),
  vendored verbatim. UMD global is the module object (`rrwebRecord.record`);
  content.js adapts to both shapes. The version pins the server's replay bundle
  `internal/web/static/vendor/rrweb-replay-2.js` — bump them together, and bump
  the replay bundle's `-N` suffix when you do: `/vendor` is immutable-cached for
  a year, so replacing its bytes under the same name strands every returning
  viewer on the old replayer (see the vendor README's `-1` → `-2` note).
