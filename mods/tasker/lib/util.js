// Small pure helpers.

export const STATUSES = ["inbox", "next", "doing", "waiting", "review", "done", "dropped"];
export const OPEN = new Set(["inbox", "next", "doing", "waiting", "review"]);
// Agent urgency, as Herdr's agents list ranks it.
export const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };

export function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export function duration(ms) {
  const m = Math.floor(Math.max(0, ms) / 60000);
  if (m < 1) return "<1m";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h${m % 60 ? ` ${m % 60}m` : ""}`;
  return `${Math.floor(h / 24)}d`;
}

export const slug = (s) => (s ?? "")
  .normalize("NFD").replace(/[̀-ͯ]/g, "")
  .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "task";

export function tilde(path, home) {
  if (!path) return path;
  return home && path.startsWith(home) ? `~${path.slice(home.length)}` : path;
}

export function untilde(path, home) {
  if (!path) return path;
  return path.startsWith("~") ? home + path.slice(1) : path;
}

// Where work across several repositories happens: the nearest folder holding them all
// (~/dev for ~/dev/a and ~/dev/b; a lone repository's parent). Absolute paths in, null if none.
export function commonDir(paths) {
  const parts = paths.filter(Boolean).map((p) => p.replace(/\/+$/, "").split("/"));
  if (!parts.length) return null;
  let common = parts[0].slice(0, parts.length === 1 ? -1 : undefined);
  for (const p of parts.slice(1)) {
    let i = 0;
    while (i < common.length && i < p.length && common[i] === p[i]) i++;
    common = common.slice(0, i);
  }
  // Nothing in common but "/": no place.
  return common.join("/") || null;
}

export const base = (path) => (path ?? "").replace(/\/+$/, "").split("/").pop();

export function today() {
  return localDay(Date.now());
}

export function localDay(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const WEEKDAYS = { sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6 };

// What a person types for a due date → "YYYY-MM-DD". Empty → null; not understood → undefined.
// today, tomorrow (tmr), fri / friday (the next one, never today), +3 / +3d / +2w, 11-20, 2026-11-20.
export function parseDue(text, now = new Date()) {
  const s = String(text ?? "").trim().toLowerCase();
  if (!s) return null;
  const at = (days) => localDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() + days).getTime());
  if (s === "today" || s === "tod") return at(0);
  if (s === "tomorrow" || s === "tmr" || s === "tom") return at(1);
  if (s === "next week") return at(7);
  const rel = /^\+?(\d{1,3})\s*([dw]?)$/.exec(s);
  if (rel && (s.startsWith("+") || rel[2])) return at(Number(rel[1]) * (rel[2] === "w" ? 7 : 1));
  const wd = WEEKDAYS[s];
  if (wd != null) return at(((wd - now.getDay() + 7) % 7) || 7);
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) return validDay(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) {
    // This year's, or next year's when that day has passed.
    const y = now.getFullYear();
    const d = validDay(y, Number(m[1]), Number(m[2]));
    return d && d < at(0) ? validDay(y + 1, Number(m[1]), Number(m[2])) : d;
  }
  return undefined;
}

function validDay(y, m, d) {
  const date = new Date(y, m - 1, d);
  return date.getMonth() === m - 1 && date.getDate() === d ? localDay(date.getTime()) : undefined;
}

// "2026-11-07" → days from today (negative: overdue).
export function daysUntil(due) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due ?? "")) return null;
  const [y, m, d] = due.split("-").map(Number);
  const a = new Date(y, m - 1, d).getTime();
  const t = new Date(); const b = new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime();
  return Math.round((a - b) / 86400000);
}

// "Later": a task put off until a day ("YYYY-MM-DD"), or "someday" (until brought back).
// It leaves Now's lists meanwhile and comes back on that day.
export function isLater(t, day = today()) {
  return t?.snooze === "someday" || (typeof t?.snooze === "string" && t.snooze > day);
}

export const laterLabel = (snooze) => (snooze === "someday" ? "someday" : dueLabel(snooze));

// What a person types for Later: a due-date word for a day after today, or "someday".
// Not understood → undefined; today or a past day → null (it wouldn't be put off at all).
export function parseLater(text, now = new Date()) {
  const s = String(text ?? "").trim().toLowerCase();
  if (s === "someday" || s === "some day") return "someday";
  const d = parseDue(s, now);
  if (!d) return undefined;
  return d > localDay(now.getTime()) ? d : null;
}

export function dueLabel(due) {
  const n = daysUntil(due);
  if (n == null) return null;
  if (n < 0) return `${-n}d late`;
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  return n < 7 ? `in ${n}d` : due.slice(5);
}

// "claude-opus-5-5" → "opus 5.5"; others as they come.
export function shortModel(m) {
  if (!m) return null;
  const c = /^claude-([a-z]+)-(\d+)-(\d+)/.exec(m);
  if (c) return `${c[1]} ${c[2]}.${c[3]}`;
  return m.replace(/^claude-/, "");
}

// When a limit resets: "18:50" today, "tue 22:00" later.
export function resetsLabel(ms, now = Date.now()) {
  if (!ms) return null;
  const d = new Date(ms);
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  if (localDay(ms) === localDay(now)) return hm;
  return `${["sun", "mon", "tue", "wed", "thu", "fri", "sat"][d.getDay()]} ${hm}`;
}

// How an issue is named: "#12" on GitHub, "ENG-12" on Linear.
export const issueLabel = (issue) => (issue ? (issue.source === "linear" ? String(issue.number) : `#${issue.number}`) : "");

export const kilo = (n) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));

// Next-up order: priority, then due date, then oldest.
export function byUrgency(a, b) {
  const pa = a.priority ?? 2, pb = b.priority ?? 2;
  if (pa !== pb) return pa - pb;
  const da = daysUntil(a.due) ?? 9999, db = daysUntil(b.due) ?? 9999;
  if (da !== db) return da - db;
  return (a.created ?? 0) - (b.created ?? 0);
}
