# tasker for agents

How a coding agent (Claude Code, Codex, any program with a shell) can read and change the person's
tasks. Paste this into an agent's instructions, or point it here.

## Where the tasks are

`~/.config/herdr-app/data/tasker/tasks.json` (or `$HERDR_APP_HOME/data/tasker/tasks.json`). The
layout reloads it within a second of any save, from any program.

## Rules

1. **Read, change, write the whole file**, and keep every field you don't touch. Write to a temporary
   file next to it and rename it over `tasks.json`, so nobody reads half a file.
2. **New task**: `id` (any unique string, e.g. `agent-` + a timestamp) and `title` are enough.
   Usual extras: `project` (a project's `id`), `repo` (`~/path/to/repo`), `status` (`inbox` for an
   idea, `next` for planned work), `due` (`YYYY-MM-DD`; words
   like "tomorrow" are dropped), `next_step`, `notes`. To put a task off, set `snooze` to a day
   (`YYYY-MM-DD`: it comes back then) or `"someday"`; `null` brings it back.
   **Order**: leave `rank` out and the task goes last in its lists; add `"priority": "high"` (or `1`)
   to put it first instead. The person orders the rest by dragging (`rank`, lower first): don't
   change another task's `rank`.
3. **Status** is one of `inbox`, `next`, `doing`, `waiting`, `review`, `done`, `dropped`. When you
   change it, also set `updated` (ms since the epoch) and append `{ "s": "<status>", "at": <ms> }` to
   `history`, so the person sees when it moved. For `done`, set `done_at` too.
4. **Don't mark the person's tasks done** unless they asked: put finished work in `review`.
5. **Don't delete tasks.** Set `"deleted": true` if one must go; tasker hides it.
6. **Leave `tabs`, `sessions`, `agent_ms`, `worktree` and `branch` alone** unless you know why: tasker keeps them.
7. Never put secrets in a task. The file is plain text in the person's home.

## Example (Node)

```js
import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { homedir } from "node:os";
const file = `${process.env.HERDR_APP_HOME ?? `${homedir()}/.config/herdr-app`}/data/tasker/tasks.json`;
const data = JSON.parse(readFileSync(file, "utf8"));
const now = Date.now();
data.tasks.push({ id: `agent-${now}`, title: "Write tests for the parser", repo: "~/dev/app",
  status: "next", next_step: "Cover empty input", created: now, updated: now,
  history: [{ s: "next", at: now }] });
writeFileSync(`${file}.tmp`, JSON.stringify(data, null, 1) + "\n");
renameSync(`${file}.tmp`, file);
```

## Example (shell, with jq)

```sh
f=~/.config/herdr-app/data/tasker/tasks.json
now=$(($(date +%s) * 1000))
jq --arg id "agent-$now" --argjson now "$now" \
  '.tasks += [{id: $id, title: "Update the changelog", status: "inbox", created: $now, updated: $now, history: [{s: "inbox", at: $now}]}]' \
  "$f" > "$f.tmp" && mv "$f.tmp" "$f"
```

## Showing a task

`herdr-app do tasker.select:<task id>` shows that task in the detail panel (the tasker layout must be
the one on screen). `herdr-app do tasker.board` opens the board.

## Which task am I?

An agent started from a task has the task in its first message, and its terminal carries the label
`tasker.task=<id>`: `hc get "$HC_TERMINAL_ID" --json` shows it under `labels`.
