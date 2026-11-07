# tasker

**A task manager for work done with coding agents, as a layout for the [Herdr app](https://herdr.dev).**
Projects → repositories → tasks → the agents working on them, with what needs you first.

![tasker: the Now list, an agent at work, and the task's detail](preview.png)

Herdr already shows every terminal and agent you run. tasker adds the layer above them: *what are
these agents for?* Each tab can belong to a task; a task knows its repository, priority, due date and
next step; and the list tells you what to do next: answer the agent that's waiting, review what one
finished, or start the next task.

- [What you get](#what-you-get)
- [Install](#install)
- [Use it](#use-it)
- [Keys](#keys)
- [Your data](#your-data) · [For agents](docs/agents.md)
- [What it runs on your machine](#what-it-runs-on-your-machine)
- [Troubleshooting](#troubleshooting)
- [Develop](docs/development.md) · [Recipe](RECIPE.md) · [Changelog](CHANGELOG.md)

## What you get

**Now**: one list, in the order things move forward:

| Section | What's in it |
|---|---|
| **Needs you** | Tasks whose agent is blocked, with the agent's question right in the row |
| **To review** | Tasks whose agent finished, or that you put in Review |
| **Working** | Tasks with an agent at work: model · effort · context size · how long |
| **Up next** | Next, Doing and Waiting tasks by priority, then due date |
| **Stalled** | Doing or Waiting tasks that haven't moved in a few days |
| **Inbox** | Ideas and imported issues, not yet planned |

Agents in tabs that belong to no task show up too when they need you, finished or are working, with a
**Make task** button.

**Projects**: an outline of projects → repositories → tasks. Each repository shows its branch,
commits not pushed (↑) and uncommitted changes (•), and the terminals open there that belong to no
task. From a repository: `›_` opens a terminal there, `+` a task, and `⋯` (or right-click) starts any
installed agent there, imports GitHub issues, or moves it to another project.

**Board**: a kanban tab (`cmd-shift-b`, or the board button) with Inbox, Next, Doing (with your
limit), Waiting, Review and Done (last 7 days). Drag a card to change its status, click to open it,
right-click for its menu, filter by project.

![The board](docs/board.png)

**Task detail** (right panel): status and priority, the next step and notes; each agent with its
model, reasoning effort, context, turn and sub-agents, and the question it's waiting on; the last
lines of its screen; the changes in its folder, its pull request and CI checks (with *Ask for a pull
request* and *Send failed checks*); a box to **message the agent**; time in state, agent time and the
history.

**Start agent** on a task opens your agent in the repository's space with the task (title, next
step, notes, issue) as its first message. **Start in a worktree** first creates the branch
`task/<name>` in `~/.herdr/worktrees/<repo>/<name>`, where Herdr's own worktree tools find it.

Tasks follow their agents: when an agent starts working the task moves to **Doing**; when it stops,
to **Review**. Only you mark a task **Done**. **Archive** puts its tabs away and can remove its
worktree (a branch with unmerged commits is kept).

Inspired by the task → worktree → review → ship flow of [Orca](https://github.com/stablyai/orca).

## Install

You need the Herdr app (0.1.13 or later). `git` is used for repository state and worktrees, and
`gh` (optional) for issues and pull requests.

**From the gallery**: find *tasker* at [herdr.dev/layouts](https://herdr.dev/layouts) and ask your
agent in Herdr to add it, or point it at this repository: *"add the layout at
github.com/alex-roc/herdr-tasker"*. Herdr's agents know how to install a shared layout.

**With the script**:

```sh
git clone https://github.com/alex-roc/herdr-tasker && cd herdr-tasker
./install.sh --keys    # the layout, its picture and theme, the mod, and its shortcuts
```

Then pick **tasker** in Settings → Look, or run `herdr-app do layout.switch '{"name":"tasker"}'`.
Your other layouts are untouched; switch back the same way.

- `./install.sh` alone skips the shortcuts. `--keys` adds a `layout:tasker` section to
  `keys.json` and never replaces a key you already bound there.
- Run it again to update. `./install.sh --uninstall` removes tasker and keeps your tasks.
- It copies instead of linking: Herdr only hot-reloads files saved inside its own folder.

**By hand**: copy `layouts/tasker.json` and `layouts/tasker.svg` to `~/.config/herdr-app/layouts/`,
`themes/tasker.json` to `~/.config/herdr-app/themes/`, and `mods/tasker/` to
`~/.config/herdr-app/mods/`. Check it with `herdr-app check ~/.config/herdr-app/mods/tasker`.

## Use it

1. **Add a project.** In Projects, the folder button makes one; tick the repositories that belong
   to it (any repository open in Herdr is offered). Or right-click a repository → Project.
2. **Add tasks.** `n`, the `+` button, `+` on a repository, or *Import GitHub issues* from a
   repository's menu. A due date takes `today`, `tomorrow`, `fri`, `+3d`, `2w`, `12-24` or
   `2026-12-24`.
3. **Start an agent.** `l` (or ▶ on hover, or *Start agent* in the detail) starts your agent with the
   task as its first message; `w` does it in a new worktree. The new tab is tied to the task.
4. **Already working?** A tab with an agent that belongs to no task has **Make task**.
5. **Work from Now.** Answer what needs you, review what's done (*Show changes*, the PR and its
   checks are in the detail), then press `space` to mark it done.

Settings (the gear in the status bar): how many tasks can be in Doing before the status bar warns
you, after how many days a task counts as stalled, and which agent *Start agent* runs.

## Keys

With `./install.sh --keys` (only while the tasker layout is shown):

| Key | Does |
|---|---|
| `cmd-j` | Move the keyboard to the task list |
| `cmd-k` | Find a task |
| `cmd-shift-n` | New task |
| `cmd-shift-o` | Switch Now ⇄ Projects |
| `cmd-i` | Show or hide the task detail |
| `cmd-shift-b` | Open the board |

In the list: `j`/`k` or arrows move, `enter` goes to the task's agent, `space` marks done (again: back
to Next), `1` `2` `3` set priority, `n` new, `e` edit, `l` start agent, `w` start in a worktree, `/`
find, `tab` switches view. Right-click a task, a repository or a project for its menu.

From a script or an agent: `herdr-app do tasker.new`, `tasker.board`, `tasker.view`, `tasker.jump`,
`tasker.settings`, and `tasker.select:<task id>` (shows that task).

## Your data

Everything lives in `~/.config/herdr-app/data/tasker/tasks.json`: plain JSON that you, or an agent,
can edit. tasker reloads it within a second of a save, checks every field, and never writes over a
file it can't read (it shows what's wrong instead). It never goes in this repository.

```jsonc
{
  "settings": { "wip": 3, "stale_days": 3, "agent": "claude" },   // agent: a key from Herdr's agent menu
  "projects": [{ "id": "p1", "name": "Acme", "color": "ansi4", "repos": ["~/dev/acme"] }],
  "tasks": [{
    "id": "t1", "title": "Add OAuth login", "project": "p1", "repo": "~/dev/acme",
    "status": "next",            // inbox | next | doing | waiting | review | done | dropped
    "priority": 1,               // 1 high, 2 normal, 3 low
    "due": "2026-11-20", "estimate": "2h", "next_step": "Wire the callback", "notes": "",
    "issue": { "number": 12, "url": "https://github.com/…", "body": "…" },
    "worktree": null, "branch": null,
    "tabs": ["<herdr tab id>"], "agent_ms": 0, "history": [{ "s": "next", "at": 1794000000000 }]
  }]
}
```

Only `id` and `title` are needed for a new task; everything else gets a default. A task's tabs are
also labelled on their terminals (`tasker.task=<id>`, see `hc ls`), so a task finds its agents again
even if the file loses them. Agents that should add or move tasks: see **[docs/agents.md](docs/agents.md)**.

## What it runs on your machine

The mod runs these programs, only on your machine (or the machine a space lives on):

- `git`: read-only status and diffs, without taking locks; `worktree add`, `worktree remove` and
  `branch -d` only when you ask for a worktree or archive one.
- `gh`: `issue list` and `pr view`, when you import issues or look at a task in review.
- `hc` (Herdr's core): read an agent's last screen lines, send it your message, label terminals.
- `tail`, `grep` and `lsof`: to read the model, effort and context of Claude Code
  (`~/.claude/sessions`, `~/.claude/projects`) and Codex (`~/.codex/sessions`) from their own logs.
- `open` (`xdg-open` on Linux) for issue and pull request links.

It makes no network requests of its own and sends nothing anywhere. While the window is in the
background, or the detail panel is closed, it looks less often or not at all.

## Troubleshooting

- **The list says tasks.json can't be read.** The file has a JSON error (often a hand edit): fix
  it and save; tasker picks it up. Nothing was overwritten.
- **No model or effort on an agent.** Only Claude Code and Codex write them where tasker can read
  them. They appear after the agent's first reply.
- **A launched agent isn't tied to its task.** tasker looks for the new tab for 30 seconds. Use
  **Make task** on the tab, or add its tab id to the task's `tabs`.
- **Changes in a mod file don't show up.** Run `./install.sh` again: Herdr doesn't reload a mod
  folder that is a symlink. `herdr-app status` lists any error.
- **Stuck in a broken layout.** `ctrl-alt-shift-escape` always goes back to Herdr's default layout.

## License

[MIT](LICENSE). Icons are [Lucide](https://lucide.dev) (ISC, `mods/tasker/icons/LICENSE`).
