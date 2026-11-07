// Git, read without taking locks or waking file watchers (as Herdr's own mods do).

import { exec } from "herdr";
import { sharedCache, busy } from "./cache.js";

export const READ = ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "diff.autoRefreshIndex=false"];

export async function git(cwd, args, on) {
  try {
    const r = await exec("git", args, { cwd, on });
    return { ok: r.code === 0, out: (r.stdout ?? "").trim(), err: (r.stderr ?? "").trim() };
  } catch (e) {
    return { ok: false, out: "", err: String(e?.message ?? e) };
  }
}

// Where a space is now: its first terminal's live folder, else where it was made.
export function place(s, ps) {
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  return ps.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder || null;
}

// A folder's repo and state: { top, main, name, linked, branch, ahead, behind, dirty }, or null outside git.
export async function repoState(folder, on) {
  const common = await git(folder, [...READ, "rev-parse", "--path-format=absolute", "--show-toplevel", "--git-common-dir"], on);
  if (!common.ok) return null;
  const [top, dir] = common.out.split("\n");
  const main = dir.endsWith("/.git") ? dir.slice(0, -5) : dir;
  const st = await git(top, [...READ, "status", "--porcelain=v2", "--branch"], on);
  let branch = null, ahead = 0, behind = 0, dirty = 0;
  for (const l of st.out.split("\n")) {
    if (l.startsWith("# branch.head ")) branch = l.slice(14);
    else if (l.startsWith("# branch.ab ")) {
      const m = /\+(\d+) -(\d+)/.exec(l);
      if (m) { ahead = Number(m[1]); behind = Number(m[2]); }
    } else if (l && !l.startsWith("#")) dirty++;
  }
  return { top, main, name: main.split("/").pop(), linked: main !== top, branch: branch === "(detached)" ? null : branch, ahead, behind, dirty };
}

// Lines added and removed in the working tree against HEAD.
export async function diffStat(top, on) {
  const r = await git(top, [...READ, "diff", "HEAD", "--numstat"], on);
  let add = 0, del = 0, files = 0;
  for (const l of r.out.split("\n").filter(Boolean)) {
    const [a, d] = l.split("\t");
    add += Number(a) || 0; del += Number(d) || 0; files++;
  }
  return { add, del, files };
}

// Remembers each folder's repo state; looks again when asked or when it gets old.
// Shared by every copy of the mod, like the agents' info.
export class RepoCache {
  constructor() {
    this.c = sharedCache("repos"); // info: key -> state | null; seen: key -> last look
  }

  key(folder, on) {
    return JSON.stringify([on ?? null, folder]);
  }

  get(folder, on) {
    return this.c.info[this.key(folder, on)];
  }

  // Looks at the folders that are new, stale (`maxAge`) or forced.
  refresh(cx, list, maxAge = 45000, force = new Set()) {
    const now = Date.now();
    const c = this.c;
    const seenKeys = new Set();
    const due = list.filter(({ folder, on }) => {
      const k = this.key(folder, on);
      if (!folder || seenKeys.has(k)) return false;
      seenKeys.add(k);
      return !busy(c, k, now) && (force.has(k) || !(k in c.info) || now - (c.seen[k] ?? 0) > maxAge);
    });
    if (!due.length) return;
    for (const d of due) c.busy[this.key(d.folder, d.on)] = now;
    // Side by side: one slow repo (a network drive) doesn't hold up the rest.
    cx.spawn(async (cx) => {
      await Promise.all(due.map(async ({ folder, on }) => {
        const k = this.key(folder, on);
        try { c.info[k] = await repoState(folder, on); } catch { c.info[k] = null; }
        c.seen[k] = Date.now();
        delete c.busy[k];
      }));
      cx.notify();
    });
  }
}
