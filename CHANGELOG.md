# Changelog

## 1.5.0 — 2026-11-08

### Changed
- **What goes first is where you put it**: priorities (P1–P3) are gone. Drag a task onto another in
  Up next, the Inbox, a project in Projects or a board column and it takes that place (a line shows
  where it lands); from the Inbox onto Up next it's planned too. `t`, or *Move to the top* in a
  task's menu, puts it first; new tasks go last. A file from before keeps its order; a task an agent
  writes goes last, or first with `"priority": "high"`. Rows and cards lose the P chip.
- The detail's **Activity** (every status change) is off by default: *Activity in the details* in the
  settings shows it. How long the task has been in its status still shows.
- New screenshots for the README and the website, without priorities and with the new setting.

## 1.4.0 — 2026-11-08

### New
- **Tasks or terminals, the same flow**: every agent's tab is a task from its start, a light one
  named after what the agent calls its work, following it (Doing, Review) on the list, the board and
  in Projects. Change anything on it and it's yours; untouched, it goes away with its tab. Work only
  with terminals and still get the board, Later, reminders and the resume after a restart. *Track
  agents automatically* in the settings (on by default) turns it off.
- **Reorder projects** by dragging one's row onto another in Projects; the board's pills and the
  task form follow the same order.
- A project with no repositories yet has its terminal, agents and project tasks too, in its own
  space in the home folder.
- **Agents after a restart**: Herdr brings terminals back as shells after a reboot; tasker types
  each one's Claude Code or Codex resume into it (`cd <folder> && claude --resume <id>`), with a
  notification. Quitting an agent yourself isn't undone. On by default, off in the settings.

### Changed
- New screenshots for the README and the website (light tasks, the new settings); the board's *No
  task* lane only shows with tracking off. The settings dialog fits every option.

### Fixed
- Claude Code attached to its background session (`claude attach`) reports no state to Herdr, so its
  tab showed nowhere in Now: an agent program in front counts as an agent, working or idle as its
  terminal's title says, with its model and context read from its transcript.

## 1.3.0 — 2026-11-08

### New
- **A board per project**: every board is a tab, "Board" for every project (`cmd-shift-b`) and
  "Board · Acme" for each project, with only its tasks and agents. The pills at the top go from one
  board to another (opening its tab the first time) instead of filtering in place.
- **A project's actions where you look for them**: while the pointer is on a project's row, its board,
  a terminal, a task and its menu show in place of its count. The menu is grouped: plan (board, new
  task), work across its repositories (terminal, agents), manage (edit, close). The header of
  Projects drops its board button: each project's row has its own (Now keeps the board of every
  project).

### Changed
- The settings dialog is taller, so every option shows without scrolling.
- New screenshots for the README and the website (Later, project-wide work, stacked lists, the new
  settings); the demo covers them.

## 1.2.1 — 2026-11-08

### Changed
- Work for a whole project (its terminal and agents, a task with a project but no repository) opens in
  the project's own space, in the nearest folder holding all its repositories (`~/dev`), instead of
  its first repository, and shows at the project's level, above its repositories (its terminals are
  labelled `tasker.project=<id>`). *Close project* closes that space too.

## 1.2.0 — 2026-11-08

### New
- **Later**: put a task off until a day (tomorrow, next week, `fri`, `+3d`, …) or *someday*, from its
  menu, the detail or `z`. It leaves Now's lists for a folded *Later* section and comes back on its
  day; an agent that asks for you still shows. Starting, finishing or dropping it ends the wait.
- **Reminders**: a notification when a task comes back from Later, and once a day for what's due or
  late; clicking it shows the task. On by default, off in the settings. `tasker.select:<id>` (scripts,
  notifications) opens the detail on that task.
- **Now and Projects stacked**: a setting shows both lists at once, one above the other (as Herdr's
  spaces and agents), or one with tabs as before. The layout holds both in a `tasker-lists` stack; a
  list block takes `"view": "now" | "projects"` in its props for layouts of your own. Projects is
  on top, Now below; `tab` moves between them, and Now takes the layout's keys.
- **Projects as a place to work**: a project has its own terminal, task and menu. An agent for the
  whole project (from its menu, or on a task with a project and no repository) starts in its first
  repository with the others added (`--add-dir`: Claude Code and Codex) and is told which they are;
  a task in one repository of a bigger project hears of the others.
- **Close a repository or a project**: from its menu, with one question, closes its spaces in Herdr.
- Terminals and agents in no task show the same second line as a task: model, effort, context, and
  how long in their state.
- **Add folder…** in the project form: attach any local repository, not only those open in Herdr.

### Changed
- **The task panel stays as you leave it**: selecting a task no longer opens it. Open it when you
  want more with the panel button in the status bar, `cmd-i`, `i`, or *Details* in a task's menu
  (a card clicked on the board still opens it). Picking a task in Find goes to its agent, as a click.
- A finished agent sends its task to *To review* only from Doing: a task you put in Next, Waiting or
  Inbox stays there.
- **Plan usage is off by default** (it starts your `claude` CLI for a moment every few minutes); turn
  it on in the settings.
- Right-clicking a project opens its menu; *Edit project…* is in it.
- **Lighter on the window**: every redraw of a mod redraws the whole window, so tasker now redraws
  only for news. The detail panel looks again every 15 s without drawing, and draws only when the
  screen, diff or PR changed; it doesn't read an agent's screen while its terminal has the focus
  (you're typing in it). Agent info, repository state and plan usage redraw only when they changed.
- Clicking a task in the list (Now or Projects) brings its agent's tab to the front, or a terminal of
  the task when it has no agent.

### Fixed
- **Delete task** didn't delete, and the same with the other actions of the task menu (status,
  priority, Start, Resume), *Move to project* in a repository's menu, *Make task* on an agent in no
  task and *Add to task…*: the dialog closed before it wrote, and closing drops its work.
- A change made in the detail panel (priority, status, …) showed only after something else moved:
  the copy of the mod that wrote a change now redraws too.
- The task form says what *Notes* is for (context and instructions the agent gets with the title),
  with room for more of it.

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
