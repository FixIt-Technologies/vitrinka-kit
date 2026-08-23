# What the recorders capture, and where it goes

This document is a user-facing contract. Any change to what a recorder
captures or transmits must update it in the same PR (enforced by review; see
`CONTRIBUTING.md`), and divergence between this document and the code is
treated as a security issue.

## Where data goes

Exclusively to **the vitrinka server you configure** (base URL + bearer
token). There is no third-party telemetry, no analytics SDK, and no traffic to
any host other than that server. The wire types live in
[`packages/expo/src/protocol`](../packages/expo/src/protocol/index.ts) and ride
four routes:

```
POST  /api/v1/sessions             create a recording session
POST  /api/v1/sessions/:id/events  the event stream (batched)
POST  /api/v1/sessions/:id/shot    screenshot keyframes
PATCH /api/v1/sessions/:id         status (recording | paused | done)
```

## When recording happens

Only during a session you explicitly start:

- **Expo recorder**: recording exists only in builds that bake recorder env
  (`EXPO_PUBLIC_VITRINKA_URL` + `_TOKEN`); every other build strips the whole
  recorder from the bundle at compile time. Within an enabled build, capture
  runs only between you pressing record and stop (or a machine-driven session
  started over the Expo devtools channel, shown by a visible HUD indicator).
- **Browser extension**: capture runs only in tabs matching the project's
  configured domains, only while a session you started is live. The popup
  always shows the recording state.

## What is captured (per session)

| Channel | Expo recorder | Browser extension |
|---|---|---|
| Screenshots | keyframes on navigation/touch (throttled) | keyframes + rrweb DOM stream |
| Interactions | tap coordinates + pressed-element label + route | clicks, navigation |
| Network | method, URL, status, duration, capped request/response bodies | API calls incl. bodies (via CDP) |
| Console | errors/warnings | errors |
| Notes | notes you type in the HUD | notes you type in the popup |

## Redaction

Network capture redacts secrets **before anything is buffered or sent**:
secret-named keys (`password`, `token`, `authorization`, `cookie`, `apikey`,
multi-word forms like `accessToken`/`refreshToken`, …) are masked in JSON
bodies, headers, and URL query strings, including URL-encoded and
double-encoded forms. The policy is one shared predicate
([`capture/redact.ts`](../packages/expo/src/recorder/capture/redact.ts)) with
its own test suite. Screenshots are not content-filtered — do not record
against screens showing data you would not put on the session's board.

## Retention & access

Recorded sessions live on your vitrinka server under its access rules; the
recorders keep only an undelivered upload tail on-device (removed once
delivered or when the session is discarded).
