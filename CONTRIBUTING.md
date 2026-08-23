# Contributing

Thanks for your interest in vitrinka-kit. Issues and pull requests are welcome;
note that the project is source-available under the
[Elastic License 2.0](LICENSE), not an open-source license.

## Development setup

Prerequisites: [Bun](https://bun.sh) ≥ 1.1 and Node ≥ 18.

```sh
bun install
bun run --filter '@vitrinka/expo' build   # bob build → packages/expo/build
bun run --filter '@vitrinka/expo' test
```

### Repository layout

- `packages/*` — npm packages under the `@vitrinka` scope. Each package owns
  its `README.md`, `CHANGELOG.md`, and tests.
- `apps/extension` — the Chrome extension (Manifest V3, no build step; `dist.sh`
  zips it for release).

## Pull requests

- Keep changes scoped; one concern per PR.
- `bun run typecheck` and package tests must pass; CI runs both on every PR.
- Anything touching **what data a recorder captures or transmits** must update
  `docs/PROTOCOL.md` in the same PR — that document is a user-facing contract.

## Releases (maintainers)

npm packages release by tag: `expo-vX.Y.Z` → CI builds and publishes
`@vitrinka/expo` with provenance. The extension releases through the Chrome Web
Store on its manifest version.
