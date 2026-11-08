// Joins the person's tasks with what Herdr shows now: which spaces are which
// repo, which tabs belong to which task, and which agents work in them.

import { place } from "./git.js";
import { report, word } from "./agentinfo.js";
import { tilde, untilde, base, OPEN, RANK, byUrgency, isLater } from "./util.js";
import { S } from "../strings.js";

// Live sub-agents of `addr`, depth first.
function kids(ts, addr, depth = 1) {
  return ts.filter((k) => k.parent === addr && k.state === "live")
    .flatMap((k) => [{ term: k, depth }, ...kids(ts, k.address, depth + 1)]);
}

export function build({ data, sp, ps, ag, ts, repos, h }) {
  const termBy = new Map(ts.map((t) => [t.address, t]));
  const agentStatus = new Map(ag.map((a) => [a.address, a.status]));

  // Spaces and the repo each is in now (a worktree counts as its main repo).
  const spaces = sp.map((s) => {
    const folder = place(s, ps);
    const on = s.machine ?? null;
    const repo = folder ? repos.get(folder, on) : undefined;
    const key = repo?.main ? tilde(repo.main, h) : folder ? tilde(folder, h) : null;
    return { s, folder, on, repo, key };
  });
  const spaceOfTab = new Map();
  for (const x of spaces) for (const tab of x.s.tabs ?? []) spaceOfTab.set(tab.id, { ...x, tab });

  // Agents by tab, each with its terminal and sub-agents.
  const byTab = new Map();
  for (const a of ag) {
    const term = termBy.get(a.address) ?? null;
    const entry = { a, term, status: a.status, report: report(term), subs: kids(ts, a.address) };
    for (const k of entry.subs) {
      const s = agentStatus.get(k.term.address) ?? word(k.term);
      if ((RANK[s === "error" ? "blocked" : s] ?? 0) > (RANK[entry.top ?? entry.status] ?? 0)) entry.top = s === "error" ? "blocked" : s;
    }
    entry.top ??= entry.status;
    if (!byTab.has(a.tab)) byTab.set(a.tab, []);
    byTab.get(a.tab).push(entry);
  }

  // Tasks and their tabs: as stored, plus terminals labelled with a task (a tab the store lost).
  const tasks = data.tasks.filter((t) => !t.deleted).map((t) => ({ t, tabs: [...(t.tabs ?? [])] }));
  const taskById = new Map(tasks.map((x) => [x.t.id, x]));
  for (const term of ts) {
    const id = term.labels?.["tasker.task"], tab = term.labels?.["herdr.tab"];
    const x = id && taskById.get(id);
    if (x && tab && !x.tabs.includes(tab)) x.tabs.push(tab);
  }
  const taskOfTab = new Map();
  for (const x of tasks) for (const tab of x.tabs) taskOfTab.set(tab, x);

  const projectOfRepo = new Map();
  for (const p of data.projects) for (const r of p.repos ?? []) projectOfRepo.set(tilde(untilde(r, h), h), p.id);

  for (const x of tasks) {
    x.agents = x.tabs.flatMap((tab) => byTab.get(tab) ?? []);
    x.live = x.tabs.filter((tab) => spaceOfTab.has(tab));
    x.top = x.agents.reduce((m, e) => ((RANK[e.top] ?? 0) > (RANK[m] ?? 0) ? e.top : m), null);
    x.project = x.t.project ?? (x.t.repo ? projectOfRepo.get(x.t.repo) ?? null : null);
    x.open = OPEN.has(x.t.status);
  }

  // Tabs that belong to no task: agents tasker doesn't track yet, and plain terminals.
  const untracked = [];
  for (const [tab, where] of spaceOfTab) {
    if (taskOfTab.has(tab)) continue;
    const entries = byTab.get(tab) ?? [];
    const tabPanes = ps.filter((p) => p.tab === tab && p.terminal);
    if (!entries.length && !tabPanes.length) continue;
    untracked.push({ tab, where, agents: entries, panes: tabPanes, top: entries.reduce((m, e) => ((RANK[e.top] ?? 0) > (RANK[m] ?? 0) ? e.top : m), null) });
  }

  return { spaces, spaceOfTab, byTab, tasks, taskById, taskOfTab, projectOfRepo, untracked, termBy };
}

// Lists for the Now view, most urgent first.
export function nowView(w, data) {
  const open = w.tasks.filter((x) => x.open);
  const now = Date.now();
  const staleMs = (data.settings.stale_days ?? 3) * 86400000;
  const used = new Set();
  const take = (list) => { list.forEach((x) => used.add(x.t.id)); return list; };
  // An agent asking or working shows even on a task put off; the rest of a Later task waits in Later.
  const free = (x) => !used.has(x.t.id) && !isLater(x.t);
  const needs = take(open.filter((x) => x.top === "blocked"));
  // An agent that finished asks for a review only of work in progress: Next, Waiting or Inbox is your call.
  const review = take(open.filter((x) => free(x) && (x.t.status === "review" || (x.top === "done" && x.t.status === "doing"))));
  const working = take(open.filter((x) => !used.has(x.t.id) && x.top === "working"));
  const stalled = take(open.filter((x) => free(x) && ["doing", "waiting"].includes(x.t.status) && now - (x.t.updated ?? 0) > staleMs));
  const next = open.filter((x) => free(x) && ["next", "doing", "waiting"].includes(x.t.status)).sort((a, b) => byUrgency(a.t, b.t));
  const inbox = open.filter((x) => free(x) && x.t.status === "inbox").sort((a, b) => byUrgency(a.t, b.t));
  // Soonest back first; someday last.
  const later = open.filter((x) => !used.has(x.t.id) && isLater(x.t))
    .sort((a, b) => (a.t.snooze === "someday") - (b.t.snooze === "someday") || String(a.t.snooze).localeCompare(String(b.t.snooze)) || byUrgency(a.t, b.t));
  const loose = (s) => w.untracked.filter((u) => u.top === s);
  // Agents in no task that need nothing now: the "Not in a task" inbox.
  const idle = w.untracked.filter((u) => u.agents.length && !["blocked", "done", "working"].includes(u.top));
  return { needs, review, working, stalled, next, inbox, later, untrackedNeeds: loose("blocked"), untrackedDone: loose("done"), untrackedWorking: loose("working"), untrackedIdle: idle };
}

// The Projects outline: project → repo → tasks (+ untracked tabs).
export function projectTree(w, data, h, filters) {
  // Open tasks, and finished ones whose terminals are still open (work you can still see).
  const show = (x) => x.open || (!x.t.archived && x.live.length > 0) || (filters.done && !x.t.archived);
  const repoNode = (key) => ({
    key,
    name: base(key),
    spaces: w.spaces.filter((s) => s.key === key),
    tasks: [],
    untracked: w.untracked.filter((u) => u.where.key === key),
  });
  const projects = data.projects.map((p) => {
    const repos = new Map((p.repos ?? []).map((r) => { const k = tilde(untilde(r, h), h); return [k, repoNode(k)]; }));
    return { p, repos, loose: [] };
  });
  const byId = new Map(projects.map((x) => [x.p.id, x]));
  const orphan = { p: null, repos: new Map(), loose: [] };
  for (const x of w.tasks) {
    if (!show(x)) continue;
    const home = (x.project && byId.get(x.project)) || orphan;
    if (x.t.repo) {
      if (!home.repos.has(x.t.repo)) home.repos.set(x.t.repo, repoNode(x.t.repo));
      home.repos.get(x.t.repo).tasks.push(x);
    } else home.loose.push(x);
  }
  // Open repos in no project, when something there belongs to no task: a space
  // whose tabs are all some task's shows up under that task instead.
  for (const s of w.spaces) {
    if (!s.key || w.projectOfRepo.has(s.key) || orphan.repos.has(s.key)) continue;
    if (!w.untracked.some((u) => u.where.key === s.key)) continue;
    if (projects.some((x) => x.repos.has(s.key))) continue;
    orphan.repos.set(s.key, repoNode(s.key));
  }
  const order = (list) => list.sort((a, b) => (RANK[b.top] ?? 0) - (RANK[a.top] ?? 0) || (OPEN.has(a.t.status) ? 0 : 1) - (OPEN.has(b.t.status) ? 0 : 1) || byUrgency(a.t, b.t));
  for (const x of [...projects, orphan]) {
    x.loose = order(x.loose);
    for (const r of x.repos.values()) r.tasks = order(r.tasks);
    // What's under it: tasks, and tabs that belong to no task.
    const repos = [...x.repos.values()];
    x.count = x.loose.length + repos.reduce((n, r) => n + r.tasks.length + r.untracked.length, 0);
    x.top = [...x.loose, ...repos.flatMap((r) => [...r.tasks, ...r.untracked])].reduce((m, t) => ((RANK[t.top] ?? 0) > (RANK[m] ?? 0) ? t.top : m), null);
  }
  return { projects, orphan };
}

// A tab outside any task, by what people recognise: its name, the agent's title,
// else the program and the folder it's in (never a bare address like "t4").
export function untrackedName(u) {
  if (u.where.tab.named && u.where.tab.name) return u.where.tab.name;
  const e = u.agents[0];
  const p0 = u.panes[0];
  // A shell's title is often just its address ("t4", "vps/t1q"): not a name.
  const addresses = new Set([e?.a.address, p0?.terminal].filter(Boolean).flatMap((a) => [a, a.split("/").pop()]));
  const isAddress = (x) => !x || addresses.has(x);
  const title = [e?.term?.title, e?.a.title, p0?.title].find((x) => !isAddress(x));
  if (title) return title;
  const prog = e?.a.program ?? p0?.program;
  const folder = base(p0?.cwd ?? e?.term?.cwd ?? "");
  const who = prog && prog.key !== "program" ? prog.name : S.terminal;
  return folder ? `${who} · ${folder}` : who;
}
