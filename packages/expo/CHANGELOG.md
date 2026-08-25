# @vitrinka/expo

## Unreleased

- Redaction is now policy-driven via the shared [`@vitrinka/redact`](../redact)
  engine: at session start the recorder fetches the workspace redaction policy
  (`GET /api/v1/recorder/policy`) and applies it to everything it captures —
  extra header names/body keys/patterns, `maskAllText`, and (self-host only)
  `fullFidelity`. A failed fetch fails CLOSED to the built-in defaults.
- Network events now include capped, **redacted** request/response headers
  (`reqHeaders`/`resHeaders`) on both the fetch and XHR paths.
- URL scrubbing now covers the fragment and `;`-separated pairs (the engine's
  dedicated URL transform, shared with the server's ingest backstop).
- Under a `maskAllText` policy, screenshot keyframes are captured at a
  strongly reduced resolution (text unreadable, layout visible).
- Initial release: the journey recorder (`@vitrinka/expo/recorder`), extracted
  from its original in-app home into a standalone package.
  - Navigation-agnostic core; expo-router adapter on
    `/recorder/expo-router`.
  - Pluggable synchronous storage: expo-file-system driver by default,
    opt-in MMKV driver on `/recorder/storage-mmkv`.
  - Hand-rolled HUD glyphs — no icon library, no react-native-svg peer.
  - Expo config plugin (build guard) + `withRecorderStrip` metro helper.
  - Wire contract types on `/protocol`.
