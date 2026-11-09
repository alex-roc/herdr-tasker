# Developing tasker

## The loop

```sh
pnpm test            # or: node --import ./test/register.mjs --test 'test/*.test.mjs'
pnpm run check       # herdr-app check, once per role and dialog
./install.sh         # copy into ~/.config/herdr-app: Herdr reloads it at once
herdr-app status     # errors from the mod, if any
herdr-app shot x.png # the last frame (bring the window to the front first, or it may be stale)
```

There are no dependencies to install: the tests use Node's own runner (Node 22 or later).

## Layout of the code

```
layouts/tasker.json   Herdr's main layout with the task list, the detail column and a status bar
layouts/tasker.svg    the picture Settings shows for the layout
themes/tasker.json    the dark theme (light uses Herdr's paper)
mods/tasker/
  main.js             one mod, several roles by props: sidebar | detail | status | board | dialog
  sidebar.js          Now and Projects, and the bookkeeping (ties new tabs to tasks, moves tasks
                      as their agents work, adds up agent time); only the sidebar copy does it
  detail.js           the task panel; looks up screen, diff and PR only while shown
  board.js            the kanban tab
  dialogs.js          task and project forms, menus, find, issues, archive, delete, settings
  strings.js          every word the person reads (translate this file to localize)
  lib/store.js        tasks.json: read, cleaned, compare-and-swap writes, file watch
  lib/world.js        joins tasks with Herdr's spaces, tabs, agents and terminals; Now and Projects
  lib/agentinfo.js    model, effort and context from Claude Code and Codex logs
  lib/git.js          repository state, read without locks
  lib/actions.js      start an agent, worktrees, archive, gh, links
  lib/cache.js        caches shared by every copy of the mod (globalThis)
  lib/usage.js        plan usage: Claude (bin/claude-usage.sh) and Codex (its logs)
  lib/linear.js       Linear's assigned issues, for the import dialog
  bin/claude-usage.sh asks the claude CLI for usage (get_usage control request), no token read
  lib/open.js         opens dialogs with their sizes
  lib/ui.js           shared pieces: icons, chips, buttons, marks
test/                 Node tests with fake `herdr` and `gpui-kit` modules
scripts/              check.sh, demo.mjs, fake-agent.sh, gpui-methods.mjs
```

## Tests

`test/stubs/` fakes Herdr's modules: `herdr.js` holds a world you set (spaces, agents, terminals,
files, what `git`/`gh`/`hc` answer) and records what the mod does; `gpui-kit.js` builds element
trees that refuse what the app refuses (a `null` child, an element used twice, a method gpui-kit
doesn't have; the list is in `gpui-methods.json`, refresh it after a Herdr update with
`node scripts/gpui-methods.mjs`).

- `test/render.test.mjs` renders every role and dialog against a busy world
  (`test/fixture.mjs`), then fires every click, key and hover and renders again. It catches what
  `herdr-app check` can't: rows that only exist with data, async states and handlers.
- `test/logic.test.mjs` covers the rules: due dates, cleaning a hand-edited file, which tab is
  whose, the Now order, tasks following their agents, reading agent logs, lookups only while shown.

`scripts/check.sh` runs Herdr's own `herdr-app check` on a copy of the mod per role and dialog
(`check` alone renders with no props).

## A demo in the real window

```sh
node scripts/demo.mjs          # 3 made-up repos in ~/tasker-demo, 13 tasks, 4 stand-in agents
node scripts/demo.mjs --adopt <tab id>   # also one of your real agent tabs, as a demo task
node scripts/demo.mjs --clean  # closes the demo spaces, deletes ~/tasker-demo, restores your tasks
```

The stand-in agents (`scripts/fake-agent.sh`) report working, blocked (with a question) and done
through the Program Status Protocol, as real agents do:
`printf '\e]7501;state=blocked:kind=question:app=claude-code:msg=<base64>\e\\'`. This is how
`preview.png` and `docs/board.png` are made: no personal data in them. The demo covers a blocked, a
working and a finished agent, a task to resume, one put off and one *someday*, a task and a terminal
for the whole Acme project (its own space, `~/tasker-demo`), and reminders off (no toasts in shots).

Screenshots, with the window maximized (`herdr-app do window.maximize`, again to put it back: a window
in split view is half as wide) and the sidebar at 330px (`layout.resize {id: "sidebar", px: 330}`);
`herdr-app shot` gives a 2× frame (about 4440×2420). The demo puts your own agents' tabs in an archived
task, so they're neither tracked as light tasks nor drawn; its agents' addresses change every run
(find one by its tab's name in `herdr-app ls`).

- Bring the window to the front first (`osascript -e 'tell application "Herdr" to activate'`) or the
  frame is stale; two identical shots mean it was. Close a stray popup with `herdr-app do overlay.close`.
- Drive it with commands: `tasker.view`, `tasker.select:<id>` (opens the detail), `tasker.board`,
  `tasker.new`, `tasker.settings`, `tasker.jump`, `layout.select`/`layout.hide`, `pane.focus {terminal}`.
- `preview.png`, `site/img/overview.png` and `board.png`: the whole frame at half size. Lists: x 0–660
  from y 92. Detail: x 3736–4472 from y 84. Dialogs: their box (settings exactly, the form with a
  20px margin). Update `width`/`height` in `site/*.html` when a size changes.
- Note what you changed (sidebar size, stack child, detail shown, `tasker.view`) and put it back
  after `--clean`.

## Things that tripped the build up

- A lost terminal (reboot, core crash, `kill -9` of its shell: try that on a test space) comes back
  at the same address, in the same tab, with the same `created_ms` and another `pid`, a shell in
  front. Herdr never runs its program again: `lib/revive.js` types the resume.
- `hc send` from inside a terminal (with `HC_TERMINAL_ID` set) wraps the text as a message from that
  agent, `<hc from="t11">…</hc>`: a shell can't run it. Clear the variable to type a command.
- Herdr's `app` on a pane can linger after its agent quits (a zsh still says `claude-code`), and
  `claude attach` reports no state with `program.agent: false` (key `claude`): decide by the
  program in front, a shell being no agent. Claude Code marks its title (◐◑ working, ✳ idle), but
  `terminals()` and `panes()` hand mods the title without the mark: `hc get` has it.

- Herdr doesn't hot-reload a mod folder that is a symlink: install by copying.
- `child(null)` throws in gpui-kit, and so does using an element twice. `false` is fine.
- Every copy of the mod (sidebar, detail, status bar, board, each dialog) runs its own `init` and
  `render`, but they share `globalThis`: caches of agent info, repository state and "since when"
  live there (`lib/cache.js`) so each is looked up once.
- Closing an overlay drops that copy of the mod, and what it spawned and hadn't finished never
  runs. A dialog writes first and closes after: `this.closeAfter(cx, work)` in `dialogs.js`. The
  test stub does the same (`cx().spawn` in `test/fixture.mjs` skips work once its overlay is closed).
- Every redraw of a mod redraws the whole window, terminals included: a lookup redraws only when
  what it found changed (`cx.notify()` behind a comparison), and timers look without drawing.
- Several lists can be on screen (Now and Projects stacked). Key commands reach every shown copy:
  only one list acts, Now when both show (`isFirstList`); the test stub delivers a command to every
  waiting copy, as Herdr does. Bookkeeping state (`workSince`, `prevTop`) lives in
  `sharedCache("books")`, so whichever list draws first records a change once. A stack shows one
  child: `onScreen` and `shownLists` in `lib/ui.js` follow its `active` one.
- `layout()` reflects nodes hidden by clicks (`hidden: true`): `onScreen(id)` in `lib/ui.js`.
- `terminals()` doesn't always carry `status_ms`; tabs carry `working_since` and `changed_at`.
- Claude Code transcripts hold multi-megabyte lines (pasted images): grep the fields from the last
  4 MB (16 MB if needed) with `LC_ALL=C` instead of parsing JSON lines.
- `hc read` output has `[hc] …` notes: drop them.
- The `tabs` mod re-hides the `panel` column per space, so the detail is its own column.
- `herdr-app shot` returns the last frame; with the window in the background it can be stale.

## The website

`site/` is the GitHub Pages site (https://alex-roc.github.io/herdr-tasker/): plain HTML and CSS, no
build. `.github/workflows/pages.yml` publishes it on every push that touches `site/`. Its pictures
in `site/img/` come from the demo (`scripts/demo.mjs`), cropped; never from your own spaces. Preview
it with `python3 -m http.server -d site 8765`.

## Publishing

The repository is laid out as herdr.dev expects a layout: `layouts/tasker.json`, `mods/tasker/`,
`RECIPE.md` and `preview.png` at the root, and the GitHub topic `herdr-layout`. herdr.dev picks it up
within the hour. Before a release: tests, `scripts/check.sh`, a new `preview.png` from the demo if the
look changed, and a line in `CHANGELOG.md`.
