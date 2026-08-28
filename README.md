# vitrinka-kit

The public home of everything [vitrinka](https://vitrinka.ai) installs on your
machines and in your browsers — recorders, client packages, and the browser
extension. The source is published here so you can see exactly what runs on
your device and what data it collects.

> vitrinka is an artifacts library and annotation-board platform: recorders
> capture manual-testing journeys (screenshots, interactions, network calls,
> notes) and publish them to your vitrinka server, where they become reviewable,
> annotatable boards.

## What's in this repository

| Path | What it is |
|---|---|
| [`packages/expo`](packages/expo) | `@vitrinka/expo` — the Expo / React Native toolkit. Today: the journey recorder (`@vitrinka/expo/recorder`). |
| [`apps/extension`](apps/extension) | The **Vitrinka Journey Recorder** Chrome extension — records manual-testing journeys from your browser. |
| [`docs/PROTOCOL.md`](docs/PROTOCOL.md) | What the recorders capture and where it is sent. |
| [`skills/`](skills) | Agent skills for working with vitrinka — generated from the product repo, installable as the `vitrinka` plugin (Claude Code / Codex) or via the skills CLI. |

## Quick start — agent skills

The skills ship through the standard channels — pick yours:

```bash
# Claude Code
claude plugin marketplace add FixIt-Technologies/vitrinka-kit
claude plugin install vitrinka@vitrinka

# Codex
codex plugin marketplace add FixIt-Technologies/vitrinka-kit
codex plugin add vitrinka

# Any skills-CLI agent (Cursor, Copilot, Windsurf, …)
npx skills add FixIt-Technologies/vitrinka-kit
```

The `vitrinka` CLI's `vitrinka install` / `vitrinka skills` drive the same
mechanisms with a status table and a picker. This surface is **generated** —
authored in the product repo and rendered here by its exporter; edits belong
there, not in these files.

## Quick start — Expo recorder

```sh
npx expo install @vitrinka/expo react-native-view-shot react-native-keyboard-controller
```

```jsonc
// app.json
{ "expo": { "plugins": [["@vitrinka/expo", { "allowedProfiles": ["development"] }]] } }
```

```js
// metro.config.js — one required line; the config plugin verifies it
const { withRecorderStrip } = require('@vitrinka/expo/recorder/metro');
module.exports = withRecorderStrip(config);
```

```tsx
// app/_layout.tsx
import { VitrinkaRecorderRoot } from '@vitrinka/expo/recorder';
```

The recorder mounts **only** on builds that explicitly set
`EXPO_PUBLIC_VITRINKA_URL` and `EXPO_PUBLIC_VITRINKA_TOKEN`; on every other
build the entire recorder is stripped from the bundle at compile time. See
[`packages/expo/README.md`](packages/expo/README.md) for the full setup,
including the production-strip guarantees.

## Quick start — browser extension

Install from the Chrome Web Store (link coming with the first public listing),
or load this repository's [`apps/extension`](apps/extension) unpacked. The
extension records only while you explicitly start a session, and only against
the vitrinka server you configure in its options.

## Transparency

These tools observe running applications, so their source is public by design:

- **What is captured** is documented in [`docs/PROTOCOL.md`](docs/PROTOCOL.md)
  and enforced in code you can read here.
- **Where it goes**: exclusively to the vitrinka server URL you configure.
  There is no third-party telemetry and no data leaves your infrastructure.
- **When it runs**: only when explicitly enabled — recorder-enabled Expo builds
  are allowlisted per build profile, and the extension records only during a
  session you start.

## License

Source-available under the [Elastic License 2.0](LICENSE): you may read, use,
modify, and redistribute this software; you may not offer it to third parties
as a managed service. See [`SECURITY.md`](SECURITY.md) for reporting
vulnerabilities and [`CONTRIBUTING.md`](CONTRIBUTING.md) for development setup.
