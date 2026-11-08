# Changelog

## 1.1.0 — 2026-11-07

### New
- **Plan usage in the status bar**: Claude Code's and Codex's 5-hour and weekly limits, amber from
  70% and red from 90%, with reset times on hover. Asks your own `claude` CLI (no token read, no
  prompt sent) and reads Codex's logs. Can be turned off in the settings.
- **Resume agent**: each task remembers its Claude Code or Codex conversation; after a restart,
  *Resume agent* (or `r`) continues it in its folder, tied to the task.
- **Agents in no task**: a *Not in a task* section in Now, *Add to task…* to tie one to an existing
  task, and a *No task* lane on the board to drag one onto a column.
- **Linear**: *Import Linear issues* brings your open assigned issues into the Inbox with their
  priority and due date (personal API key from `LINEAR_API_KEY` or a key file).
- **Website** with a tutorial and examples: https://alex-roc.github.io/herdr-tasker/

### Fixed
- Tasks with the same id in `tasks.json` (two entries made in the same second) are told apart.

## 1.0.0 — 2026-11-07

First public release.

### New
- **Now, Projects, Board and a task detail** over Herdr's spaces, tabs and agents, with model,
  reasoning effort and context for Claude Code and Codex agents.
- **Settings** (gear in the status bar): Doing limit, days before a task counts as stalled, and the
  agent *Start agent* runs (installed ones only).
- **Due dates in words**: `today`, `tomorrow`, `fri`, `+3d`, `2w`, `12-24`, with the date it means
  shown as you type.
- **Delete asks first**; menus have icons; the task and project forms keep their buttons in view.
- **`tasker.select:<id>`** and **`tasker.settings`** commands, for scripts and agents.
- **`./install.sh --keys`** merges the shortcuts without replacing yours; the layout has a picture in
  Settings.
- **docs/agents.md**: how agents can add and move tasks safely.

### Fixed
- A hand-edited `tasks.json` with an unexpected value (a due date like "next week", a missing title,
  a stray entry) no longer blanks the list and the board: every field is checked on read.
- A `tasks.json` with a JSON error is never written over.
- Pressing Enter twice in the task form no longer creates the task twice.
- Two agents started in the same space at once are each tied to the right task.
- Two tasks with the same title get their own worktree branch.
- Tabs outside a task are named after what runs in them (`zsh · acme-web`), not their address.
- The sidebar, the board and the detail agree on how long an agent has been working.
- The board's columns fit the window instead of running off its edge.
- "No project" counts the terminals under it.
- Issue and pull request links open on Linux and Windows too.
- Model and effort of agents on another machine are read from that machine's home.

### Faster
- Agent logs and repository state are read once for every view, not once per view.
- The detail panel stops reading the screen, the diff and the PR while it's closed.
- Repositories are looked at side by side.
