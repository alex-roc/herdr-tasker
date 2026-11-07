// Renders every role and dialog of the mod against a busy world, then fires every
// click, press and hover in what it drew and renders again. Catches what
// `herdr-app check` can't reach: rows that only exist with data, async states,
// and handlers. A null child or a mistyped style method fails as in the app.

import { test } from "node:test";
import assert from "node:assert/strict";
import { H, touch } from "herdr";
import { walk, isElement } from "gpui-kit";
import Tasker from "../mods/tasker/main.js";
import { world, cx, settle, FILE, task } from "./fixture.mjs";

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

for (const dialog of ["task", "project", "menu", "repo", "jump", "issues", "archive", "settings", "confirm-delete"]) {
  for (const extra of [{}, { task: "blocked1", project: "pa", repo: "~/dev/app" }, { task: "review1", repo: "~/dev/web" }]) {
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
