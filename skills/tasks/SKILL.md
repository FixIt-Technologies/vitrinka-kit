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
- **Types**: `task · bug · story · epic · todo`; a parent task rolls its
  children up. A `todo` is a personal reminder with a moment (milestone,
  trigger, clock) — the `me` module's `/vitrinka:todo`, `todo-list`,
  `todo-done`, `todo-milestone` and `remind` skills own that shape
  (`vitrinka todo|schedule`); file engineering work as `task`.
- **Rank** is a string; `rank_task {before, after}` moves, `list_tasks` with
  the filter document `{order: "rank"}` reads it.
- **Refs** attach a task to the evidence: `add_task_ref {kind, ref, meta}`.
  A `pr` ref is `owner/repo#n`; the GitHub App webhook attaches it for
  branches or PRs carrying `vt-<id>`, and `meta.merged = true` completes the
  task through a built-in rule.
- **Custom fields** are per-project typed definitions (`list_fields`: key,
  kind, options, `appliesTo`) whose VALUES ride the task as `fields:
  {key: value}` on `get_task`, `create_task` and `update_task` (partial
  merge — pass only the keys you change, `null` deletes). Kinds and value
  shapes: `text · longtext · url` string · `select` one of the options ·
  `multiselect` string[] · `checklist` `[{name, done, evidence?}]` ·
  `number` · `date` "YYYY-MM-DD" · `relation` a task id. A definition
  applies only to its `appliesTo` type; every project carries the
  **feature preset on epics** — `outcome`, `non_goals`, `gates` and
  `decisions` (checklists: tick `done` WITH `evidence`), `ledger_state`
  (`scheduled` by default · `active · waiting · superseded · closed`),
  `waiting_on`, `next_action`. The filter document takes `fields:
  {key: value}` for select/multiselect. Defining fields
  (`create_field · update_field · delete_field`) is admin-only.
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
- **Filing from a board card** is the human's door — the card's context
  menu "File a task from this card" (`POST /api/v1/cards/{id}/task`): the
  draft carries a board ref pinned to the card (`meta.cardId`, the panel's
  Evidence row links back), and an accepting reviewer gets the task
  projected onto the same board as a live task card. The agent-side twin is
  `propose_tasks` + `add_task_ref {kind:"board", ref, meta:{cardId}}`; the
  reverse hand (task → canvas) is the task panel's "Pin on <board>" or
  `POST /api/v1/boards/{slug}/task-cards {taskId}`.

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

## Moving a project between workspaces

`transfer_project {project, to, dryRun, archiveSource}` / `vitrinka project
transfer <project> --to <workspace> [--dry-run] [--archive-source]` copies
everything the project owns (sets, boards, sessions, reports, releases, the
PM engine, blobs) into a workspace the caller also OWNS — `to` is the
destination, never the caller's tenant. Dry-run first and show the report;
the copy is idempotent (re-runs report `skipped`), a colliding board slug or
set key is a 409 naming it, and nothing is deleted: `archiveSource` only
stamps the source boards archived. Doctrine: `docs` topic `project-transfer`.

## CLI

```text
vitrinka task list [--state a,b] [--group started] [--order rank] [--text …]
vitrinka task get|create|update|comment|rank|search|delete|mine
vitrinka task field get <id> [key] · task field set <id> <key> <value|json>
vitrinka project fields list|add <key> <label> --kind …|update <key>|remove <key>
vitrinka project transfer <project> --to <workspace> [--dry-run] [--archive-source]
vitrinka sprint list|create|start|complete --carry next|backlog
vitrinka intake list|accept|decline|merge --into <id>|propose
```

## Never

- Never file a task and a draft for the same finding — one door per item.
- Never accept your own intake drafts unless the user asked you to triage.
- Never enable a rule without a dry-run in the transcript.
- Never bypass `status`/`state` validation by inventing keys; `list_states`
  first. Same for custom fields: `list_fields` before writing `fields`, and
  never tick a gate `done` without its `evidence`.
