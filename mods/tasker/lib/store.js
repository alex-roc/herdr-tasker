// tasks.json: the person's projects and tasks. Every copy of the mod reads the
// same file; writes are compare-and-swap, so two copies never undo each other.
// People and agents edit the file by hand too: what's read is checked and
// filled in, and a file that isn't valid JSON is never written over.

import { readTextFile, writeTextFile, appHome, watchFolder } from "herdr";
import * as fs from "fs/promises";
import { uid, STATUSES, parseDue } from "./util.js";
import { S } from "../strings.js";

export const DIR = () => `${appHome()}/data/tasker`;
export const FILE = () => `${DIR()}/tasks.json`;

export const DEFAULTS = { wip: 3, stale_days: 3, agent: "claude", usage: false, reminders: true, revive: true, track: true };
const EMPTY = () => ({ version: 1, settings: { ...DEFAULTS }, projects: [], tasks: [] });

const str = (v) => (typeof v === "string" ? v : v == null ? "" : String(v));
const strOrNull = (v) => (typeof v === "string" && v ? v : typeof v === "number" ? String(v) : null);
const num = (v, d) => (Number.isFinite(Number(v)) && v !== null && v !== "" ? Number(v) : d);
const list = (v) => (Array.isArray(v) ? v : []);
const PRIORITY = { high: 1, normal: 2, low: 3, p1: 1, p2: 2, p3: 3 };

// One task as the views expect it, whatever was in the file.
export function cleanTask(t) {
  const now = Date.now();
  const status = STATUSES.includes(t.status) ? t.status : "inbox";
  const p = PRIORITY[str(t.priority).toLowerCase()] ?? num(t.priority, 2);
  // Only absolute dates: a word like "tomorrow" in the file would move every day.
  const due = /^\d{4}-\d{1,2}-\d{1,2}$/.test(str(t.due).trim()) ? parseDue(t.due) : null;
  const { auto: _auto, ...rest } = t;
  return {
    ...rest,
    id: str(t.id) || uid(),
    title: str(t.title).trim() || "Untitled",
    project: strOrNull(t.project),
    repo: strOrNull(t.repo),
    status,
    priority: [1, 2, 3].includes(p) ? p : 2,
    due: due ?? null,
    estimate: strOrNull(t.estimate),
    next_step: str(t.next_step),
    notes: str(t.notes),
    issue: t.issue && typeof t.issue === "object" && t.issue.number != null ? { ...t.issue, url: str(t.issue.url) } : null,
    // Made by tasker for an agent's tab (a light task): renamed after its agent, gone with its
    // tab, until the person changes anything on it.
    ...(t.auto === true ? { auto: true } : {}),
    // Later: until a day, or "someday"; and the last day a due reminder went out.
    snooze: t.snooze === "someday" || /^\d{4}-\d{2}-\d{2}$/.test(str(t.snooze)) ? t.snooze : null,
    reminded: /^\d{4}-\d{2}-\d{2}$/.test(str(t.reminded)) ? t.reminded : null,
    worktree: strOrNull(t.worktree),
    branch: strOrNull(t.branch),
    tabs: list(t.tabs).filter((x) => typeof x === "string"),
    created: num(t.created, now),
    updated: num(t.updated, num(t.created, now)),
    done_at: t.done_at == null ? null : num(t.done_at, null),
    agent_ms: num(t.agent_ms, 0),
    history: list(t.history).filter((h) => h && STATUSES.includes(h.s)).map((h) => ({ s: h.s, at: num(h.at, now) })),
    // Agent conversations it had, newest last, to resume after a restart.
    sessions: list(t.sessions).filter((x) => x && ["claude", "codex"].includes(x.app) && typeof x.id === "string" && /^[\w-]+$/.test(x.id))
      .map((x) => ({ app: x.app, id: x.id, cwd: strOrNull(x.cwd), at: num(x.at, now) })).slice(-5),
  };
}

export function cleanProject(p) {
  return { ...p, id: str(p.id) || uid(), name: str(p.name).trim() || "Untitled", color: str(p.color) || "ansi4", repos: list(p.repos).filter((r) => typeof r === "string") };
}

// Two tasks with one id (two hand-made entries in the same second) would be one
// task to every view: the later ones get "-2", "-3", the same on every read.
function unique(tasks) {
  const seen = new Set();
  for (const t of tasks) {
    let id = t.id, n = 1;
    while (seen.has(id)) id = `${t.id}-${++n}`;
    t.id = id;
    seen.add(id);
  }
  return tasks;
}

export function parse(text) {
  if (!text) return EMPTY();
  const d = JSON.parse(text);
  if (!d || typeof d !== "object" || Array.isArray(d)) throw new Error("not a JSON object");
  const settings = { ...DEFAULTS, ...(d.settings && typeof d.settings === "object" ? d.settings : {}) };
  settings.wip = Math.max(1, Math.round(num(settings.wip, DEFAULTS.wip)));
  settings.stale_days = Math.max(1, Math.round(num(settings.stale_days, DEFAULTS.stale_days)));
  settings.agent = str(settings.agent) || DEFAULTS.agent;
  settings.usage = settings.usage === true; // off unless turned on: it starts a `claude` now and then
  settings.reminders = settings.reminders !== false;
  settings.revive = settings.revive !== false;
  settings.track = settings.track !== false;
  const obj = (x) => x && typeof x === "object" && !Array.isArray(x);
  return {
    ...d,
    version: d.version ?? 1,
    settings,
    projects: list(d.projects).filter(obj).map(cleanProject),
    tasks: unique(list(d.tasks).filter(obj).map(cleanTask)),
  };
}

export class Store {
  constructor() {
    this.data = EMPTY();
    this.text = null; // what the file held when last read or written
    this.loaded = false;
    this.error = null;
  }

  async load() {
    let text;
    try {
      text = await readTextFile(FILE());
    } catch (e) {
      this.error = S.storeBad(e?.message ?? e);
      this.loaded = true;
      return;
    }
    try {
      this.data = parse(text);
      this.text = text;
      this.error = null;
    } catch (e) {
      // Keep showing the last good data; say what's wrong.
      this.text = text;
      this.error = S.storeBad(e?.message ?? e);
    }
    this.loaded = true;
  }

  // Reloads whenever the file changes (another copy, an agent, a hand edit), and
  // redraws after its own writes too: the watch can't tell those apart from no change.
  watch(cx) {
    cx.spawn(async (cx) => {
      this.changed = () => cx.notify();
      try { await fs.mkdir(DIR(), { recursive: true }); } catch {}
      await this.load();
      cx.notify();
      for (;;) {
        // The folder also holds each copy's localStorage: only tasks.json matters.
        let changed;
        try { changed = await watchFolder(DIR()); } catch { return; }
        if (!changed.some((p) => p.endsWith("tasks.json") || p === DIR())) continue;
        const before = this.text;
        await this.load();
        if (this.text !== before) cx.notify();
      }
    });
  }

  // Applies `fn` to a fresh copy and writes it; on a stale snapshot, rereads and retries.
  // Returns true when written. A file that can't be parsed is left alone.
  async update(fn) {
    for (let i = 0; i < 4; i++) {
      let current, data;
      try {
        current = await readTextFile(FILE());
        data = parse(current);
      } catch (e) {
        this.fail(S.storeBad(e?.message ?? e));
        return false;
      }
      if (fn(data) === false) return false;
      const text = JSON.stringify(data, null, 1) + "\n";
      let written = false;
      try {
        await writeTextFile(FILE(), text, current);
        written = true;
      } catch {
        // Someone wrote in between: read again.
      }
      if (written) {
        this.data = data;
        this.text = text;
        this.error = null;
        this.changed?.();
        return true;
      }
    }
    this.fail(S.storeBusy);
    return false;
  }

  // Shows what went wrong, redrawing only when it's news: a render that retries a
  // failing write must not loop.
  fail(error) {
    if (this.error === error) return;
    this.error = error;
    this.changed?.();
  }

  task(id) {
    return this.data.tasks.find((t) => t.id === id) ?? null;
  }

  project(id) {
    return this.data.projects.find((p) => p.id === id) ?? null;
  }
}

// Mutations on a data object (used inside Store.update).

export function newTask(data, fields) {
  const now = Date.now();
  const t = {
    id: uid(),
    title: "",
    project: null,
    repo: null,
    status: "inbox",
    priority: 2,
    due: null,
    estimate: null,
    next_step: "",
    notes: "",
    issue: null,
    worktree: null,
    branch: null,
    tabs: [],
    created: now,
    updated: now,
    done_at: null,
    agent_ms: 0,
    history: [{ s: fields.status ?? "inbox", at: now }],
    ...fields,
  };
  data.tasks.push(t);
  return t;
}

// The person changed something on a task: a light one becomes theirs (kept, named as it is).
export function kept(t) {
  if (t) delete t.auto;
  return t;
}

export function setStatus(t, status, now = Date.now()) {
  if (!t || t.status === status) return false;
  t.status = status;
  t.updated = now;
  t.done_at = status === "done" ? now : status === "dropped" ? t.done_at : null;
  // Started, finished or dropped: no longer put off.
  if (["doing", "done", "dropped"].includes(status)) t.snooze = null;
  (t.history ??= []).push({ s: status, at: now });
  if (t.history.length > 60) t.history.splice(0, t.history.length - 60);
  return true;
}

export function newProject(data, fields) {
  const p = { id: uid(), name: "", color: "ansi4", repos: [], collapsed: false, ...fields };
  data.projects.push(p);
  return p;
}
