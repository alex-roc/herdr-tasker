// How much of each plan is used: Claude Code's 5-hour and weekly limits, and
// Codex's. Shown in the status bar.
//
// Claude: bin/claude-usage.sh asks your own `claude` CLI (get_usage); the CLI
// signs in by itself, tasker reads no token. Codex: the newest rate_limits its
// session logs recorded (no process started). Nothing here sends a prompt.

import { exec, appHome } from "herdr";
import { sharedCache, busy } from "./cache.js";

const EVERY = 5 * 60000;

// { pct, resets: ms | null } for one window; a window whose reset passed is empty again.
function win(pct, resets, now) {
  if (pct == null || Number.isNaN(Number(pct))) return null;
  const r = resets ? (typeof resets === "number" ? resets * (resets < 1e12 ? 1000 : 1) : Date.parse(resets)) : null;
  if (r && r < now) return { pct: 0, resets: null };
  return { pct: Math.round(Number(pct)), resets: Number.isFinite(r) ? r : null };
}

// The control_response line of bin/claude-usage.sh → { five, week }.
export function parseClaude(line, now = Date.now()) {
  const d = JSON.parse(line);
  const r = d?.response?.response ?? d?.response ?? {};
  const rl = r.rate_limits ?? {};
  let five = rl.five_hour ? win(rl.five_hour.utilization, rl.five_hour.resets_at, now) : null;
  let week = rl.seven_day ? win(rl.seven_day.utilization, rl.seven_day.resets_at, now) : null;
  for (const l of rl.limits ?? []) {
    if (!five && l.kind === "session") five = win(l.percent, l.resets_at, now);
    if (!week && l.kind === "weekly_all") week = win(l.percent, l.resets_at, now);
  }
  if (!five && !week) throw new Error(r.rate_limits_available === false ? "no plan limits for this account" : "no limits in the reply");
  return { five, week, plan: r.subscription_type ?? null };
}

// The last rate_limits in some Codex log lines (newest last) → { five, week }.
export function parseCodex(text, now = Date.now()) {
  const lines = text.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].includes('"rate_limits"')) continue;
    let rec;
    try { rec = JSON.parse(lines[i]); } catch { continue; }
    const rl = rec?.payload?.rate_limits ?? rec?.payload?.info?.rate_limits;
    if (!rl) continue;
    const pick = (w) => (w ? win(w.used_percent, w.resets_at, now) : null);
    // primary is the short window (300 min), secondary the week; go by length when given.
    const ws = [rl.primary, rl.secondary].filter(Boolean);
    const short = ws.find((w) => w.window_minutes && w.window_minutes <= 1440) ?? rl.primary;
    const long = ws.find((w) => w.window_minutes && w.window_minutes > 1440) ?? rl.secondary;
    return { five: pick(short), week: pick(long), at: rec.timestamp ? Date.parse(rec.timestamp) : null };
  }
  return null;
}

async function claude() {
  const r = await exec("sh", [`${appHome()}/mods/tasker/bin/claude-usage.sh`]);
  if (r.code === 127) return null; // no claude CLI: nothing to show
  if (r.code !== 0 || !r.stdout.trim()) throw new Error("claude didn't answer");
  return parseClaude(r.stdout.trim().split("\n")[0]);
}

async function codex() {
  // The three newest logs, newest first: the first that recorded limits wins.
  const r = await exec("sh", ["-c", 'ls -t "$HOME"/.codex/sessions/*/*/*/rollout-*.jsonl 2>/dev/null | head -3']);
  for (const f of (r.stdout ?? "").split("\n").filter(Boolean)) {
    const t = await exec("tail", ["-c", "400000", f]);
    const got = t.code === 0 ? parseCodex(t.stdout ?? "") : null;
    if (got) return got;
  }
  return null;
}

const SOURCES = { claude, codex };

// Looks again every few minutes, from one copy at a time; every copy reads the result.
export class Usage {
  constructor() {
    this.c = sharedCache("usage"); // info: app -> { five, week, at } | { error }; seen: app -> when asked
  }

  get(app) {
    return this.c.info[app] ?? null;
  }

  refresh(cx, { force = false } = {}) {
    const now = Date.now();
    const due = Object.keys(SOURCES).filter((app) => !busy(this.c, app, now) && (force || now - (this.c.seen[app] ?? 0) > EVERY));
    if (!due.length) return;
    for (const app of due) { this.c.busy[app] = now; this.c.seen[app] = now; }
    const before = JSON.stringify(this.c.info);
    cx.spawn(async (cx) => {
      await Promise.all(due.map(async (app) => {
        try {
          const got = await SOURCES[app]();
          if (got) this.c.info[app] = { ...got, at: got.at ?? Date.now() };
          else delete this.c.info[app];
        } catch (e) {
          this.c.info[app] = { ...(this.c.info[app] ?? {}), error: String(e?.message ?? e) };
        }
        delete this.c.busy[app];
      }));
      if (JSON.stringify(this.c.info) !== before) cx.notify();
    });
  }
}
