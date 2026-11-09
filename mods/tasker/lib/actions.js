// What tasker does in Herdr and git on a task's behalf.

import { run, exec, hc, knownAgents, home, focused, spaces, panes, window, terminals, shared, setShared } from "herdr";
import { untrackedName } from "./world.js";
import { git, place } from "./git.js";
import { setStatus, newTask } from "./store.js";
import { untilde, tilde, slug, commonDir } from "./util.js";
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

// How to start the agent `app` (a key of Herdr's agent menu), installed or not.
async function runOf(app) {
  try {
    const a = (await knownAgents()).find((x) => x.key === app && x.installed && x.run?.length);
    if (a) return a.run;
  } catch {}
  return [app];
}

// The command that continues a conversation: claude --resume <id>, codex resume <id>.
export async function resumeArgv(session) {
  const run = await runOf(session.app);
  return session.app === "codex" ? [...run, "resume", session.id] : [...run, "--resume", session.id];
}

// The space showing `folder` (or a folder inside it), preferring the selected one.
function spaceAt(folder) {
  const ps = panes();
  const inside = (p) => p && (p === folder || p.startsWith(folder + "/"));
  const list = spaces().filter((s) => !s.machine && inside(place(s, ps)));
  return list.find((s) => s.active) ?? list[0] ?? null;
}

// An agent that can work across the project's other repositories: Claude Code and
// Codex take them with --add-dir. Other programs get only the list, in the prompt.
export function withDirs(argv, dirs) {
  if (!dirs.length || !/(^|\/)(claude|codex)$/.test(argv[0] ?? "")) return argv;
  return [...argv, ...dirs.flatMap((d) => ["--add-dir", d])];
}

// Where project-wide work runs: the nearest folder holding all its repositories (~/dev),
// above them as the project is; `others`: repositories outside it, to add (none, usually).
// A project with no repositories yet works in the home folder.
export function projectPlace(project, h = home()) {
  if (!project) return null;
  const repos = (project.repos ?? []).map((r) => untilde(r, h));
  if (!repos.length) return { folder: h, others: [], all: [] };
  const folder = commonDir(repos) ?? repos[0];
  const inside = (r) => r === folder || r.startsWith(folder + "/");
  return { folder, others: repos.filter((r) => !inside(r)), all: repos };
}

// The project's own space: named after it, in its folder. Several projects can share a
// folder (~/dev), so a space there that isn't named after this one isn't its.
export function projectSpace(project, folder) {
  const ps = panes();
  return spaces().find((s) => !s.machine && s.name === project.name && place(s, ps) === folder) ?? null;
}

// Opens a tab in the project's space (else makes the space) and remembers it, so the new
// tab's terminals get labelled tasker.project=<id> and show under the project.
export function openInProject(project, argv) {
  const at = projectPlace(project);
  if (!at) return;
  const sp = spaces();
  const pending = { project: project.id, name: null, at: Date.now(),
    beforeSpaces: sp.map((s) => s.id), beforeTabs: sp.flatMap((s) => (s.tabs ?? []).map((t) => t.id)) };
  const space = projectSpace(project, at.folder);
  const args = { folder: at.folder, ...(argv ? { argv: withDirs(argv, at.others) } : {}) };
  if (space) run("tab.new", { space: space.id, ...args });
  else run("space.new", { name: project.name, ...args });
  pending.space = space?.id ?? null;
  setShared("tasker.pending", [...(shared("tasker.pending") ?? []), pending]);
}

// A board is a tab whose only pane is this mod: one for every project (`project`), and one
// for all of them. Goes to the one open (tabs are told apart by name: panes() doesn't carry
// a mod's props), else makes it in the shown space.
export function openBoard(project = null) {
  const name = project ? S.boardOf(project.name) : S.board;
  const ps = panes();
  const tab = spaces().flatMap((s) => s.tabs ?? []).find((t) => t.name === name && ps.some((p) => p.tab === t.id && p.mod === "tasker"));
  const pane = tab && ps.find((p) => p.tab === tab.id && p.mod === "tasker");
  if (pane) run("pane.focus", { pane: pane.pane });
  else run("tab.new", { name, mod: "tasker", props: { role: "board", ...(project ? { project: project.id } : {}) } });
}

// Labels a tab's terminals as the project's (shown at the project's level).
export async function labelProject(projectId, tabId, ts) {
  for (const term of ts.filter((x) => x.labels?.["herdr.tab"] === tabId && !x.address.includes("/"))) {
    try { await hc(["label", term.address, `tasker.project=${projectId}`]); } catch {}
  }
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
export async function launch(store, task, { worktree = false, resume = null } = {}) {
  const h = home();
  const project = task.project ? store.data.projects.find((p) => p.id === task.project) : null;
  // A task of the whole project (no repository of its own) works across all of them,
  // resumed too: the other repositories are added again.
  const wide = !task.repo ? projectPlace(project, h) : null;
  let argv = resume ? await resumeArgv(resume) : await agentArgv(store.data.settings.agent);
  // A resumed agent already has its conversation: no first message.
  const prompt = resume ? null : S.prompt(task, project);
  const beforeSpaces = new Set(spaces().map((s) => s.id));
  const beforeTabs = new Set(spaces().flatMap((s) => (s.tabs ?? []).map((t) => t.id)));
  let folder = resume?.cwd ? untilde(resume.cwd, h) : task.worktree ? untilde(task.worktree, h) : task.repo ? untilde(task.repo, h) : wide?.folder ?? null;
  const patch = {};
  if (worktree && task.repo) {
    const wt = await ensureWorktree(task, store.data.tasks);
    folder = wt.path;
    patch.worktree = tilde(wt.path, h);
    patch.branch = wt.branch;
  }
  // Repositories outside the folder it runs in are added (resumed in one of them: the rest).
  if (wide) argv = withDirs(argv, wide.all.filter((d) => !(d === folder || d.startsWith(folder + "/"))));
  if (!folder) {
    // No repo: where the person is now.
    const f = focused();
    const s = spaces().find((x) => x.id === f?.space);
    folder = f?.cwd ?? (s ? place(s, panes()) : h);
  }
  // A task of the whole project runs in the project's own space, above its repositories.
  const own = wide && folder === wide.folder;
  const space = own ? projectSpace(project, folder) : spaceAt(folder);
  const name = task.title.slice(0, 40);
  const first = prompt ? { task: prompt } : {};
  if (space) run("tab.new", { space: space.id, name, folder, argv, ...first });
  else run("space.new", { folder, tab: name, argv, ...first, ...(own ? { name: project.name } : {}) });
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

// Makes a task of a tab that belongs to none (`u` from the world's untracked list),
// tied to it. Status: as given, else from what its agent is doing.
// `auto`: made by tasker itself (a light task, see sidebar.js's tracking). A tab opened for a
// whole project goes to that project, with no repository.
export async function adopt(store, u, { status, title, auto = false } = {}) {
  const st = status ?? (u.top === "working" || u.top === "blocked" ? "doing" : u.top === "done" ? "review" : "next");
  let id = null;
  const where = u.project ? { project: u.project, repo: null } : { repo: u.where.key };
  await store.update((d) => {
    // One task per tab (two looks at once, two lists). A tab whose task was deleted isn't
    // taken again by itself: only by the person (Make task).
    if (d.tasks.some((t) => (t.tabs ?? []).includes(u.tab) && (!t.deleted || auto))) return false;
    id = newTask(d, { title: title ?? untrackedName(u), ...where, status: st, tabs: [u.tab], ...(auto ? { auto: true } : {}) }).id;
  });
  if (id) await link(store, id, u.tab, terminals());
  return id;
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
