---
name: tasks
description: "Work a project's task engine from the repo — file and triage intake drafts, comment, label, rank, link, bulk-move, search, sprint start/complete, and author automation rules (dry-run first). Invoke as /vitrinka:tasks [list|intake|file|rule] FROM THE APP'S REPO; the same verbs exist as MCP tools and `vitrinka task|sprint|intake`."
metadata:
  vitrinka-contract: "2026-08-30"
---

# /vitrinka:tasks — the task engine, agent side

Tasks are a relational engine (PM overhaul 2026-09-03): configurable states in
five fixed groups, item types, labels, comments with @mentions, a manual rank,
multi-assignee, typed attachments (session · shot · board · file · pr · run),
an **intake** lifecycle for proposals, a durable `task_events` ledger, saved
filter views, rules, and a per-project Jira mirror. Boards only ever carry a
projection card of a task. Everything below is one MCP tool or one CLI verb;
there is nothing an agent can do that a human cannot see and undo.

## Vocabulary

- **State groups** are universal: `backlog · unstarted · started · completed ·
  cancelled`. A project's **states** (`list_states`) are keys inside those
  groups; every project starts with the six legacy statuses as states, so
  `status` still works and is derived from the state's group.
- **Types**: `task · bug · story · epic`; a parent task rolls its children up.
- **Rank** is a string; `rank_task {before, after}` moves, `list_tasks` with
  the filter document `{order: "rank"}` reads it.
- **Refs** attach a task to the evidence: `add_task_ref {kind, ref, meta}`.
  A `pr` ref is `owner/repo#n`; the GitHub App webhook attaches it for
  branches or PRs carrying `vt-<id>`, and `meta.merged = true` completes the
  task through a built-in rule.
- **Intake drafts** are tasks with `intake = pending`. They never appear in
  normal lists; `list_intake` shows them with a dedupe verdict
  (`new | likely-duplicate` + candidate tasks and trigram scores).

## Filing work

- **You are sure it is a task** → `create_task` (or `vitrinka task create`).
  Attribution rides your token; never pass `reporter` unless you replay
  history with an admin token.
- **You are proposing** — a session distilled into findings, a "file these"
  from a chat, an annotation → `propose_tasks {project, source, drafts}`.
  The pipeline dedupes each draft against open tasks and stores the verdict;
  a human (or an agent token) accepts, declines or merges with
  `intake_verdict`. Say which drafts came back `likely-duplicate` and of what.
- **Filing from a bug report** happens on approve without you: the report
  becomes an accepted `bug` task, then the tracker ticket mirrors it.

## Working a task

1. `get_task` for the full row; `list_comments` and `GET /tasks/{id}/refs`
   for the conversation and evidence; `GET /tasks/{id}/events` for history.
2. Move it with `update_task {state}` (or `status`), assign, date, estimate.
   `bulk_update_tasks {ids, patch}` moves up to 200 in one transaction —
   all or nothing.
3. Talk on it with `create_comment`; `@name` reaches that person's My work.
4. Relate it: `create_task_link {rel: blocks|relates|duplicates|custom}`;
   `delete_task_link` by link id.
5. Bind your run to it: `POST /tasks/{id}/runs {sessionId}` when a backend
   session works the task (the Eve track's Thread tab reads these).

## Finding work

- `search_tasks {q}` — FTS5 over titles and bodies, relevance-ranked, with
  snippets. `list_tasks` narrows by status/assignee/sprint/parent and takes
  the **filter document** (`f`: states, groups, types, priorities,
  assignees, labels, sprint, milestone, parent, intake, due/start spans,
  text, order, group/subgroup) — the same document saved views store
  (`list_views`).
- `my_work` — the caller's assigned · created · mentioned · overdue, across
  projects, 50 each.

## Sprints

`create_sprint`, then `POST /projects/{p}/sprints/{id}/start`;
`…/complete {carry: next|backlog, next?}` closes it and carries unfinished
tasks. Sprints are history: no delete, ever.

## Automation

Rules are typed documents — `{trigger, conditions, actions}`, vocabulary at
`GET /api/v1/rules/schema`. Author one from a request in natural language,
then ALWAYS `dry_run_rule` and show what would have fired over the last
events before enabling it (`PATCH /rules/{id} {enabled: true}`). Four
built-ins ship enabled and need no AI backend: `stale-nudge`,
`auto-archive-completed`, `due-tomorrow-reminder`, `merged-pr-completes`.
Rule actions run as `rule:<name>` and never re-trigger rules. Creating or
enabling a rule is admin-only (a member token gets 403); dry-run is open to
members inside the rule's own project.

## Mirror

A project may mirror into Jira (`GET|PUT /projects/{p}/mirror {connector,
truth: local|remote, config.stateMap}`, `POST …/mirror/sync`). The truth
side wins every conflict; the ledger records what was overwritten as a
`mirrored` event. Do not "fix" a conflict by editing the losing side — say
which side is truth and let the next sync settle it. Binding the mirror and
running a sync are admin-only.

## CLI

```text
vitrinka task list [--state a,b] [--group started] [--order rank] [--text …]
vitrinka task get|create|update|comment|rank|search|delete|mine
vitrinka sprint list|create|start|complete --carry next|backlog
vitrinka intake list|accept|decline|merge --into <id>|propose
```

## Never

- Never file a task and a draft for the same finding — one door per item.
- Never accept your own intake drafts unless the user asked you to triage.
- Never enable a rule without a dry-run in the transcript.
- Never bypass `status`/`state` validation by inventing keys; `list_states`
  first.
