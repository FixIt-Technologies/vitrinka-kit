---
name: answers
description: "Fallback read: fetch a board's question answers over MCP when the \"Send to Claude\" dispatch didn't arrive or was lost — `get_questions` is the durable record. One-shot. Invoke as /vitrinka:answers [board-slug]; annotation work items are /vitrinka:annotations."
---

# /vitrinka:answers — re-read board answers (dispatch fallback)

The user answered board questions (a brainstorm decision map, a question
wizard) and hit "Send to Claude", but the dispatch never reached you — or it
did and the one-shot `choices[]` payload was lost before you acted on it.
Choices ride the work wire exactly once; **`get_questions` is the durable
record**, so recovery is always one call away.

Argument: an optional board slug (`/vitrinka:answers brainstorm-checkout`).
Without one, use the board this session is already working (the one it
created, published, or listens to); if there is no such board in context, ask —
don't guess across the user's boards.

## Read

Call `get_questions({ board })`. It returns EVERY question with its options,
answer, note rider, ⌖E refs, `answeredBy` actor, and staged/sent state.

- Act only on questions that are **answered AND sent**. Answered-but-staged
  means the user is still composing — "Send to Claude" is the send button;
  never act on staged state.
- Unanswered questions are not yours to fill in. If key ones are still open,
  report which, and wait.

## Act

Record each sent decision (answer + `note` + any ⌖E refs) the way the
brainstorming skill does — into the decision log driving the current work —
then continue whatever the answers unblock. Answers are decisions, not code-fix
items; if the same dispatch failure also swallowed annotation work, follow up
with `/vitrinka:annotations`.
