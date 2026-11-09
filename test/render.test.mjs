// Renders every role and dialog of the mod against a busy world, then fires every
// click, press and hover in what it drew and renders again. Catches what
// `herdr-app check` can't reach: rows that only exist with data, async states,
// and handlers. A null child or a mistyped style method fails as in the app.

import { test } from "node:test";
import assert from "node:assert/strict";
import { H, touch } from "herdr";
import { walk, isElement, text } from "gpui-kit";
import Tasker from "../mods/tasker/main.js";
import { world, cx, settle, until, FILE, task } from "./fixture.mjs";

async function mount(props, setup) {
  const w = world();
  setup?.(w);
  H.props = props;
  // Claude Code's session file for the agents (pid 1000 + n).
  for (const t of H.terminals) {
    const pid = t.foreground?.pid;
    if (pid) H.files.set(`/home/me/.claude/sessions/${pid}.json`, JSON.stringify({ sessionId: `s${pid}`, cwd: "/home/me/dev/app" }));
  }
  const view = new Tasker();
  const c = cx();
  view.init(props, c);
  await until(() => view.store.loaded);
  await settle();
  return { view, c };
}

function render(view) {
  const c = cx();
  const tree = view.render(c);
  assert.ok(isElement(tree), "render returns an element");
  return { tree, c };
}

// Fires every handler once (each on a fresh render, as the person would).
async function fireAll(view, { skip = [] } = {}) {
  const { tree } = render(view);
  const nodes = walk(tree).filter((n) => Object.keys(n.handlers).length);
  const fired = [];
  for (const node of nodes) {
    for (const [name, fn] of Object.entries(node.handlers)) {
      if (skip.some((s) => (node.id ?? "").startsWith(s))) continue;
      const c = cx();
      const ev = name.startsWith("on_key_down") ? { key: "j", modifiers: {} } : name === "on_hover" ? true : { position: { x: 1, y: 1 }, modifiers: {} };
      fn(ev, c);
      await settle(25);
      assert.deepEqual(c.errors.map(String), [], `${node.id ?? node.kind} ${name}`);
      fired.push(`${node.id}:${name}`);
      render(view); // still draws after it
    }
  }
  return fired;
}

const ROLES = [{ role: "sidebar" }, { role: "detail" }, { role: "status" }, { role: "board" }];

for (const p of ROLES) {
  test(`role ${p.role}: renders and every control works`, async () => {
    const { view, c } = await mount(p, () => { H.shared["tasker.selected"] = "blocked1"; });
    assert.deepEqual(c.errors.map(String), []);
    assert.ok(view.store.loaded);
    render(view);
    await settle();
    render(view);
    const fired = await fireAll(view);
    assert.ok(p.role === "status" || fired.length > 3, `${p.role} has controls (${fired.length})`);
  });
}

test("sidebar: Projects view, done shown, everything folded and unfolded", async () => {
  const { view } = await mount({ role: "sidebar" });
  H.shared["tasker.view"] = "projects";
  render(view);
  await settle();
  view.filters.done = true;
  await fireAll(view);
  for (const id of ["p:pa", "p:-", "r:pa:~/dev/app"]) view.folded.add(id);
  render(view);
});

test("sidebar: the key commands", async () => {
  const { view } = await mount({ role: "sidebar" });
  render(view);
  for (const k of ["j", "j", "k", "down", "up", "enter", "space", "1", "2", "3", "n", "e", "l", "w", "/", "tab", "tab", "x"]) {
    const c = cx();
    view.key({ key: k, modifiers: {} }, c);
    await settle(5);
    assert.deepEqual(c.errors.map(String), [], k);
    render(view);
  }
  for (const c2 of ["board", "jump", "view", "new", "focus"]) view.command(c2, cx());
});

for (const dialog of ["task", "project", "menu", "repo", "jump", "issues", "archive", "settings", "confirm-delete", "loose", "project-menu", "confirm-close", "later"]) {
  for (const extra of [{}, { task: "blocked1", project: "pa", repo: "~/dev/app", tab: "tb4", repos: ["~/dev/app"], name: "App" }, { task: "review1", project: "pw", repo: "~/dev/web", tab: "tb3", attach: "tb4" }]) {
    test(`dialog ${dialog} ${JSON.stringify(extra)}`, async () => {
      const { view, c } = await mount({ dialog, overlay: "ov1", ...extra });
      assert.deepEqual(c.errors.map(String), []);
      render(view);
      await settle();
      await fireAll(view);
    });
  }
}

test("task form: saves once even when Enter is pressed twice", async () => {
  const { view } = await mount({ dialog: "task", overlay: "ov1" });
  const c = cx();
  view.inputs.title.type("Brand new", c);
  view.inputs.title.submit(c);
  view.inputs.title.submit(c);
  await settle();
  const data = JSON.parse(H.files.get(FILE()));
  assert.equal(data.tasks.filter((t) => t.title === "Brand new").length, 1);
});

test("delete: the task is marked deleted before the dialog closes", async () => {
  const { view } = await mount({ dialog: "confirm-delete", overlay: "ov1", task: "review1" });
  H.shared["tasker.selected"] = "review1";
  const del = walk(render(view).tree).find((n) => n.id === "del");
  del.handlers.on_click({}, cx());
  await settle();
  assert.equal(JSON.parse(H.files.get(FILE())).tasks.find((x) => x.id === "review1").deleted, true);
  assert.equal(H.shared["tasker.selected"], null);
  assert.deepEqual(H.closed, ["ov1"]);
});

test("task menu: a status picked there is saved, then the menu closes", async () => {
  const { view } = await mount({ dialog: "menu", overlay: "ov1", task: "review1" });
  walk(render(view).tree).find((n) => n.id === "s-done").handlers.on_click({}, cx());
  await settle();
  assert.equal(JSON.parse(H.files.get(FILE())).tasks.find((x) => x.id === "review1").status, "done");
  assert.deepEqual(H.closed, ["ov1"]);
});

test("sidebar: clicking a task shows it and brings its agent's tab to the front", async () => {
  const { view } = await mount({ role: "sidebar" });
  H.shared["tasker.view"] = "projects";
  const row = (id) => walk(render(view).tree).find((n) => n.id === `t-${id}`);
  H.runs.length = 0;
  row("doing1").handlers.on_click({}, cx());
  assert.equal(H.shared["tasker.selected"], "doing1");
  assert.deepEqual(H.runs.find(([n]) => n === "pane.focus"), ["pane.focus", { pane: "p1" }]);
  assert.ok(!H.runs.some(([n]) => n === "layout.show"), "selecting never opens the task panel");
  H.runs.length = 0;
  row("next1").handlers.on_click({}, cx());
  assert.equal(H.shared["tasker.selected"], "next1");
  assert.ok(!H.runs.some(([n]) => n === "pane.focus"), "a task with no tab only shows");
});

test("project form: a folder from the picker is added, ticked", async () => {
  const { view } = await mount({ dialog: "project", overlay: "ov1" });
  H.picked = `${H.home}/notes`;
  walk(render(view).tree).find((n) => n.id === "add-folder").handlers.on_click({}, cx());
  await settle();
  assert.ok(view.form.repos.includes("~/notes"));
  assert.ok(walk(render(view).tree).some((n) => n.id === "r-~/notes"));
  delete H.picked;
});

test("close a project: one question, then every space of its repos closes", async () => {
  const { view } = await mount({ dialog: "confirm-close", overlay: "ov1", repos: ["~/dev/app", "~/dev/web"], name: "Both" });
  const words = text(render(view).tree);
  assert.match(words, /Close Both\?/);
  assert.match(words, /its 2 spaces/);
  H.runs.length = 0;
  walk(render(view).tree).find((n) => n.id === "close-it").handlers.on_click({}, cx());
  assert.deepEqual(H.runs.filter(([n]) => n === "space.close").map(([, a]) => [a.id, a.confirmed]).sort(), [["sp1", true], ["sp2", true]]);
  assert.deepEqual(H.closed, ["ov1"]);
});

test("close a project: its own space above the repositories closes too", async () => {
  const { view } = await mount({ dialog: "confirm-close", overlay: "ov1", repos: ["~/dev/web", "/home/me/dev/docs"], name: "Website", project: "pw" }, () => {
    H.spaces.push({ id: "sp9", index: 9, name: "Website", named: true, folder: "/home/me/dev", machine: null, branch: null, active: false, status: null,
      tabs: [{ id: "tb9", index: 1, name: "1", named: false, active: true, status: null, panes: 1 }] });
    H.panes.push({ pane: "p9", tab: "tb9", terminal: "t9z", title: "t9z", cwd: "/home/me/dev", branch: null, status: null, app: null,
      program: { key: "shell", name: "zsh", shell: true, agent: false }, focused: false, zoomed: false, movable: true });
  });
  H.runs.length = 0;
  walk(render(view).tree).find((n) => n.id === "close-it").handlers.on_click({}, cx());
  assert.deepEqual(H.runs.filter(([n]) => n === "space.close").map(([, a]) => a.id).sort(), ["sp2", "sp9"]);
});

test("a terminal in no task shows its agent's line: model, context, how long", async () => {
  const { view } = await mount({ role: "sidebar" });
  H.shared["tasker.view"] = "now";
  const row = walk(render(view).tree).find((n) => n.id === "u-tb4");
  const words = row.children.map(text).join(" ");
  assert.match(words, /Opus 4\.7|opus|ctx|\d+\s?(s|m|h)/i);
});

test("later dialog: a word for a day puts the task off", async () => {
  const { view } = await mount({ dialog: "later", overlay: "ov1", task: "next1" });
  view.laterInput.type("someday", cx());
  view.laterInput.submit(cx());
  await settle();
  assert.equal(JSON.parse(H.files.get(FILE())).tasks.find((x) => x.id === "next1").snooze, "someday");
  assert.deepEqual(H.closed, ["ov1"]);
});

test("status bar: a button opens and closes the task panel", async () => {
  const { view } = await mount({ role: "status" });
  H.runs.length = 0;
  walk(render(view).tree).find((n) => n.id === "st-detail").handlers.on_click({}, cx());
  assert.deepEqual(H.runs, [["layout.toggle", { id: "tasker-detail" }]]);
});

test("boards: one tab per project and one for all, the pills go from one to another", async () => {
  const { view } = await mount({ role: "board", project: "pw" });
  const tree = walk(render(view).tree);
  const ids = tree.map((n) => n.id).filter(Boolean);
  assert.ok(ids.includes("card-next1") && !ids.includes("card-doing1"), "Website's tasks only");
  assert.ok(ids.includes("bp-all") && ids.includes("bp-pa"), "pills to the other boards");
  assert.ok(!tree.find((n) => n.id === "bp-pw").handlers.on_click, "this board's pill does nothing");
  // A pill opens that board's tab; open again, it's focused.
  H.runs.length = 0;
  tree.find((n) => n.id === "bp-pa").handlers.on_click({}, cx());
  assert.deepEqual(H.runs.at(-1), ["tab.new", { name: "Board · App", mod: "tasker", props: { role: "board", project: "pa" } }]);
  H.spaces[0].tabs.push({ id: "tbA", index: 9, name: "Board · App", named: true });
  H.panes.push({ pane: "pA", tab: "tbA", terminal: null, mod: "tasker", title: "tasker" });
  tree.find((n) => n.id === "bp-pa").handlers.on_click({}, cx());
  assert.deepEqual(H.runs.at(-1), ["pane.focus", { pane: "pA" }]);
  // All: the fixture's "Board" tab.
  tree.find((n) => n.id === "bp-all").handlers.on_click({}, cx());
  assert.deepEqual(H.runs.at(-1), ["pane.focus", { pane: "pB" }]);
});

test("a project's row shows its actions while the pointer is on it", async () => {
  const { view } = await mount({ role: "sidebar" });
  H.shared["tasker.view"] = "projects";
  const ids = () => walk(render(view).tree).map((n) => n.id).filter(Boolean);
  assert.ok(!ids().includes("pboard-p:pa"), "out of the way");
  assert.ok(!ids().includes("board"), "no board button in Projects' header: each project has its own");
  walk(render(view).tree).find((n) => n.id === "p:pa").handlers.on_hover(true, cx());
  assert.ok(["pboard-p:pa", "pterm-p:pa", "padd-p:pa", "pmore-p:pa"].every((i) => ids().includes(i)));
});

test("projects reorder by dragging one onto another; a plain click still folds", async () => {
  const { view } = await mount({ role: "sidebar" });
  H.shared["tasker.view"] = "projects";
  const row = (id) => walk(render(view).tree).find((n) => n.id === id);
  row("p:pa").handlers["on_mouse_down:left"]({}, cx());
  row("p:pw").handlers.on_mouse_move({}, cx());
  assert.ok(row("p:pw").calls.some(([m]) => m === "border_b"), "a line below Website: App lands after it");
  const c = cx();
  row("p:pw").handlers["on_mouse_up:left"]({}, c);
  await settle();
  assert.deepEqual(JSON.parse(H.files.get(FILE())).projects.map((p) => p.id), ["pw", "pa"]);
  assert.ok(c.stopped > 0, "the drop isn't also a click");
  // Press and release on the same project: nothing moves.
  row("p:pa").handlers["on_mouse_down:left"]({}, cx());
  row("p:pa").handlers["on_mouse_up:left"]({}, cx());
  await settle();
  assert.deepEqual(JSON.parse(H.files.get(FILE())).projects.map((p) => p.id), ["pw", "pa"]);
  assert.equal(view.dragProject, null);
});

test("task form: due accepts words and shortcuts", async () => {
  const { view } = await mount({ dialog: "task", overlay: "ov1" });
  const c = cx();
  view.inputs.title.type("Due test", c);
  view.inputs.due.type("tomorrow", c);
  render(view);
  view.saveTask(c);
  await settle();
  const t = JSON.parse(H.files.get(FILE())).tasks.find((x) => x.title === "Due test");
  assert.match(t.due, /^\d{4}-\d{2}-\d{2}$/);
});

test("a hand-edited tasks.json with odd values still draws", async () => {
  const { view, c } = await mount({ role: "sidebar" }, () => {
    const d = JSON.parse(H.files.get(FILE()));
    d.tasks.push({ id: "odd1" }, { id: "odd2", title: 42, status: "nope", priority: "high", due: 5, tabs: "x", history: null, issue: { number: 3 } }, null, "junk");
    d.projects.push({ id: "pz" }, null);
    H.files.set(FILE(), JSON.stringify(d));
  });
  assert.deepEqual(c.errors.map(String), []);
  for (const v of ["now", "projects"]) { H.shared["tasker.view"] = v; render(view); }
  await fireAll(view);
});

test("an invalid tasks.json is never overwritten", async () => {
  const { view } = await mount({ role: "sidebar" }, () => H.files.set(FILE(), "{ broken"));
  assert.ok(view.store.error);
  await view.store.update((d) => { d.tasks.push(task({ title: "x" })); });
  assert.equal(H.files.get(FILE()), "{ broken");
  render(view);
});

test("store reloads when the file changes on disk", async () => {
  const { view } = await mount({ role: "sidebar" });
  const d = JSON.parse(H.files.get(FILE()));
  d.tasks.push(task({ id: "fromagent", title: "Added by an agent" }));
  H.files.set(FILE(), JSON.stringify(d));
  touch(FILE());
  await settle();
  assert.ok(view.store.task("fromagent"));
});
