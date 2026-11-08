// A busy world for the tests: two projects, tasks in every status, agents in
// every state (one blocked with a question, sub-agents), untracked tabs, a space
// on another machine, and git, gh, hc and the session logs answering.

import { readFileSync } from "node:fs";
import { H, reset } from "herdr";

// The real layout, with the detail column shown.
const LAYOUT = JSON.parse(readFileSync(new URL("../layouts/tasker.json", import.meta.url), "utf8"));
const unhide = (n) => { if (n.id === "tasker-detail") delete n.hidden; (n.children ?? []).forEach(unhide); return n; };

export const DAY = 86400000;
export const iso = (days) => { const d = new Date(Date.now() + days * DAY); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

export function cx() {
  const c = {
    notified: 0, tasks: [], errors: [], stopped: 0,
    notify() { c.notified++; },
    spawn(fn) {
      const p = Promise.resolve().then(() => fn(c)).catch((e) => { c.errors.push(e); });
      c.tasks.push(p);
      return p;
    },
    timer: { every() { return {}; }, after() { return {}; } },
    focus_handle() { return { focus() { c.focused = true; } }; },
    stop_propagation() { c.stopped++; },
  };
  return c;
}

// Waits until `cond()` holds (real I/O, like the store's mkdir, takes its own time).
export async function until(cond, ms = 5000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 2));
  }
}

// Lets spawned work (and work it spawns) finish.
export async function settle(n = 30) {
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r));
}

let n = 0;
export function task(fields = {}) {
  const now = Date.now();
  return {
    id: fields.id ?? `k${++n}`, title: `Task ${n}`, project: null, repo: null, status: "next", priority: 2, due: null, estimate: null,
    next_step: "", notes: "", issue: null, pr: null, worktree: null, branch: null, tabs: [], created: now - 2 * DAY, updated: now - DAY,
    done_at: null, agent_ms: 0, history: [{ s: fields.status ?? "next", at: now - DAY }], ...fields,
  };
}

const pane = (p, tab, terminal, cwd, extra = {}) => ({ pane: p, terminal, tab, title: terminal ?? "Board", cwd, branch: "main", status: null, app: null,
  program: { key: "shell", name: "zsh", icon: "icons/shell.svg", tint: true, shell: true, agent: false }, focused: false, zoomed: false, movable: true, ...extra });
const agentProgram = { key: "claude", name: "Claude Code", icon: "icons/claude.svg", tint: false, shell: false, agent: true };
const agent = (address, p, space, tab, status, extra = {}) => ({ address, pane: p, space, space_name: "app", tab, tab_index: 1, tab_name: "x",
  status, app: "claude-code", program: agentProgram, title: `agent ${address}`, seq: 1, pinned: false, focused: false, ...extra });
const term = (address, space, tab, status, extra = {}) => ({ address, state: "live", status, labels: { "herdr.space": space, "herdr.tab": tab },
  foreground: { pid: 1000 + Number(address.replace(/\D/g, "") || 0), argv: ["claude"], cwd: "/home/me/dev/app", name: "2.1.0" },
  turn: 3, status_ms: Date.now() - 4 * 60000, ...extra });
const tab = (id, index, extra = {}) => ({ id, index, name: String(index), named: false, active: index === 1, status: null, panes: 1, zoomed: false,
  settled: false, settled_at: null, changed_at: null, working_since: null, ...extra });

export const CLAUDE_USAGE = JSON.stringify({ type: "control_response", response: { subtype: "success", request_id: "tasker-usage", response: {
  subscription_type: "team", rate_limits_available: true,
  rate_limits: { five_hour: { utilization: 28, resets_at: new Date(Date.now() + 3600000).toISOString() }, seven_day: { utilization: 74, resets_at: new Date(Date.now() + 3 * 86400000).toISOString() } } } } });

export const FILE = () => `${H.appHome}/data/tasker/tasks.json`;

export function world({ tasks: extraTasks = [], projects: extraProjects, settings } = {}) {
  reset();
  H.layout = unhide(structuredClone(LAYOUT));
  H.spaces = [
    { id: "sp1", index: 1, name: "app", named: false, folder: "/home/me/dev/app", machine: null, branch: "main", active: true, status: "blocked",
      tabs: [tab("tb1", 1), tab("tb2", 2), tab("tb3", 3), tab("tb4", 4, { named: true, name: "spike" }), tab("tbB", 5, { named: true, name: "Board" })] },
    { id: "sp2", index: 2, name: "web", named: false, folder: "/home/me/dev/web", machine: null, branch: "dev", active: false, status: null, tabs: [tab("tb5", 1)] },
    { id: "sp3", index: 3, name: "~", named: false, folder: "", machine: null, branch: null, active: false, status: null, tabs: [tab("tb6", 1)] },
    { id: "vps/sp4", index: 4, name: "api", named: false, folder: "/srv/api", machine: "vps", branch: "main", active: false, status: "working", tabs: [tab("vps/tb7", 1)] },
    { id: "sp5", index: 5, name: "feature", named: false, folder: "/home/me/.herdr/worktrees/app/feature", machine: null, branch: "task/feature", active: false, status: "done", tabs: [tab("tb8", 1)] },
  ];
  H.panes = [
    pane("p1", "tb1", "t1", "/home/me/dev/app", { status: "working", program: agentProgram }),
    pane("p2", "tb2", "t2", "/home/me/dev/app/src", { status: "blocked", program: agentProgram }),
    pane("p3", "tb3", "t3", "/home/me/dev/app"),
    pane("p4", "tb4", "t4", "/home/me/dev/app", { status: "done", program: agentProgram }),
    pane("pB", "tbB", null, null, { mod: "tasker" }),
    pane("p5", "tb5", "t1q", "/home/me/dev/web"),
    pane("p6", "tb6", "t6", "/home/me"),
    pane("vps/p7", "vps/tb7", "vps/t7", "/srv/api", { status: "working", program: agentProgram }),
    pane("p8", "tb8", "t8", "/home/me/.herdr/worktrees/app/feature", { status: "done", program: agentProgram }),
  ];
  H.agents = [
    agent("t1", "p1", "sp1", "tb1", "working"),
    agent("t2", "p2", "sp1", "tb2", "blocked"),
    agent("t4", "p4", "sp1", "tb4", "done"),
    agent("vps/t7", "vps/p7", "vps/sp4", "vps/tb7", "working"),
    agent("t8", "p8", "sp5", "tb8", "done"),
  ];
  H.terminals = [
    term("t1", "sp1", "tb1", "working", { labels: { "herdr.space": "sp1", "herdr.tab": "tb1", "tasker.task": "doing1" } }),
    term("t2", "sp1", "tb2", "blocked", { report: { app: "claude-code", state: "blocked", msg: "answer: Use Postgres or SQLite?" }, records: { a: { title: "Read the schema", state: "done" }, b: { title: "Plan the migration", state: "working" } } }),
    term("t3", "sp1", "tb3", null, { foreground: { pid: 2003, argv: ["zsh"], name: "zsh" } }),
    term("t4", "sp1", "tb4", "done"),
    term("t1q", "sp2", "tb5", null, { foreground: { pid: 2005, argv: ["zsh"], name: "zsh" } }),
    term("t6", "sp3", "tb6", null, { foreground: null }),
    term("vps/t7", "sp4", "tb7", "working", { foreground: { pid: 3007, argv: ["codex"], cwd: "/srv/api", name: "codex" } }),
    term("t8", "sp5", "tb8", "done"),
    term("t9", "sp1", "tb2", "working", { parent: "t2", name: "sub: tests" }),
    term("t10", "sp1", "tb2", "blocked", { parent: "t9", name: "sub-sub" }),
    term("t11", "sp1", "tb2", "idle", { parent: "t2", state: "finished" }),
  ];
  const projects = extraProjects ?? [
    { id: "pa", name: "App", color: "ansi4", repos: ["~/dev/app"], collapsed: false },
    { id: "pw", name: "Website", color: "ansi5", repos: ["~/dev/web", "/home/me/dev/docs"], collapsed: false },
  ];
  const tasks = [
    task({ id: "doing1", title: "Add login", project: "pa", repo: "~/dev/app", status: "doing", priority: 1, due: iso(-2), tabs: [], next_step: "Wire the form" }),
    task({ id: "blocked1", title: "Pick a database", project: "pa", repo: "~/dev/app", status: "doing", tabs: ["tb2"], due: iso(0), issue: { number: 12, url: "https://github.com/o/app/issues/12", body: "We need one." } }),
    task({ id: "review1", title: "Fix the header", repo: "~/dev/app", status: "review", tabs: ["tb8"], worktree: "~/.herdr/worktrees/app/feature", branch: "task/feature", due: iso(1) }),
    task({ id: "next1", title: "Write docs", project: "pw", repo: "~/dev/web", status: "next", priority: 3, due: iso(3), estimate: "2h" }),
    task({ id: "next2", title: "Ship release", project: "pw", status: "next", priority: 1, due: iso(30) }),
    task({ id: "wait1", title: "Wait for review", repo: "~/dev/web", status: "waiting", updated: Date.now() - 10 * DAY }),
    task({ id: "inbox1", title: "Idea: dark mode", status: "inbox", due: "next week" }),
    task({ id: "inbox2", title: "Idea from an issue", repo: "~/dev/web", status: "inbox", issue: { number: 7, url: "https://github.com/o/web/issues/7" } }),
    task({ id: "done1", title: "Done today", status: "done", done_at: Date.now() - 3600000, repo: "~/dev/app" }),
    task({ id: "done2", title: "Done long ago", status: "done", done_at: Date.now() - 30 * DAY }),
    task({ id: "drop1", title: "Dropped", status: "dropped" }),
    task({ id: "arch1", title: "Archived", status: "done", archived: true, done_at: Date.now() - DAY }),
    task({ id: "del1", title: "Deleted", status: "next", deleted: true }),
    task({ id: "remote1", title: "Remote work", repo: "/srv/api", status: "doing", tabs: ["vps/tb7"] }),
    ...extraTasks,
  ];
  H.files.set(FILE(), JSON.stringify({ version: 1, settings: { wip: 2, stale_days: 3, agent: "claude", ...settings }, projects, tasks }, null, 1));
  H.exec = fakeExec;
  H.hc = (args) => (args[0] === "read" ? { code: 0, stdout: "[hc] note\n$ npm test\n\n✓ 12 passed\n> ", stderr: "" } : { code: 0, stdout: "", stderr: "" });
  return H;
}

// git, gh and the log readers, answering for the repos above.
function fakeExec(cmd, args, opts) {
  const cwd = opts?.cwd ?? "";
  const ok = (stdout) => ({ code: 0, stdout, stderr: "" });
  if (cmd === "git") {
    const a = args.filter((x) => !x.startsWith("-c") && !x.startsWith("core.") && !x.startsWith("diff.") && x !== "--no-optional-locks");
    if (a[0] === "rev-parse" && a.includes("--show-toplevel")) {
      if (cwd.startsWith("/home/me/.herdr/worktrees/app/feature")) return ok("/home/me/.herdr/worktrees/app/feature\n/home/me/dev/app/.git");
      for (const r of ["/home/me/dev/app", "/home/me/dev/web", "/srv/api"]) if (cwd.startsWith(r)) return ok(`${r}\n${r}/.git`);
      return { code: 128, stdout: "", stderr: "fatal: not a git repository" };
    }
    if (a[0] === "status") return ok("# branch.oid abc\n# branch.head main\n# branch.ab +2 -0\n1 .M N... 100644 100644 100644 a b src/x.js\n? new.txt");
    if (a[0] === "diff") return ok("10\t2\tsrc/x.js\n-\t-\timg.png\n");
    if (a[0] === "rev-parse" && a.includes("--verify")) return { code: 1, stdout: "", stderr: "" };
    if (a[0] === "worktree" || a[0] === "branch") return ok("");
    return ok("");
  }
  if (cmd === "gh" && args[0] === "pr") {
    return ok(JSON.stringify({ number: 42, url: "https://github.com/o/app/pull/42", state: "OPEN", reviewDecision: "REVIEW_REQUIRED",
      statusCheckRollup: [{ name: "test", conclusion: "FAILURE" }, { name: "lint", conclusion: "SUCCESS" }, { context: "deploy", state: "PENDING" }] }));
  }
  if (cmd === "gh" && args[0] === "issue") {
    return ok(JSON.stringify([{ number: 7, title: "Already imported", url: "https://github.com/o/web/issues/7", body: "", labels: [] },
      { number: 8, title: "Crash on start", url: "https://github.com/o/web/issues/8", body: "Steps…", labels: [{ name: "bug" }, { name: "p1" }, { name: "x" }] }]));
  }
  if (cmd === "sh" && args.join(" ").includes("grep")) {
    return ok('"model":"claude-opus-5-5"\n"effort":"high"\n"input_tokens":12\n"cache_read_input_tokens":200000\n"cache_creation_input_tokens":3000\n"output_tokens":800\n');
  }
  if (cmd === "sh" && String(args[0]).endsWith("claude-usage.sh")) return ok(CLAUDE_USAGE);
  if (cmd === "sh" && args.join(" ").includes("rollout-*.jsonl")) return ok("/home/me/.codex/sessions/2026/11/07/rollout-2026-11-07T10-00-00-0aa1-bb22.jsonl\n");
  if (cmd === "sh" && args.join(" ").includes("HOME")) return ok("/home/remote");
  if (cmd === "lsof") return ok("p3007\nn/home/me/.codex/sessions/2026/11/07/rollout-2026-11-07T10-00-00-0aa1b2c3-1111-2222-3333-444455556666.jsonl\n");
  if (cmd === "tail") {
    return ok(['{"cut', JSON.stringify({ type: "turn_context", payload: { model: "gpt-5.5-codex", effort: "medium", cwd: "/srv/api" } }),
      JSON.stringify({ type: "event_msg", payload: { type: "token_count", info: { last_token_usage: { input_tokens: 51000 }, model_context_window: 272000 },
        rate_limits: { limit_id: "codex", primary: { used_percent: 8, window_minutes: 300, resets_at: Math.round(Date.now() / 1000) + 3600 }, secondary: { used_percent: 92, window_minutes: 10080, resets_at: Math.round(Date.now() / 1000) + 86400 } } } })].join("\n"));
  }
  return ok("");
}
