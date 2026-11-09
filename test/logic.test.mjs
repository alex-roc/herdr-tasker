// The rules under the views: dates, cleaning what's read, which tab is whose,
// what the Now view puts first, how tasks follow their agents, and what's read
// from the agents' own logs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { H, command } from "herdr";
import { parseDue, dueLabel, slug, shortModel, byUrgency, duration, parseLater } from "../mods/tasker/lib/util.js";
import { parse, cleanTask, Store, setStatus } from "../mods/tasker/lib/store.js";
import { build, nowView, projectTree } from "../mods/tasker/lib/world.js";
import { arrived, launch, openInProject } from "../mods/tasker/lib/actions.js";
import { AgentInfo } from "../mods/tasker/lib/agentinfo.js";
import { RepoCache } from "../mods/tasker/lib/git.js";
import { parseClaude, parseCodex, Usage } from "../mods/tasker/lib/usage.js";
import { isElement, walk, text } from "gpui-kit";
import { untrackedName } from "../mods/tasker/lib/world.js";
import Tasker from "../mods/tasker/main.js";
import { world, cx, settle, until, FILE, iso, task, CLAUDE_USAGE } from "./fixture.mjs";

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

test("store: a file that can't be read is said once, not redrawn over and over", async () => {
  world();
  const s = new Store();
  await s.load();
  let draws = 0;
  s.changed = () => draws++;
  H.files.set(FILE(), "{ broken");
  assert.equal(await s.update((d) => { d.tasks.push(task({ id: "x" })); }), false);
  assert.equal(await s.update((d) => { d.tasks.push(task({ id: "x" })); }), false);
  assert.equal(draws, 1);
  assert.match(s.error, /can't be read/);
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

test("launch a task of the whole project: in the folder above its repositories, in the project's own space", async () => {
  world();
  const s = new Store();
  await s.load();
  await launch(s, s.task("next2")); // project Website (~/dev/web, /home/me/dev/docs), no repo of its own
  const [cmd, args] = H.runs.at(-1);
  assert.equal(cmd, "space.new", "not a repository's space");
  assert.equal(args.folder, "/home/me/dev");
  assert.equal(args.name, "Website");
  assert.deepEqual(args.argv, ["claude"], "both repositories are inside: nothing to add");
  assert.match(args.task, /project "Website"[\s\S]*- ~\/dev\/web[\s\S]*- \/home\/me\/dev\/docs[\s\S]*access to all of them/);
  // A task with its own repo hears of the others, without the extra access.
  await launch(s, s.task("next1"));
  assert.deepEqual(H.runs.at(-1)[1].argv, ["claude"]);
  assert.match(H.runs.at(-1)[1].task, /- ~\/dev\/web \(this task's\)/);
});

test("a project with no repositories yet: its terminal opens in the home folder, in its own space", async () => {
  world({ projects: [{ id: "pe", name: "Empty", color: "ansi2", repos: [] }] });
  const s = new Store();
  await s.load();
  openInProject(s.project("pe"));
  assert.deepEqual(H.runs.at(-1), ["space.new", { name: "Empty", folder: H.home }]);
  assert.equal(H.shared["tasker.pending"].at(-1).project, "pe");
});

test("a project's terminal: its own space above the repositories, shown at the project's level", async () => {
  world();
  const s = new Store();
  await s.load();
  const proj = s.project("pw");
  openInProject(proj);
  assert.deepEqual(H.runs.at(-1), ["space.new", { name: "Website", folder: "/home/me/dev" }]);
  const pending = H.shared["tasker.pending"].at(-1);
  assert.equal(pending.project, "pw");
  // The space arrives, its terminal labelled for the project (as the bookkeeping does).
  H.spaces.push({ id: "sp9", index: 9, name: "Website", named: true, folder: "/home/me/dev", machine: null, branch: null, active: false, status: null,
    tabs: [{ id: "tb9", index: 1, name: "1", named: false, active: true, status: null, panes: 1 }] });
  H.panes.push({ pane: "p9", tab: "tb9", terminal: "t9z", title: "t9z", cwd: "/home/me/dev", branch: null, status: null, app: null,
    program: { key: "shell", name: "zsh", shell: true, agent: false }, focused: false, zoomed: false, movable: true });
  H.terminals.push({ address: "t9z", state: "live", labels: { "herdr.space": "sp9", "herdr.tab": "tb9", "tasker.project": "pw" }, foreground: { pid: 99, argv: ["zsh"], cwd: "/home/me/dev" } });
  const w = build({ data: s.data, sp: H.spaces, ps: H.panes, ag: H.agents, ts: H.terminals, repos: new RepoCache(), h: H.home });
  const tree = projectTree(w, s.data, H.home, { done: false });
  const web = tree.projects.find((x) => x.p.id === "pw");
  assert.deepEqual(web.untracked.map((u) => u.tab), ["tb9"], "at the project's level");
  assert.ok(![...web.repos.values()].some((r) => r.untracked.some((u) => u.tab === "tb9")));
  assert.ok(!tree.orphan.repos.has("~/dev"), "not a folder under No project");
});

test("resume a task of the whole project: the other repositories are added again", async () => {
  world();
  const s = new Store();
  await s.load();
  await launch(s, s.task("next2"), { resume: { app: "claude", id: "abc", cwd: "~/dev/web", at: 1 } });
  const [, args] = H.runs.at(-1);
  assert.deepEqual(args.argv, ["claude", "--resume", "abc", "--add-dir", "/home/me/dev/docs"]);
  assert.equal(args.task, undefined, "no first message");
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
    { app: "claude", model: "claude-opus-5-5", effort: "high", ctx: 12 + 200000 + 3000 + 800, ctxMax: null, session: undefined, cwd: "/home/me/dev/app" },
  );
  const grep = H.execLog.find(([c, a]) => c === "sh" && a.join(" ").includes("grep"));
  assert.equal(grep[1].at(-1), "/home/me/.claude/projects/-home-me-dev-app/abc.jsonl");
  assert.deepEqual(info.get("vps/t7"), { app: "codex", model: "gpt-5.5-codex", effort: "medium", ctx: 51000, ctxMax: 272000,
    session: "0aa1b2c3-1111-2222-3333-444455556666", cwd: "/srv/api" });
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

test("Now and Projects stacked: each list its own view, the books kept once, key commands acted on once", async () => {
  world();
  // The layout shows the two lists, one above the other.
  const find = (n, id) => (n.id === id ? n : (n.children ?? []).map((c) => find(c, id)).find(Boolean));
  find(H.layout, "tasker-lists").active = "tasker-split";
  const mk = async (view) => {
    H.props = { role: "sidebar", view };
    const v = new Tasker();
    v.c = cx();
    v.init(H.props, v.c);
    await until(() => v.store.loaded);
    await settle();
    return v;
  };
  // Projects above, Now below (the layout's order).
  const projects = await mk("projects");
  const now = await mk("now");
  const ids = (v) => walk(v.render(cx())).map((n) => n.id).filter(Boolean);
  assert.ok(ids(now).includes("sec-needs") && !ids(now).includes("v-projects"), "Now alone, no tabs");
  assert.ok(ids(projects).some((i) => i.startsWith("p:")) && !ids(projects).includes("sec-needs"), "Projects alone");
  // An agent works, then stops: its time is added once, not once per list.
  const d = JSON.parse(H.files.get(FILE()));
  d.tasks.find((t) => t.id === "next1").tabs = ["tb5"];
  d.tasks.find((t) => t.id === "next1").agent_ms = 0;
  H.files.set(FILE(), JSON.stringify(d));
  await now.store.load(); await projects.store.load();
  H.agents.push({ address: "t1q", pane: "p5", space: "sp2", tab: "tb5", status: "working", program: { key: "claude", name: "Claude Code" }, title: "a" });
  now.render(cx()); projects.render(cx());
  await settle();
  globalThis.__tasker.books.info.workSince.t1q -= 60000;
  H.agents.at(-1).status = "done";
  now.render(cx()); projects.render(cx());
  await settle();
  await now.store.load();
  const ms = now.store.task("next1").agent_ms;
  assert.ok(ms >= 60000 && ms < 120000, `counted once: ${ms}`);
  // A key command reaches both lists; only Now acts on it.
  H.overlays.length = 0;
  command("jump");
  await settle();
  assert.equal(H.overlays.length, 1, "one dialog, not one per list");
  command("focus");
  await settle();
  assert.ok(now.c.focused && !projects.c.focused, "Now takes the keys");
});

test("Now: a finished agent asks for a review only of work in progress", () => {
  world();
  const d = JSON.parse(H.files.get(FILE()));
  // t4 is done (unseen) on tab tb4: give it to a task in Next.
  d.tasks.push(task({ id: "later-agent", title: "Parked", status: "next", tabs: ["tb4"] }));
  const data = parse(JSON.stringify(d));
  const w = build({ data, sp: H.spaces, ps: H.panes, ag: H.agents, ts: H.terminals, repos: new RepoCache(), h: H.home });
  const v = nowView(w, data);
  assert.ok(!v.review.some((x) => x.t.id === "later-agent"), "Next is your call");
  assert.ok(v.next.some((x) => x.t.id === "later-agent"));
});

test("Later: put off until a day or someday, out of Now's lists, soonest first", () => {
  assert.equal(parseLater("someday"), "someday");
  assert.equal(parseLater("tomorrow", at), "2026-11-08");
  assert.equal(parseLater("blah"), undefined);
  assert.equal(parseLater("today", at), null, "today isn't later");
  assert.equal(parseLater("2020-01-01", at), null);
  world();
  const d = JSON.parse(H.files.get(FILE()));
  d.tasks.find((t) => t.id === "next1").snooze = "someday";
  d.tasks.find((t) => t.id === "inbox1").snooze = iso(2);
  d.tasks.find((t) => t.id === "blocked1").snooze = iso(2); // its agent asks: still in Needs you
  const data = parse(JSON.stringify(d));
  const w = build({ data, sp: H.spaces, ps: H.panes, ag: H.agents, ts: H.terminals, repos: new RepoCache(), h: H.home });
  const v = nowView(w, data);
  const ids = (l) => l.map((x) => x.t.id);
  assert.deepEqual(ids(v.later), ["inbox1", "next1"]);
  assert.ok(!ids(v.next).includes("next1") && !ids(v.inbox).includes("inbox1"));
  assert.ok(ids(v.needs).includes("blocked1"));
  // Starting it is no longer putting it off.
  const t = data.tasks.find((x) => x.id === "next1");
  setStatus(t, "doing");
  assert.equal(t.snooze, null);
});

test("Later comes back on its day with one notification, and what's due is told once a day", async () => {
  world();
  const d = JSON.parse(H.files.get(FILE()));
  d.tasks.find((t) => t.id === "next1").snooze = iso(0);
  H.files.set(FILE(), JSON.stringify(d));
  const mk = async (view) => {
    H.props = { role: "sidebar", view };
    const v = new Tasker();
    v.init(H.props, cx());
    await until(() => v.store.loaded);
    await settle();
    return v;
  };
  const find = (n, id) => (n.id === id ? n : (n.children ?? []).map((c) => find(c, id)).find(Boolean));
  find(H.layout, "tasker-lists").active = "tasker-split";
  const a = await mk("projects"), b = await mk("now");
  H.notes.length = 0;
  a.render(cx()); b.render(cx());
  await settle();
  await a.store.load();
  assert.equal(a.store.task("next1").snooze, null, "back");
  const backs = H.notes.filter((n) => /Back from Later/.test(n.title));
  assert.equal(backs.length, 1, "told once, not once per list");
  assert.equal(backs[0].action.name, "tasker.select:next1");
  const dues = H.notes.filter((n) => !/Back from Later/.test(n.title));
  assert.equal(dues.length, 1);
  assert.match(dues[0].body, /Add login/);
  // The next look the same day: nothing new.
  H.notes.length = 0;
  a.render(cx()); b.render(cx());
  await settle();
  assert.equal(H.notes.length, 0);
});

test("reminders off: nothing is sent", async () => {
  world({ settings: { reminders: false } });
  H.props = { role: "sidebar" };
  const v = new Tasker();
  v.init(H.props, cx());
  await until(() => v.store.loaded);
  await settle();
  H.notes.length = 0;
  v.render(cx());
  await settle();
  assert.equal(H.notes.length, 0);
});

test("an agent that reports no state (claude attach) is still an agent, its state from its title", () => {
  world();
  // t6's pane runs Claude Code attached to its background session: no status, not in agents().
  const p6 = H.panes.find((p) => p.terminal === "t6");
  p6.app = "claude-code";
  p6.program = { key: "claude", name: "Claude Code", agent: false, shell: false };
  const data = parse(H.files.get(FILE()));
  const w = build({ data, sp: H.spaces, ps: H.panes, ag: H.agents, ts: H.terminals, repos: new RepoCache(), h: H.home });
  const u = w.untracked.find((x) => x.tab === "tb6");
  assert.equal(u.agents.length, 1);
  assert.equal(u.agents[0].status, "unknown");
  assert.ok(nowView(w, data).untrackedIdle.some((x) => x.tab === "tb6"), "shown in Now, under Not in a task");
  // Its title tells working (a spinner first) from idle (✳).
  const t6 = H.terminals.find((t) => t.address === "t6");
  t6.title = "◑ Fix the parser";
  const ww = build({ data, sp: H.spaces, ps: H.panes, ag: H.agents, ts: H.terminals, repos: new RepoCache(), h: H.home });
  assert.equal(ww.untracked.find((x) => x.tab === "tb6").top, "working");
  assert.ok(nowView(ww, data).untrackedWorking.some((x) => x.tab === "tb6"), "in Working");
  t6.title = "✳ Fix the parser";
  const wi = build({ data, sp: H.spaces, ps: H.panes, ag: H.agents, ts: H.terminals, repos: new RepoCache(), h: H.home });
  assert.equal(wi.untracked.find((x) => x.tab === "tb6").top, "idle");
  delete t6.title;
  // A shell whose report lingers from an agent that quit is no agent.
  p6.program = { key: "shell", name: "zsh", agent: false, shell: true };
  const w2 = build({ data, sp: H.spaces, ps: H.panes, ag: H.agents, ts: H.terminals, repos: new RepoCache(), h: H.home });
  assert.equal(w2.untracked.find((x) => x.tab === "tb6").agents.length, 0);
});

test("an agent's state from its title as the core has it (Herdr strips the mark for mods)", async () => {
  world();
  const p6 = H.panes.find((p) => p.terminal === "t6");
  p6.program = { key: "claude", name: "Claude Code", agent: false, shell: false };
  H.hc = (args) => (args[0] === "get" && args[1] === "t6" ? { code: 0, stdout: JSON.stringify({ title: "◐ Fix the parser" }) } : { code: 0, stdout: "" });
  H.props = { role: "sidebar" };
  const v = new Tasker();
  v.init(H.props, cx());
  await until(() => v.store.loaded);
  v.render(cx());
  await settle();
  assert.equal(H.shared["tasker.titles"] != null, true, "a change redraws every copy");
  v.render(cx());
  assert.equal(v.world.untracked.find((x) => x.tab === "tb6").top, "working");
  // Looked again within a few seconds: not asked again.
  const n = H.hcLog.filter((a) => a[0] === "get").length;
  v.render(cx());
  await settle();
  assert.equal(H.hcLog.filter((a) => a[0] === "get").length, n);
});

test("every agent's tab a task: light ones follow their agent, vanish with their tab, and become yours once you touch them", async () => {
  world({ settings: { track: true } });
  H.props = { role: "sidebar" };
  const v = new Tasker();
  v.init(H.props, cx());
  await until(() => v.store.loaded);
  v.render(cx());
  await settle();
  await v.store.load();
  const light = () => v.store.data.tasks.filter((t) => t.auto);
  // tb4's agent (done) had no task: now a light one, in Review; shells (tb3, tb6) aren't tasks.
  assert.deepEqual(light().map((t) => [t.tabs[0], t.status]), [["tb4", "review"]]);
  const id = light()[0].id;
  // Its name follows its agent's.
  H.agents.find((a) => a.address === "t4").title = "Spike the cache";
  H.terminals.find((t) => t.address === "t4").title = "Spike the cache";
  v.render(cx());
  await settle();
  assert.equal(v.store.task(id).title, "Spike the cache");
  // Its tab closes: gone a minute later (not at once: Herdr may be bringing spaces back).
  H.spaces[0].tabs = H.spaces[0].tabs.filter((t) => t.id !== "tb4");
  H.agents = H.agents.filter((a) => a.address !== "t4");
  v.render(cx());
  await settle();
  assert.ok(v.store.task(id), "still there right after");
  globalThis.__tasker.books.info.gone[id] -= 61000;
  v.render(cx());
  await settle();
  assert.equal(v.store.task(id), null, "gone");
});

test("a light task you touch is yours: it keeps its name and stays when its tab closes", async () => {
  world({ settings: { track: true } });
  H.props = { role: "sidebar" };
  const v = new Tasker();
  v.init(H.props, cx());
  await until(() => v.store.loaded);
  v.render(cx());
  await settle();
  await v.store.load();
  const id = v.store.data.tasks.find((t) => t.auto).id;
  // Priority set from the list's keys: kept.
  H.shared["tasker.selected"] = id;
  v.command("p1", cx());
  await settle();
  assert.equal(v.store.task(id).auto, undefined);
  H.spaces[0].tabs = H.spaces[0].tabs.filter((t) => t.id !== "tb4");
  H.agents = H.agents.filter((a) => a.address !== "t4");
  v.render(cx());
  await settle();
  assert.ok(!globalThis.__tasker.books.info.gone?.[id], "not counted down");
  assert.ok(v.store.task(id), "still there");
});

test("a tab whose task you deleted isn't taken again by itself", async () => {
  world({ settings: { track: true }, tasks: [task({ id: "gone1", title: "Old", status: "next", tabs: ["tb4"], deleted: true })] });
  H.props = { role: "sidebar" };
  const v = new Tasker();
  v.init(H.props, cx());
  await until(() => v.store.loaded);
  v.render(cx());
  await settle();
  await v.store.load();
  assert.ok(!v.store.data.tasks.some((t) => t.auto));
  assert.ok(v.world.untracked.some((u) => u.tab === "tb4"), "still under Not in a task, with Make task");
});

test("agents back after a restart: a terminal back as a fresh shell gets its conversation resumed, once", async () => {
  world();
  const { Revive, FILE: REVIVE } = await import("../mods/tasker/lib/revive.js");
  const sent = [];
  const realExec = H.exec;
  H.exec = (cmd, args, opts) => (cmd === "env" ? (sent.push(args), { code: 0, stdout: "" }) : realExec(cmd, args, opts));
  const info = { get: (a) => (a === "t5" ? { app: "claude", session: "sess-1", cwd: "/home/me/dev/app", model: "claude-opus-5-5" } : a === "t6" ? { app: "claude", session: "empty", cwd: "/home/me" } : null) };
  const term = (pid, fgPid, agent, tab = "tbR") => ({ address: "t5", state: "live", pid, labels: { "herdr.tab": tab },
    foreground: { pid: fgPid, argv: agent ? ["claude"] : ["/bin/zsh", "-l"], cwd: "/home/me/dev/app" }, program: { agent } });
  const r = new Revive();
  const c = cx();
  r.step(c, [], info);
  await settle();
  // An agent at work: remembered (one without a transcript, t6, isn't).
  const t6 = { ...term(70, 71, true), address: "t6" };
  r.step(c, [term(10, 11, true), t6], info);
  await settle();
  const saved = JSON.parse(H.files.get(REVIVE()));
  assert.equal(saved.t5.id, "sess-1");
  assert.ok(!saved.t6, "an empty conversation can't resume");
  // Right after a crash the old pid lingers with nothing in front: not "quit by hand".
  r.step(c, [term(10, null, false)], info);
  // Back as a fresh shell (another pid): the resume is typed, once, without hc's "from" wrapper.
  H.notes.length = 0;
  r.step(c, [term(20, 20, false)], info);
  r.step(c, [term(20, 20, false)], info);
  await settle();
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0], ["-u", "HC_TERMINAL_ID", "hc", "send", "t5", "cd '/home/me/dev/app' && claude --resume sess-1"]);
  assert.match(H.notes[0].title, /agent is back/);
  // Quit by hand (the same shell in front for a while): forgotten, so a later crash types nothing.
  r.c.recs.t5.quit = Date.now() - 20000;
  r.step(c, [term(20, 20, false)], info);
  assert.ok(!r.c.recs.t5);
  // An address reused by a terminal in another tab gets nothing.
  r.c.recs.t5 = { pid: 30, tab: "tbR", app: "claude", id: "sess-1", cwd: "/x", at: Date.now() };
  r.step(c, [term(40, 40, false, "tbOther")], info);
  await settle();
  assert.equal(sent.length, 1);
  assert.ok(!r.c.recs.t5);
  H.exec = realExec;
});

test("detail: looks again without redrawing unless something changed, and skips the screen in view", async () => {
  world();
  H.props = { role: "detail" };
  H.shared["tasker.selected"] = "blocked1";
  const v = new Tasker();
  const c = cx();
  v.init(H.props, c);
  await until(() => v.store.loaded);
  await settle();
  v.render(cx());
  await settle();
  assert.ok(H.hcLog.some((a) => a[0] === "read"), "first look reads the screen");
  // Same answers again: nothing to draw.
  const lc = cx();
  v.det.at = 0;
  v.lookUp(lc, v.world.taskById.get("blocked1"));
  await settle();
  assert.equal(lc.notified, 0);
  // The agent's terminal has the focus: its screen isn't read.
  H.hcLog.length = 0;
  H.focused = { pane: v.leadOf(v.world.taskById.get("blocked1")).a.pane };
  v.det.at = 0;
  v.lookUp(cx(), v.world.taskById.get("blocked1"));
  await settle();
  assert.ok(!H.hcLog.some((a) => a[0] === "read"));
});

test("detail: a priority picked there is saved and drawn at once", async () => {
  world();
  H.props = { role: "detail" };
  H.shared["tasker.selected"] = "blocked1";
  const v = new Tasker();
  const c = cx();
  v.init(H.props, c);
  await until(() => v.store.loaded);
  await settle();
  const chip = walk(v.render(cx())).find((n) => n.id === "dp-3");
  const before = c.notified;
  chip.handlers.on_click({}, cx());
  await settle();
  assert.equal(v.store.task("blocked1").priority, 3);
  assert.ok(c.notified > before, "the copy that wrote redraws");
});

test("plan usage: Claude's get_usage reply and Codex's logged limits", () => {
  const now = Date.now();
  const c = parseClaude(CLAUDE_USAGE, now);
  assert.equal(c.five.pct, 28);
  assert.equal(c.week.pct, 74);
  assert.ok(c.five.resets > now);
  // Only the newer "limits" list: still read.
  const alt = parseClaude(JSON.stringify({ response: { response: { rate_limits: { limits: [{ kind: "session", percent: 5 }, { kind: "weekly_all", percent: 9 }] } } } }), now);
  assert.deepEqual([alt.five.pct, alt.week.pct], [5, 9]);
  assert.throws(() => parseClaude(JSON.stringify({ response: { response: { rate_limits_available: false } } })));
  // A reset that passed means the window is empty again.
  const past = parseClaude(JSON.stringify({ response: { response: { rate_limits: { five_hour: { utilization: 99, resets_at: new Date(now - 1000).toISOString() } } } } }), now);
  assert.equal(past.five.pct, 0);
  const line = JSON.stringify({ timestamp: new Date(now).toISOString(), payload: { type: "token_count", rate_limits: { secondary: { used_percent: 12, window_minutes: 10080 }, primary: { used_percent: 8.4, window_minutes: 300 } } } });
  const x = parseCodex(`junk\n${line}\n{"other":1}`, now);
  assert.deepEqual([x.five.pct, x.week.pct], [8, 12]);
  assert.equal(parseCodex("nothing here"), null);
});

test("plan usage is off unless turned on", () => {
  assert.equal(parse("{}").settings.usage, false);
  assert.equal(parse('{"settings":{"usage":true}}').settings.usage, true);
});

test("status bar: plan usage shown, colored by the fuller limit, and off when asked", async () => {
  world({ settings: { usage: true } });
  H.props = { role: "status" };
  const v = new Tasker();
  v.init(H.props, cx());
  await until(() => v.store.loaded);
  v.render(cx());
  await settle();
  const words = text(v.render(cx()));
  assert.match(words, /Claude 28% wk 74%/);
  assert.match(words, /Codex 8% wk 92%/);
  const t = (await import("herdr")).theme();
  const codex = walk(v.render(cx())).find((n) => n.id === "st-u-codex");
  assert.ok(codex.calls.some(([m, a]) => m === "text_color" && a[0] === t.blocked), "92% is red");
  const n = H.execLog.length;
  v.render(cx());
  await settle();
  assert.equal(H.execLog.length, n, "not asked again within 5 minutes");
  // Off in the settings: nothing shown, nothing run.
  const d = JSON.parse(H.files.get(FILE())); d.settings.usage = false; H.files.set(FILE(), JSON.stringify(d));
  await v.store.load();
  assert.doesNotMatch(text(v.render(cx())), /Claude/);
});

async function mountRole(props, setup) {
  world();
  setup?.();
  H.props = props;
  const v = new Tasker();
  v.init(props, cx());
  await until(() => v.store.loaded);
  await settle();
  return v;
}

test("agents in no task: their own Now section, and Make task picks a status from the agent", async () => {
  const v = await mountRole({ role: "sidebar" }, () => { H.agents.find((a) => a.address === "t4").status = "idle"; });
  const words = text(v.render(cx()));
  assert.match(words, /Not in a task/);
  const w = v.world;
  const { adopt } = await import("../mods/tasker/lib/actions.js");
  const u = w.untracked.find((x) => x.tab === "tb4");
  const id = await adopt(v.store, u);
  const t = v.store.task(id);
  assert.equal(t.status, "next", "an idle agent's task is planned, not in progress");
  assert.deepEqual(t.tabs, ["tb4"]);
  assert.equal(t.title, "spike");
  assert.ok(H.hcLog.some((a) => a[0] === "label" && a[2] === `tasker.task=${id}`), "its terminal is labelled");
});

test("board: dragging a loose agent onto a column makes it a task there", async () => {
  const v = await mountRole({ role: "board" });
  const tree = v.render(cx());
  const card = walk(tree).find((n) => n.id === "loose-tb4");
  assert.ok(card, "the No task lane lists the loose agent");
  const c = cx();
  card.handlers["on_mouse_down:left"]({}, c);
  walk(v.render(cx())).find((n) => n.id === "col-review").handlers["on_mouse_up:left"]({}, c);
  await settle();
  const t = v.store.data.tasks.find((x) => x.tabs.includes("tb4"));
  assert.equal(t?.status, "review");
  assert.ok(!walk(v.render(cx())).some((n) => n.id === "loose-tb4"), "and leaves the lane");
});

test("find a task in attach mode ties the loose tab to the picked task", async () => {
  const v = await mountRole({ dialog: "jump", overlay: "ov1", attach: "tb3" });
  v.query = "pick a database";
  const c = cx();
  v.pickJump(undefined, c);
  await settle();
  assert.ok(v.store.task("blocked1").tabs.includes("tb3"));
  assert.ok(v.jumpList().every((x) => ["inbox", "next", "doing", "waiting", "review"].includes(x.status)), "only open tasks are offered");
});

test("sessions are kept on the task, and Resume continues the last one in its folder", async () => {
  const v = await mountRole({ role: "sidebar" }, () => {
    H.files.set("/home/me/.claude/sessions/1001.json", JSON.stringify({ sessionId: "sess-1", cwd: "/home/me/dev/app" }));
  });
  v.render(cx());
  await settle();
  v.render(cx());
  await settle();
  const t = v.store.task("doing1");
  assert.deepEqual(t.sessions.map((x) => [x.app, x.id, x.cwd]), [["claude", "sess-1", "~/dev/app"]]);
  // Its agent is gone (a restart): Resume.
  H.agents = H.agents.filter((a) => a.address !== "t1");
  H.terminals = H.terminals.filter((x) => x.address !== "t1");
  v.resume(cx(), v.store.task("doing1"));
  await settle();
  const [cmd, args] = H.runs.filter(([c]) => c === "tab.new" || c === "space.new").at(-1);
  assert.deepEqual(args.argv, ["claude", "--resume", "sess-1"]);
  assert.equal(args.folder, "/home/me/dev/app");
  assert.equal(args.task, undefined, "no first message: the conversation is already there");
  assert.equal(cmd, "tab.new");
});

test("detail offers Resume when the task's agent is gone", async () => {
  const v = await mountRole({ role: "detail" }, () => {
    H.shared["tasker.selected"] = "next1";
    const d = JSON.parse(H.files.get(FILE()));
    d.tasks.find((x) => x.id === "next1").sessions = [{ app: "codex", id: "0aa1b2c3-1111-2222-3333-444455556666", cwd: "~/dev/web", at: Date.now() - 3600000 }];
    H.files.set(FILE(), JSON.stringify(d));
  });
  const node = walk(v.render(cx())).find((n) => n.id === "d-resume");
  assert.ok(node);
  node.handlers.on_click({}, cx());
  await settle();
  const args = H.runs.filter(([c]) => c === "tab.new").at(-1)[1];
  assert.deepEqual(args.argv, ["codex", "resume", "0aa1b2c3-1111-2222-3333-444455556666"]);
});

test("Linear: no key says how to add one; with a key, assigned issues import with priority and due", async () => {
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    calls.push([url, opts]);
    return { ok: true, status: 200, json: async () => ({ data: { viewer: { assignedIssues: { nodes: [
      { identifier: "ENG-12", title: "Rate limits on login", url: "https://linear.app/o/issue/ENG-12", description: "Too many tries", priority: 1, dueDate: "2026-12-01", state: { name: "Todo" }, team: { key: "ENG" }, labels: { nodes: [{ name: "bug" }] } },
      { identifier: "ENG-13", title: "Low one", url: "https://linear.app/o/issue/ENG-13", priority: 4, dueDate: null, state: { name: "Backlog" }, labels: { nodes: [] } },
    ] } } } }) };
  };
  try {
    let v = await mountRole({ dialog: "issues", overlay: "ov1", source: "linear", repo: "~/dev/app" });
    assert.match(text(v.render(cx())), /personal API key/);
    assert.equal(calls.length, 0);

    v = await mountRole({ dialog: "issues", overlay: "ov1", source: "linear", repo: "~/dev/app" }, () => {
      H.files.set(`${H.appHome}/data/tasker/linear-key`, "lin_api_test\n");
    });
    await settle();
    assert.equal(calls[0][1].headers.Authorization, "lin_api_test");
    assert.match(text(v.render(cx())), /ENG-12/);
    walk(v.render(cx())).find((n) => n.id === "i-ENG-12").handlers.on_click({}, cx());
    walk(v.render(cx())).find((n) => n.id === "import").handlers.on_click({}, cx());
    await settle();
    const t = v.store.data.tasks.find((x) => x.issue?.number === "ENG-12");
    assert.equal(t.status, "inbox");
    assert.equal(t.priority, 1);
    assert.equal(t.due, "2026-12-01");
    assert.equal(t.issue.source, "linear");
    const { S } = await import("../mods/tasker/strings.js");
    assert.match(S.prompt(t), /^Rate limits on login[\s\S]*Linear issue ENG-12/);
  } finally {
    globalThis.fetch = realFetch;
  }
});
