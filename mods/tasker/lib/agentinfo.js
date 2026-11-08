// What Herdr doesn't report about an agent: its model, reasoning effort and
// context size, read from the agent's own session log. Claude Code and Codex;
// others show only what Herdr knows.
//
// Claude Code: ~/.claude/sessions/<pid>.json names the session and its folder;
// the transcript is ~/.claude/projects/<folder, non-alphanumerics as ->/<session>.jsonl.
// Codex: the rollout-*.jsonl the process holds open (lsof), else the newest one
// for the same folder; its last turn_context and token_count.

import { exec, readTextFile, home } from "herdr";
import { sharedCache, busy } from "./cache.js";

const TAIL = 262144; // bytes read from the end of a Codex log
const CLAUDE_TAIL = 16000000; // Claude Code transcripts: searched, not parsed

async function tail(file, on) {
  try {
    const r = await exec("tail", ["-c", String(TAIL), file], { on });
    return r.code === 0 ? r.stdout : "";
  } catch {
    return "";
  }
}

// Lines of a log tail, newest first, as objects (the first, cut line is skipped).
function records(text) {
  const lines = text.split("\n");
  lines.shift();
  const out = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i];
    if (!l) continue;
    try { out.push(JSON.parse(l)); } catch {}
  }
  return out;
}

// terminals() gives the status as a word and the agent's report apart; `hc` JSON nests it.
export const report = (t) => t?.report ?? (typeof t?.status === "object" ? t.status : null);
export const word = (t) => (typeof t?.status === "string" ? t.status : t?.status?.state ?? null);

function kind(term) {
  const fg = term?.foreground;
  const app = report(term)?.app;
  const words = [fg?.name, ...(fg?.argv ?? []), app, ...(term?.argv ?? [])].filter(Boolean).join(" ").toLowerCase();
  if (app === "claude-code" || /\bclaude\b/.test(words)) return "claude";
  if (/\bcodex\b/.test(words)) return "codex";
  return null;
}


// The home folder on `on` (null: here), asked once per machine.
async function homeOf(on) {
  if (!on) return home();
  const c = sharedCache("homes");
  if (c.info[on]) return c.info[on];
  try {
    const r = await exec("sh", ["-c", 'printf %s "$HOME"'], { on });
    if (r.code === 0 && r.stdout) c.info[on] = r.stdout.trim();
  } catch {}
  return c.info[on] ?? null;
}

async function claude(pid, on) {
  const h = await homeOf(on);
  if (!h) return null;
  let session;
  try { session = JSON.parse(await readTextFile(`${h}/.claude/sessions/${pid}.json`, { on }) ?? "null"); } catch {}
  if (!session?.sessionId || !session?.cwd) return null;
  const file = `${h}/.claude/projects/${session.cwd.replace(/[^A-Za-z0-9]/g, "-")}/${session.sessionId}.jsonl`;
  // Transcripts hold multi-megabyte lines (pasted images): pick the fields out with grep
  // instead of parsing whole lines. The last of each wins.
  // 4 MB first (~0.3 s); 16 MB only when a big paste hid every model line.
  const pick = async (bytes) => {
    let out = "";
    try {
      const r = await exec("sh", ["-c", `tail -c ${bytes} "$1" | LC_ALL=C grep -aoE '"model":"claude-[^"]*"|"effort":"[a-z]+"|"(input_tokens|cache_read_input_tokens|cache_creation_input_tokens|output_tokens)":[0-9]+' | tail -n 60`, "sh", file], { on });
      out = r.stdout ?? "";
    } catch {}
    const found = {};
    for (const l of out.split("\n")) {
      const m = /^"([a-z_]+)":"?([^"]*)"?$/.exec(l.trim());
      if (m) found[m[1]] = m[2];
    }
    return found;
  };
  let last = await pick(4000000);
  if (!last.model) last = await pick(CLAUDE_TAIL);
  const n = (k) => Number(last[k] ?? 0);
  const ctx = n("input_tokens") + n("cache_read_input_tokens") + n("cache_creation_input_tokens") + n("output_tokens");
  return { app: "claude", model: last.model ?? null, effort: last.effort ?? null, ctx: ctx || null, ctxMax: null, session: session.sessionId, cwd: session.cwd };
}

async function codexFile(pid, cwd, on) {
  try {
    const r = await exec("lsof", ["-p", String(pid), "-Fn"], { on });
    const hit = (r.stdout ?? "").split("\n").find((l) => /^n.*rollout-.*\.jsonl$/.test(l));
    if (hit) return hit.slice(1);
  } catch {}
  // Not held open: the newest rollouts, the first whose turn ran in this folder.
  try {
    const r = await exec("sh", ["-c", 'ls -t "$HOME"/.codex/sessions/*/*/*/rollout-*.jsonl 2>/dev/null | head -5'], { on });
    for (const f of (r.stdout ?? "").split("\n").filter(Boolean)) {
      const ctx = records(await tail(f, on)).find((x) => x?.type === "turn_context");
      if (ctx?.payload?.cwd === cwd) return f;
    }
  } catch {}
  return null;
}

async function codex(pid, cwd, on) {
  const file = await codexFile(pid, cwd, on);
  if (!file) return null;
  let model = null, effort = null, ctx = null, ctxMax = null, where = null;
  for (const r of records(await tail(file, on))) {
    if (!model && r?.type === "turn_context") { model = r.payload?.model ?? null; effort = r.payload?.effort ?? null; where = r.payload?.cwd ?? null; }
    if (ctx == null && r?.payload?.type === "token_count" && r.payload.info) {
      ctx = r.payload.info.last_token_usage?.input_tokens ?? null;
      ctxMax = r.payload.info.model_context_window ?? null;
    }
    if (model && ctx != null) break;
  }
  // rollout-<time>-<session id>.jsonl: the id `codex resume` takes.
  const session = /-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/.exec(file)?.[1] ?? null;
  return { app: "codex", model, effort, ctx, ctxMax, session, cwd: where ?? cwd ?? null };
}

// Cached per process: looked at again when the agent's state changes, or every
// `maxAge` while it works (model and effort rarely change; context does, slowly).
export class AgentInfo {
  constructor() {
    this.c = sharedCache("agents"); // info: address -> info; seen: address -> { pid, status, at }
  }

  get(address) {
    return this.c.info[address] ?? null;
  }

  refresh(cx, terms, maxAge = 120000) {
    const now = Date.now();
    const { seen } = this.c;
    const due = terms.filter((t) => {
      const pid = t?.foreground?.pid;
      if (!pid || busy(this.c, t.address, now) || !kind(t)) return false;
      const s = seen[t.address];
      const status = word(t);
      return !s || s.pid !== pid || s.status !== status || (status === "working" && now - s.at > maxAge);
    });
    if (!due.length) return;
    for (const t of due) this.c.busy[t.address] = now;
    cx.spawn(async (cx) => {
      for (const t of due) {
        const pid = t.foreground.pid;
        const on = t.address.includes("/") ? t.address.split("/")[0] : null;
        let info = null;
        try {
          info = kind(t) === "claude" ? await claude(pid, on) : await codex(pid, t.foreground.cwd ?? t.cwd, on);
        } catch {}
        if (info) this.c.info[t.address] = info;
        this.c.seen[t.address] = { pid, status: word(t), at: Date.now() };
        delete this.c.busy[t.address];
      }
      cx.notify();
    });
  }
}
