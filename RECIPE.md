# tasker

A task manager for work done with coding agents. The left sidebar lists what needs you now, or an
outline of projects → repositories → tasks; the right panel shows one task with its agents (model,
effort, context), its changes and pull request, and a box to message the agent; a board tab shows
every task by status.

![tasker](preview.png)

## What you see

- **Left sidebar, 330px** (`chrome` background), from Herdr's main layout: the brand row (46px,
  `workspace-chrome`), the tasker list, the footer (69px, `workspace-chrome` with `footer: true`).
  - Header (40px, border below): two pill buttons **Now** (zap icon) and **Projects** (folder-tree),
    24px high, the shown one on `selected`; then 22px icon buttons with tooltips: (Projects only)
    eye/eye-off "Show done tasks", folder-plus "New project"; square-kanban "Board"; search "Find a
    task"; plus "New task".
  - **Now**: collapsible sections, header 11px medium in the section's color plus a count and a
    chevron: Needs you (`blocked`), To review (`done`), Working (`working`), Up next (foreground,
    first 7, then "N more" which opens Projects), Stalled (`ansi3`), Inbox (`dim`, first 5).
    Empty: "Nothing needs you. Press n for a new task, or open Projects to see your repositories."
  - **Projects**: a project row (9px colored square, name 12px semibold, count of tasks and loose
    tabs, chevron); under it the tasks without repository, then repository rows (chevron, name,
    `⎇ branch`, `↑ahead`, `•dirty` in `ansi3`, "not open" when no space is in it, each with a
    tooltip; then `square-terminal` new terminal, `plus` new task, `ellipsis` menu), the
    repository's tasks, and its tabs in no task. Open git repositories and folders in no project go
    under "No project".
  - **Task row**: 16px mark (the lead agent's state as Herdr draws it: spinner, "!" on
    `blocked`+26 alpha, 7px dot `done`, ring `idle`; else the status icon: inbox, circle-dot,
    circle-play, circle-pause, eye, circle-check, circle-x), title (semibold when its agent is done),
    repository name in Now, due chip ("2d late" on `blocked`, today/tomorrow on `ansi3`, else `dim`),
    priority chip P1 `ansi1` / P2 `ansi3` / P3 `dim`. A second 11px line: the agent's question in
    `blocked`, else "opus 5.5 · high · ctx 241k · working 4m" (or "finished 3m ago", "idle 1h"), else
    "→ next step". Hover shows a play button on tasks without an agent. Selected row on `selected`.
  - **Loose tab row** (a tab in no task): program icon or terminal icon, its name (the tab's name,
    the agent's title, else "zsh · <folder>", never the address), and a **Make task** button
    (tooltip "Turn this tab into a task…").
- **Right column `tasker-detail`, 360px, hidden until a task is selected**: header "Task" with pencil
  and ✕; title 15px with its status icon; repository, due chip, "est. 2h", issue link; a row of status
  icons where only the current one shows its name, and P1–P3; actions (Start agent / Start in a
  worktree, or Go to agent; Mark done in Review; Show changes); sections in 10.5px uppercase `dim`:
  Next step, Notes, Agents (cards: program icon, title, address, state, "opus 5.5 · medium · ctx
  248k · turn 7 · working 1m", the pending question, sub-tasks and sub-agents as a tree), Screen
  (last 8 non-empty lines of the agent's terminal), Changes (branch, "N files +add −del", PR chip
  that opens the PR, checks chip, "Ask for a pull request", "Send failed checks"), Message the agent
  (textarea + Send), Time ("Doing for 2h", "agents worked 47m", "created 4d ago"), Activity
  (history, newest first).
- **Board** (a tab whose only pane is the mod with `role: "board"`; an open one is focused instead of
  making another): header 44px on `canvas` with "Board", project pills (All + each project with its
  color) and a hint; six columns that share the width (min 210, max 320px) on `chrome`, radius 10,
  header 38px (status icon, name, count; Doing shows n/limit in `ansi3` when over; + on Inbox and
  Next); cards on `background`, radius 9, border `blocked` when the agent needs you, `accent` when
  selected: mark + title, next step, the question or "model · effort · working 4m", chips (P, due,
  #issue, branch) and the repository. Empty column: a 56px "Nothing here" box. Done shows the last 7
  days. Dragging dims the card and highlights the column under the pointer (`selected` + `accent`
  border); releasing there sets the status.
- **Status bar, 28px**: "✓ N done today" (`ansi2` when > 0), "Doing n/limit" (`ansi3` and "finish
  something first" when over), "! N need(s) you" (click: Now), "N working", then "N open" and a
  settings gear.
- **Dialogs** (Herdr dialogs, `popover` background): task form 560×660, project 480×500, settings
  460×440, find 520×420, issues 540×460, archive 460×230, delete 420×190; menus are popups (task
  250×290, repository 250×340). Forms scroll and keep their buttons in a footer with a border.
- Theme: `themes/tasker.json` for dark (`#1a1d21` background, teal accent `#5fc4b5`, `working`
  `#6fa8e8`, `blocked` `#e5737b`, `done` `#5fc4b5`), Herdr's `paper` for light.

## How it behaves

- Agent states come from Herdr: working (spinner), blocked (Needs you, with the agent's question),
  done (dot; the task goes to To review), idle (ring). A task's state is its most urgent agent's,
  sub-agents included.
- When a task's agent starts working the task becomes *doing* (from inbox, next, waiting, review or
  done); when it stops after working, a *doing* task becomes *review*. Nothing becomes *done* by
  itself. Agent working time adds up per task. Only the sidebar copy does this bookkeeping.
- Clicking a task selects it and shows the detail; Enter (or Go to agent) focuses its agent's pane.
  Right-click: a task's menu (edit, start, start in worktree, status icons, priority, archive,
  delete in `blocked`); a repository's menu (new terminal, "New <agent> here" for each installed
  agent, new task, import GitHub issues, its project); a project: edit it.
- Delete and archive ask first. Delete hides the task (`deleted: true`); archive marks it done,
  settles its tabs and can `git worktree remove` + `git branch -d`.
- Start agent: `tab.new` in the repository's space named after the task with the task as its first
  message (or `space.new`); the new tab (one named like the task first, never one already a task's)
  is tied to the task and its terminals labelled `tasker.task=<id>`. In a worktree: `git worktree add
  -b task/<slug> ~/.herdr/worktrees/<repo>/<slug>` first (`<slug>-<id end>` if another task has it).
- Task form: title (required: Save is dimmed without it), project, repository (projects' repos and
  open git repositories), status, priority (P1 High, P2 Normal, P3 Low), due (today, tomorrow, fri,
  +3d, 2w, 12-24, 2026-12-24, with "in 3d · 2026-11-10" beside the label, red border when not
  understood), estimate, next step, notes. Enter saves once.
- Settings: steppers for the Doing limit (1–20) and stalled days (1–60), and the installed agents
  as pills (the chosen one stays even if not installed).
- Keys in the list: j/k, arrows, enter, space, 1–3, n, e, l, w, /, tab. Layout keys: cmd-j, cmd-k,
  cmd-shift-n, cmd-shift-o, cmd-i, cmd-shift-b. Mod commands: `new`, `jump`, `board`, `view`,
  `focus`, `settings`, `select:<id>`.

## Built from

- Layout: Herdr's `main` with `sidebar-lists` replaced by a block `{mod: "tasker", props: {role:
  "sidebar"}}`, a hidden column `tasker-detail` (`role: "detail"`) appended to `work-body`, and the
  status block given `role: "status"`; root `"preview": "layouts/tasker.svg"`. Kept:
  `workspace-chrome`, `tabs`, `pane` (header), `files`, `changes`.
- One mod, `tasker`, roles by props; dialogs are the same mod as overlays with `{dialog: "task" |
  "project" | "menu" | "repo" | "jump" | "issues" | "archive" | "confirm-delete" | "settings"}`,
  opened through one function that holds their sizes.
- Data in `data/tasker/tasks.json`: `readTextFile`, every task and project cleaned on read,
  `writeTextFile` compare-and-swap with retries, never over a file that doesn't parse, `watchFolder`
  to reload. Cross-copy state: `shared("tasker.selected")`, `shared("tasker.view")`,
  `shared("tasker.pending")` (launches waiting for their tab); caches on `globalThis` (agent info,
  repository state, since-when) so every copy looks once.
- `spaces()`, `panes()`, `agents()`, `terminals()` joined per render; `setAgentOrder` follows the
  list. Since when: `status_ms`, else the tab's `working_since` / `changed_at`, else tasker's stamp.
- `layout()` tells whether `tasker-detail` is on screen: the detail reads `hc read`, `git diff` and
  `gh pr view` only then, every 15 s with the window in front (PR every 60 s).
- Model, effort and context: Claude Code `~/.claude/sessions/<pid>.json` → transcript, searched
  with `tail -c 4MB | LC_ALL=C grep -aoE` for the last `"model"`, `"effort"` and usage counts (16 MB
  if not found); Codex rollout via `lsof -p <pid>` → `turn_context` and `token_count`; on another
  machine, that machine's `$HOME`.
- Programs: git, gh, hc, tail, grep, lsof, open/xdg-open.
- Icons: Lucide SVGs in `mods/tasker/icons` (status, header, repository and menu icons, settings,
  trash-2, circle and circle-check for checkboxes).

## Watch out

- Herdr does not hot-reload a mod folder that is a symlink: install by copying.
- `child(null)` throws; a helper that may return nothing (the due chip) must be guarded.
- Claude Code transcripts carry multi-megabyte lines (pasted images): parsing a fixed tail as JSON
  lines finds nothing. Grep the fields; keep it to a few MB with `LC_ALL=C`.
- `terminals()` doesn't always carry `status_ms`; every copy stamping its own "since" makes the
  views disagree: share it.
- `hc read` output carries "[hc] …" notes; drop them. Shell titles are often the terminal address.
- The tabs mod re-hides the `panel` column per space, so the detail lives in its own column.
- Herdr already notifies blocked and done agents; tasker adds no toasts for them.
- `herdr-app shot` returns the last frame: with the window in the background it can be stale.
- The theme file is part of the layout: copy `themes/tasker.json` too.

## Done when

- `herdr-app check ~/.config/herdr-app/mods/tasker` passes, and with props for each role and dialog.
- Switching to tasker shows Now with sections; a Claude Code agent on a task shows its model and effort.
- Editing tasks.json by hand updates the list within a second; a JSON error shows a message and
  the file is left as it was; a task with a due of "next week" still draws.
- Start agent on a task with a repository opens a tab there, the task turns doing, and the tab is
  listed under the task; when the agent stops, the task is in To review.
- The board's six columns fit a 1500px-wide window with the detail open.
