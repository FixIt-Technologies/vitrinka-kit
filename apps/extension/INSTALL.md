# Install the Vitrinka Journey Recorder (Chrome / Brave / Edge)

Two ways in, depending on who you are:

- **Chrome Web Store** — the one-click path with automatic updates.
  *(Listing in review — link lands here the moment it is public.)*
- **CLI-managed unpacked install** — for teams using the `vitrinka` CLI: the
  CLI installs the extension, keeps it current, and lets the popup update it
  in place.

Both channels are the same extension with the same id (the manifest pins its
key), so switching between them never loses your server's configuration.

## A. Chrome Web Store

1. Install from the store listing, pin "Vitrinka Journey Recorder" from the
   puzzle-piece menu.
2. Open the extension's **Settings** (right-click the icon → Options): set
   your vitrinka **Base URL** and a **Token** (a `vkp_` personal access token —
   mint one in vitrinka under Settings → tokens). **Save & test**.

## B. CLI-managed unpacked install

```sh
vitrinka extension setup
```

That downloads the current release into `~/.config/vitrinka/extension`,
verifies its checksum, and registers the CLI as a native-messaging host for
every Chromium browser it detects (that registration is what lets the popup
update the extension in place later). Install another browser later and
`vitrinka extension doctor --fix` registers it too.

Then load it once:

1. Open `chrome://extensions` (or `brave://extensions` / `edge://extensions`).
2. Turn on **Developer mode** (top-right toggle).
3. Click **Load unpacked** and pick `~/.config/vitrinka/extension`.
4. Check the id reads `lidjccailicbgjdfaplpgmbmmecehlfo`.
5. Pin "Vitrinka Journey Recorder" from the puzzle-piece menu.

Keep that folder where it is — the CLI updates it in place, and Chrome loads
from it, so moving or deleting it uninstalls the extension.

**Connecting**: with the CLI present there is usually nothing to configure —
on first load the extension asks the CLI for this machine's base URL and token
and fills them in. The options page is only for overrides (or **Fill from the
vitrinka CLI** to re-take what `vitrinka login` saved).

**No CLI and no store?** Download and unzip the latest
`vitrinka-recorder-<version>.zip` release and load that folder instead.
Everything records the same way; only in-place updating needs the CLI.

## Record a journey

- Open the app you're testing. If its domain is mapped to a vitrinka project
  (project settings → domains), the popup shows the resolved project — hit
  **Start**. Other tabs on the same project's domains join automatically.
- The corner HUD shows rec · timer · pause · ✎ note · ⌖ annotate.
  Shortcuts: `Alt+Shift+S` annotate (click an element or drag a region, type
  a note, Enter sends), `Alt+Shift+N` note, `Alt+Shift+P` pause.
- **Stop** (popup) projects the session into a journey board and opens it —
  screenshots wired by your clicks, network failures folded in, timeline
  inspector on the left. ⌖ annotations land as real board annotations.
- Finished a session too early? The popup's **continue a journey** list
  reopens a recent one and appends to the same board.

## Updating

- **Web Store installs** update automatically like any extension.
- **CLI-managed installs**: opening the popup checks for a release. When a
  newer one exists it shows **↑ update to \<version\> — click to install**;
  clicking it is the whole update — the CLI downloads the release, verifies
  its checksum, swaps the folder, and the extension reloads into it. Settings
  survive (they live in `chrome.storage.local`, not in the folder).

  The popup's footer carries the running version and doubles as an explicit
  **check** button. It refuses while a recording is live — a reload would tear
  down the network capture mid-session. Stop first, then update.

  From a terminal instead:

  ```sh
  vitrinka extension update          # install the newest release
  vitrinka extension update --check  # just say whether one exists
  ```

### When something is off (CLI-managed installs)

```sh
vitrinka extension doctor          # check every link in the chain
vitrinka extension doctor --fix    # re-register the host, rewrite the shim
```

`doctor --fix` is the answer after you reinstall the CLI (a global reinstall
can move `node` or the CLI itself, and the host shim bakes both paths in).

### Moving off a hand-unzipped install

The extension pins its id, so a folder you unzipped yourself and the
CLI-managed one are *different extensions* to Chrome. Migrate once:

1. Stop any recording.
2. `vitrinka extension setup`
3. Load `~/.config/vitrinka/extension` as above.
4. **Remove the old card** in `chrome://extensions` — otherwise both copies
   answer `Alt+Shift+…` and both try to record.
5. Re-check the options page: the new install seeds base URL + token from the
   CLI, but a token you pasted by hand into the old copy does not carry over
   (different id, different storage).

## Notes & quirks

- Chrome shows an "is debugging this browser" banner while recording — that
  is the CDP network capture (expected; closing it detaches capture).
- DevTools open on the same tab wins over the recorder: network bodies
  degrade gracefully for that tab.
- The recorder captures request/response bodies, headers, and the DOM by
  design — it is a testing tool for **your own applications and
  environments**. Don't record against third-party production sites. Full
  disclosure of what is captured: `docs/PROTOCOL.md` at the repo root.
- Full capture matrix + known limits: `README.md` in this folder.
