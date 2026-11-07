// The rules under the views: dates, cleaning what's read, which tab is whose,
// what the Now view puts first, how tasks follow their agents, and what's read
// from the agents' own logs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { H } from "herdr";
import { parseDue, dueLabel, slug, shortModel, byUrgency, duration } from "../mods/tasker/lib/util.js";
import { parse, cleanTask, Store } from "../mods/tasker/lib/store.js";
import { build, nowView, projectTree } from "../mods/tasker/lib/world.js";
import { arrived, launch } from "../mods/tasker/lib/actions.js";
import { AgentInfo } from "../mods/tasker/lib/agentinfo.js";
import { RepoCache } from "../mods/tasker/lib/git.js";
import { untrackedName } from "../mods/tasker/sidebar.js";
import Tasker from "../mods/tasker/main.js";
import { world, cx, settle, until, FILE, iso, task } from "./fixture.mjs";

const at = new Date(2026, 10, 7, 15, 0); // Saturday 7 Nov 2026

test("parseDue: words, shortcuts and dates", () => {
  assert.equal(parseDue("", at), null);
  assert.equal(parseDue("today", at), "2026-11-07");
  assert.equal(parseDue("Tomorrow", at), "2026-11-08");
  assert.equal(parseDue("tmr", at), "2026-11-08");
  assert.equal(parseDue("+3", at), "2026-11-10");
  assert.equal(parseDue("3d", at), "2026-11-10");
  assert.equal(parseDue("+2w", at), "2026-11-21");
  assert.equal(parseDue("sat", at), "2026-11-14", "the next one, never today");
  assert.equal(parseDue("friday", at), "2026-11-13");
  assert.equal(parseDue("mon", at), "2026-11-09");
  assert.equal(parseDue("2026-12-01", at), "2026-12-01");
  assert.equal(parseDue("2026-2-30", at), undefined);
  assert.equal(parseDue("12-24", at), "2026-12-24");
  assert.equal(parseDue("01-05", at), "2027-01-05", "a day that passed is next year's");
  assert.equal(parseDue("soon", at), undefined);
  assert.equal(parseDue("3", at), undefined, "a bare number is ambiguous");
});

test("dueLabel and friends", () => {
  assert.equal(dueLabel(iso(0)), "today");
  assert.equal(dueLabel(iso(1)), "tomorrow");
  assert.equal(dueLabel(iso(-2)), "2d late");
  assert.equal(dueLabel(iso(3)), "in 3d");
  assert.equal(dueLabel("junk"), null);
  assert.equal(slug("Árbol de decisión: ¡v2!"), "arbol-de-decision-v2");
  assert.equal(slug("!!!"), "task");
  assert.equal(shortModel("claude-opus-5-5-20261001"), "opus 5.5");
  assert.equal(shortModel("gpt-5.5-codex"), "gpt-5.5-codex");
  assert.equal(duration(30000), "<1m");
  assert.equal(duration(90 * 60000), "1h 30m");
  assert.equal(duration(3 * 86400000), "3d");
  const a = { priority: 1, due: null, created: 2 }, b = { priority: 2, due: iso(0), created: 1 };
  assert.ok(byUrgency(a, b) < 0, "priority first");
});

test("what's read is cleaned: odd values, missing fields, junk entries", () => {
  const d = parse(JSON.stringify({
    settings: { wip: "0", stale_days: "x" },
    projects: [{ id: "p" }, null, 3],
    tasks: [{ id: "a", title: 7, status: "bogus", priority: "high", due: "tomorrow", tabs: ["tb1", 2], history: [{ s: "doing", at: 1 }, { s: "?" }] }, "junk"],
  }));
  assert.equal(d.settings.wip, 1);
  assert.equal(d.settings.stale_days, 3);
  assert.equal(d.projects.length, 1);
  assert.equal(d.projects[0].name, "Untitled");
  assert.equal(d.tasks.length, 1);
  const t = d.tasks[0];
  assert.equal(t.title, "7");
  assert.equal(t.status, "inbox");
  assert.equal(t.priority, 1);
  assert.equal(t.due, null, "words aren't kept in the file: they'd move every day");
  assert.deepEqual(t.tabs, ["tb1"]);
  assert.deepEqual(t.history, [{ s: "doing", at: 1 }]);
  assert.equal(cleanTask({ due: "2026-1-5" }).due, "2026-01-05");
  const dup = parse(JSON.stringify({ tasks: [{ id: "x", title: "a" }, { id: "x", title: "b" }, { id: "x", title: "c" }] }));
  assert.deepEqual(dup.tasks.map((t) => t.id), ["x", "x-2", "x-3"], "repeated ids are told apart, the same way every time");
  assert.throws(() => parse("[]"));
});

test("store: a fresh home starts empty and saves", async () => {
  world();
  H.files.clear();
  const s = new Store();
  await s.load();
  assert.equal(s.error, null);
  assert.equal(s.data.tasks.length, 0);
  assert.equal(await s.update((d) => { d.tasks.push(task({ id: "x" })); }), true);
  assert.equal(JSON.parse(H.files.get(FILE())).tasks[0].id, "x");
});

test("store: a write that races another one is retried, not lost", async () => {
  world();
  const s = new Store();
  await s.load();
  let raced = false;
  await s.update((d) => {
    if (!raced) { raced = true; const other = JSON.parse(H.files.get(FILE())); other.tasks.push(task({ id: "other" })); H.files.set(FILE(), JSON.stringify(other)); }
    d.tasks.push(task({ id: "mine" }));
  });
  const ids = JSON.parse(H.files.get(FILE())).tasks.map((t) => t.id);
  assert.ok(ids.includes("other") && ids.includes("mine"));
});

function look() {
  const w = build({ data: parse(H.files.get(FILE())), sp: H.spaces, ps: H.panes, ag: H.agents, ts: H.terminals, repos: new RepoCache(), h: H.home });
  return w;
}

test("world: tabs are found through the store and through terminal labels", () => {
  world();
  const w = look();
  assert.equal(w.taskById.get("doing1").tabs[0], "tb1", "label tasker.task on t1");
  assert.equal(w.taskById.get("blocked1").top, "blocked");
  assert.equal(w.taskById.get("review1").top, "done");
  assert.ok(!w.taskById.has("del1"));
  // Sub-agents: t9 working under t2, t10 blocked under t9; the finished one is left out.
  const e = w.byTab.get("tb2")[0];
  assert.deepEqual(e.subs.map((k) => [k.term.address, k.depth]), [["t9", 1], ["t10", 2]]);
  assert.deepEqual(w.untracked.map((u) => u.tab).sort(), ["tb3", "tb4", "tb5", "tb6"]);
});

test("Now: what needs you first, each task once", () => {
  world();
  const w = look();
  const v = nowView(w, parse(H.files.get(FILE())));
  const ids = (l) => l.map((x) => x.t.id);
  assert.deepEqual(ids(v.needs), ["blocked1"]);
  assert.deepEqual(ids(v.review), ["review1"]);
  assert.deepEqual(ids(v.working).sort(), ["doing1", "remote1"]);
  assert.deepEqual(ids(v.stalled), ["wait1"]);
  assert.deepEqual(ids(v.next), ["next2", "next1"], "P1 before P3");
  assert.deepEqual(ids(v.inbox).sort(), ["inbox1", "inbox2"]);
  const all = [...v.needs, ...v.review, ...v.working, ...v.stalled, ...v.next, ...v.inbox].map((x) => x.t.id);
  assert.equal(new Set(all).size, all.length);
  assert.deepEqual(v.untrackedDone.map((u) => u.tab), ["tb4"]);
});

test("Projects: repos under their project, worktrees under their repo, counts include loose tabs", () => {
  world();
  const w = look();
  const tree = projectTree(w, parse(H.files.get(FILE())), H.home, { done: false });
  const app = tree.projects.find((x) => x.p.id === "pa");
  assert.deepEqual([...app.repos.keys()], ["~/dev/app"]);
  const appRepo = app.repos.get("~/dev/app");
  // review1 has no project but its repo is App's; most urgent agent first.
  assert.deepEqual(appRepo.tasks.map((x) => x.t.id), ["blocked1", "review1", "doing1"]);
  assert.equal(app.count, 3 + appRepo.untracked.length);
  assert.ok(tree.orphan.repos.has("~"), "a folder with only a loose terminal shows under No project");
  assert.ok(tree.orphan.count > 0);
});

test("untracked tabs are named by what they run, never by address", () => {
  world();
  const w = look();
  const names = Object.fromEntries(w.untracked.map((u) => [u.tab, untrackedName(u)]));
  assert.equal(names.tb4, "spike", "a named tab keeps its name");
  assert.equal(names.tb5, "zsh · web");
  assert.equal(names.tb3, "zsh · app");
});

test("arrived: the launched tab, not another new one", () => {
  const sp = [{ id: "s", tabs: [{ id: "a" }, { id: "b", named: true, name: "Fix it" }, { id: "c", named: true, name: "Other" }] }];
  const p = { space: "s", name: "Fix it", beforeTabs: new Set(["a"]), beforeSpaces: new Set(["s"]) };
  assert.equal(arrived(p, sp), "b");
  assert.equal(arrived({ ...p, name: "Nope" }, sp, new Set(["b"])), "c", "taken tabs are skipped");
  assert.equal(arrived({ space: null, name: "x", beforeTabs: new Set(), beforeSpaces: new Set(["s"]) }, [...sp, { id: "n", tabs: [{ id: "z" }] }]), "z");
  assert.equal(arrived(p, [{ id: "s", tabs: [{ id: "a" }] }]), null);
});

test("launch: opens the agent in the repo's space and marks the task doing", async () => {
  world();
  const s = new Store();
  await s.load();
  const p = await launch(s, s.task("next1"));
  const [cmd, args] = H.runs.at(-1);
  assert.equal(cmd, "tab.new");
  assert.equal(args.space, "sp2");
  assert.deepEqual(args.argv, ["claude"]);
  assert.match(args.task, /^Write docs/);
  assert.equal(s.task("next1").status, "doing");
  assert.equal(p.name, "Write docs");
});

test("launch in a worktree: same title, its own branch", async () => {
  world({ tasks: [task({ id: "dupe", title: "Write docs", repo: "~/dev/web", branch: "task/write-docs", worktree: "~/.herdr/worktrees/web/write-docs" })] });
  const s = new Store();
  await s.load();
  await launch(s, s.task("next1"), { worktree: true });
  const t = s.task("next1");
  assert.equal(t.branch, "task/write-docs-ext1".replace("ext1", "next1".slice(-4)));
  assert.equal(H.runs.at(-1)[0], "space.new");
  const wt = H.execLog.find(([c, a]) => c === "git" && a[0] === "worktree");
  assert.deepEqual(wt[1].slice(0, 3), ["worktree", "add", "-b"]);
});

test("tasks follow their agents: working → doing, finished → review, never done", async () => {
  world();
  H.props = { role: "sidebar" };
  const v = new Tasker();
  v.init(H.props, cx());
  await until(() => v.store.loaded);
  await settle();
  v.render(cx()); // first look: nothing moves
  await settle();
  // next1 gets an agent that starts working.
  const d = JSON.parse(H.files.get(FILE()));
  d.tasks.find((t) => t.id === "next1").tabs = ["tb5"];
  H.files.set(FILE(), JSON.stringify(d));
  await v.store.load();
  H.agents.push({ address: "t1q", pane: "p5", space: "sp2", tab: "tb5", status: "working", program: { key: "claude", name: "Claude Code" }, title: "a" });
  v.render(cx());
  await settle();
  assert.equal(v.store.task("next1").status, "doing");
  H.agents.at(-1).status = "done";
  v.render(cx());
  await settle();
  assert.equal(v.store.task("next1").status, "review");
  H.agents.at(-1).status = "idle";
  v.render(cx());
  await settle();
  assert.equal(v.store.task("next1").status, "review", "never done by itself");
  assert.ok(v.store.task("next1").agent_ms >= 0);
});

test("agent info: Claude Code model, effort and context; Codex from its rollout", async () => {
  world();
  H.files.set("/home/me/.claude/sessions/1001.json", JSON.stringify({ sessionId: "abc", cwd: "/home/me/dev/app" }));
  const info = new AgentInfo();
  info.refresh(cx(), H.terminals.filter((t) => ["t1", "vps/t7"].includes(t.address)));
  await settle();
  assert.deepEqual(
    { ...info.get("t1"), session: undefined },
    { app: "claude", model: "claude-opus-5-5", effort: "high", ctx: 12 + 200000 + 3000 + 800, ctxMax: null, session: undefined },
  );
  const grep = H.execLog.find(([c, a]) => c === "sh" && a.join(" ").includes("grep"));
  assert.equal(grep[1].at(-1), "/home/me/.claude/projects/-home-me-dev-app/abc.jsonl");
  assert.deepEqual(info.get("vps/t7"), { app: "codex", model: "gpt-5.5-codex", effort: "medium", ctx: 51000, ctxMax: 272000 });
  // Shared: another copy sees it without looking again.
  const n = H.execLog.length;
  const other = new AgentInfo();
  other.refresh(cx(), H.terminals.filter((t) => t.address === "t1"));
  await settle();
  assert.equal(H.execLog.length, n);
  assert.equal(other.get("t1").model, "claude-opus-5-5");
});

test("agent info on another machine reads that machine's home", async () => {
  world();
  const t = { ...H.terminals.find((x) => x.address === "t1"), address: "vps/t1" };
  H.files.set("vps:/home/remote/.claude/sessions/1001.json", JSON.stringify({ sessionId: "r", cwd: "/srv/x" }));
  const info = new AgentInfo();
  info.refresh(cx(), [t]);
  await settle();
  assert.equal(info.get("vps/t1")?.model, "claude-opus-5-5");
  const grep = H.execLog.find(([c, a]) => c === "sh" && a.join(" ").includes("grep"));
  assert.equal(grep[2].on, "vps");
  assert.equal(grep[1].at(-1), "/home/remote/.claude/projects/-srv-x/r.jsonl");
});

test("detail: nothing is looked up while the panel is hidden", async () => {
  world();
  const find = (n) => (n.id === "tasker-detail" ? n : (n.children ?? []).map(find).find(Boolean));
  find(H.layout).hidden = true;
  H.props = { role: "detail" };
  H.shared["tasker.selected"] = "blocked1";
  const v = new Tasker();
  v.init(H.props, cx());
  await until(() => v.store.loaded);
  await settle();
  v.render(cx());
  await settle();
  assert.equal(H.hcLog.length, 0);
  assert.ok(!H.execLog.some(([c]) => c === "gh"));
  delete find(H.layout).hidden;
  v.render(cx());
  await settle();
  assert.ok(H.hcLog.some((a) => a[0] === "read"));
  assert.ok(H.execLog.some(([c]) => c === "gh"));
});
