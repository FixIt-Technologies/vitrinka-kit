# Changelog

## 0.1.0

Initial release: the shared recorder redaction engine.

- Policy-driven rule compilation (`compileRules`) with built-in safe defaults
  mirroring the vitrinka server's ingest engine: auth-bearing header names
  (plus the `…api-key`/`…token` suffix rule), sensitive body keys (normalized
  matching, so `card_number` ≡ `cardNumber`), and URL parameter scrubbing for
  query AND fragment, split on both `&` and `;`.
- Token-based key matching on top of the defaults (`X-Dev-Auth-Secret`,
  `otpCode`, `user_password_hash` are caught without being listed).
- Surface transforms: `redactHeaders` (with value/budget caps), `redactBody`
  (JSON structural with recursion guard, form-encoded, multipart/form-data,
  truncated-JSON key fallback), `redactUrl`, `redactText`, `redactAndCap`
  (shape-aware redact/cap ordering), `maskDirectives` (rrweb-style DOM
  recorders), `pixelPolicy` (screenshot recorders).
- Workspace policy extensions: `extraHeaders`, `extraBodyKeys`, `patterns`
  (each compiled in its own try/catch; a bad pattern is skipped, never fatal),
  `maskAllText`, `fullFidelity` passthrough.
- Language-agnostic `spec/REDACTION-SPEC.md` + `spec/vectors.json`
  conformance suite for ports to other recorder platforms.
