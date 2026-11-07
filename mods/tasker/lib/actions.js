// What tasker does in Herdr and git on a task's behalf.

import { run, exec, hc, knownAgents, home, focused, spaces, panes, window } from "herdr";
import { git, place } from "./git.js";
import { setStatus } from "./store.js";
import { untilde, tilde, slug } from "./util.js";
import { S } from "../strings.js";

// Checkouts go where Herdr's own worktree dialog puts them, so its spaces list nests them.
const ROOT = () => `${home()}/.herdr/worktrees`;

export async function agentArgv(preferred) {
  try {
    const list = (await knownAgents()).filter((a) => a.installed && a.run?.length);
    const pick = list.find((a) => a.key === preferred) ?? list.find((a) => a.agent) ?? list[0];
    if (pick) return pick.run;
  } catch {}
  return [preferred || "claude"];
}

// The space showing `folder` (or a folder inside it), preferring the selected one.
function spaceAt(folder) {
  const ps = panes();
  const inside = (p) => p && (p === folder || p.startsWith(folder + "/"));
  const list = spaces().filter((s) => !s.machine && inside(place(s, ps)));
  return list.find((s) => s.active) ?? list[0] ?? null;
}

// A terminal (or an agent, with argv) in a repo, outside any task: a tab in the
// space already there, else a new space.
export function openHere(repoKey, argv) {
  const folder = untilde(repoKey, home());
  const space = spaceAt(folder);
  const args = { folder, ...(argv ? { argv } : {}) };
  if (space) run("tab.new", { space: space.id, ...args });
  else run("space.new", args);
}

// Makes (or reuses) the task's worktree on branch task/<slug>. Another task with the
// same title gets its own: task/<slug>-<id end>.
async function ensureWorktree(task, others = []) {
  const h = home();
  const repo = untilde(task.repo, h);
  if (task.worktree) return { path: untilde(task.worktree, h), branch: task.branch };
  let name = slug(task.title);
  if (others.some((o) => o.id !== task.id && o.branch === `task/${name}`)) name = `${name}-${task.id.slice(-4)}`;
  const branch = `task/${name}`;
  const path = `${ROOT()}/${repo.split("/").pop()}/${name}`;
  const exists = await git(repo, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]);
  const r = await git(repo, exists.ok ? ["worktree", "add", path, branch] : ["worktree", "add", "-b", branch, path]);
  if (!r.ok && !/already exists/.test(r.err)) throw new Error(r.err || "git worktree add failed");
  return { path, branch };
}

// Starts an agent on the task. Returns what to watch for so the new tab can be
// tied to the task: { task, space | null, beforeTabs, beforeSpaces, at }.
export async function launch(store, task, { worktree = false } = {}) {
  const h = home();
  const argv = await agentArgv(store.data.settings.agent);
  const prompt = S.prompt(task);
  const beforeSpaces = new Set(spaces().map((s) => s.id));
  const beforeTabs = new Set(spaces().flatMap((s) => (s.tabs ?? []).map((t) => t.id)));
  let folder = task.worktree ? untilde(task.worktree, h) : task.repo ? untilde(task.repo, h) : null;
  const patch = {};
  if (worktree && task.repo) {
    const wt = await ensureWorktree(task, store.data.tasks);
    folder = wt.path;
    patch.worktree = tilde(wt.path, h);
    patch.branch = wt.branch;
  }
  if (!folder) {
    // No repo: where the person is now.
    const f = focused();
    const s = spaces().find((x) => x.id === f?.space);
    folder = f?.cwd ?? (s ? place(s, panes()) : h);
  }
  const space = spaceAt(folder);
  const name = task.title.slice(0, 40);
  if (space) run("tab.new", { space: space.id, name, folder, argv, task: prompt });
  else run("space.new", { folder, tab: name, argv, task: prompt });
  await store.update((d) => {
    const t = d.tasks.find((x) => x.id === task.id);
    if (!t) return false;
    Object.assign(t, patch);
    setStatus(t, "doing");
  });
  return { task: task.id, name, space: space?.id ?? null, beforeTabs, beforeSpaces, at: Date.now() };
}

// The tab a launch made: new since `pending`, in its space (or a new space), not
// `taken` by a task already; one named after the task first.
export function arrived(pending, sp, taken = new Set()) {
  const where = pending.space ? sp.filter((x) => x.id === pending.space) : sp.filter((x) => !pending.beforeSpaces.has(x.id));
  const fresh = where.flatMap((s) => s.tabs ?? []).filter((t) => !pending.beforeTabs.has(t.id) && !taken.has(t.id));
  return (fresh.find((t) => t.named && t.name === pending.name) ?? fresh[0])?.id ?? null;
}

// Ties a tab to a task, in the store and on its terminals (a label survives a lost store).
export async function link(store, taskId, tabId, ts) {
  await store.update((d) => {
    const t = d.tasks.find((x) => x.id === taskId);
    if (!t || t.tabs?.includes(tabId)) return false;
    (t.tabs ??= []).push(tabId);
    t.updated = Date.now();
  });
  for (const term of ts.filter((x) => x.labels?.["herdr.tab"] === tabId && !x.address.includes("/"))) {
    try { await hc(["label", term.address, `tasker.task=${taskId}`]); } catch {}
  }
}

export async function send(address, text) {
  const r = await hc(["send", address, text]);
  return r.code === 0 ? null : (r.stderr || r.stdout || "hc send failed").trim();
}

// The pull request of the task's branch: { number, url, state, review, failed: [names], pending }.
export async function pullRequest(folder) {
  try {
    const r = await exec("gh", ["pr", "view", "--json", "number,url,state,reviewDecision,statusCheckRollup"], { cwd: folder });
    if (r.code !== 0) return null;
    const d = JSON.parse(r.stdout);
    const checks = d.statusCheckRollup ?? [];
    const result = (c) => (c.conclusion ?? c.state ?? "").toUpperCase();
    return {
      number: d.number,
      url: d.url,
      state: d.state,
      review: d.reviewDecision,
      failed: checks.filter((c) => ["FAILURE", "ERROR", "TIMED_OUT", "CANCELLED"].includes(result(c))).map((c) => c.name ?? c.context),
      pending: checks.filter((c) => ["", "PENDING", "QUEUED", "IN_PROGRESS", "EXPECTED"].includes(result(c))).length,
      total: checks.length,
    };
  } catch {
    return null;
  }
}

export async function issues(folder) {
  const r = await exec("gh", ["issue", "list", "--state", "open", "--limit", "50", "--json", "number,title,url,body,labels"], { cwd: folder });
  if (r.code !== 0) throw new Error((r.stderr || "gh issue list failed").trim());
  return JSON.parse(r.stdout);
}

// Done, its tabs put away, and (when asked) its worktree and branch removed.
export async function archive(store, task, { removeWorktree = false } = {}) {
  for (const tab of task.tabs ?? []) run("tab.settle", { id: tab });
  let warning = null;
  if (removeWorktree && task.worktree) {
    const h = home();
    const repo = untilde(task.repo, h);
    const r = await git(repo, ["worktree", "remove", untilde(task.worktree, h)]);
    if (!r.ok) warning = r.err;
    else if (task.branch) {
      const b = await git(repo, ["branch", "-d", task.branch]);
      if (!b.ok) warning = S.keptBranch(task.branch);
    }
  }
  await store.update((d) => {
    const t = d.tasks.find((x) => x.id === task.id);
    if (!t) return false;
    if (t.status !== "dropped") setStatus(t, "done");
    t.archived = true;
    if (removeWorktree && !warning) { t.worktree = null; }
  });
  return warning;
}

// A link in the system's browser.
export function openUrl(url) {
  if (!/^https?:\/\//.test(url ?? "")) return;
  const platform = window()?.platform;
  const [cmd, args] = platform === "windows" ? ["cmd", ["/c", "start", "", url]] : platform === "linux" ? ["xdg-open", [url]] : ["open", [url]];
  exec(cmd, args).catch(() => {});
}
