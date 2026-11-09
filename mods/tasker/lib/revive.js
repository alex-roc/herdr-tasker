// Agents back after a restart. Herdr keeps every terminal: one that's lost (a reboot, the
// core crashing) comes back as a shell in its last folder, at the same address and in the
// same tab, but its program never runs again. tasker remembers which conversation each
// local Claude Code or Codex agent is in (data/tasker/terminals.json); a terminal that
// comes back as a fresh shell (another pid, no agent in front) gets
// `cd <folder> && claude --resume <id>` (or `codex resume <id>`) typed in.
// Quitting the agent yourself leaves the same shell (same pid): nothing is typed.

import { readTextFile, writeTextFile, exec, notify } from "herdr";
import { DIR } from "./store.js";
import { sharedCache } from "./cache.js";
import { resumeArgv } from "./actions.js";
import { agentInFront, shellOnly } from "./world.js";
import { S } from "../strings.js";

export const FILE = () => `${DIR()}/terminals.json`;
const KEEP_DAYS = 14;
const QUIT_MS = 10000;
const quote = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;


// What gets typed: back to the conversation's folder, then the agent's resume.
export async function resumeLine(r) {
  const argv = await resumeArgv({ app: r.app, id: r.id });
  return `${r.cwd ? `cd ${quote(r.cwd)} && ` : ""}${argv.map((a) => (/^[\w@%+=:,./-]+$/.test(a) ? a : quote(a))).join(" ")}`;
}

export class Revive {
  constructor() {
    this.c = sharedCache("revive").info; // recs: address -> { pid, tab, app, id, cwd, at }; text: the file as read or written
  }

  // Once per look, from the bookkeeping. `ts`: terminals(); `info`: AgentInfo.
  step(cx, ts, info, enabled = true) {
    const c = this.c;
    if (!c.loaded) return this.load(cx);
    const now = Date.now();
    const live = new Map(ts.filter((t) => t.state === "live" && !t.address.includes("/")).map((t) => [t.address, t]));
    let dirty = false;
    const back = [];
    for (const [addr, r] of Object.entries(c.recs)) {
      if (now - (r.at ?? 0) > KEEP_DAYS * 86400000) { delete c.recs[addr]; dirty = true; continue; }
      const t = live.get(addr);
      if (!t) continue; // gone for now (a core still starting): kept
      if (t.pid === r.pid) {
        // The same shell, itself in front for a while: the agent was quit by hand, so it isn't
        // one to bring back. (Right after a crash the old pid lingers with nothing in front.)
        if (shellOnly(t)) {
          r.quit ??= now;
          if (now - r.quit > QUIT_MS) { delete c.recs[addr]; dirty = true; }
        } else delete r.quit;
        continue;
      }
      // The address went to a terminal in another tab: not this one.
      if ((t.labels?.["herdr.tab"] ?? null) !== r.tab) { delete c.recs[addr]; dirty = true; continue; }
      r.pid = t.pid; // a new shell either way: never twice
      delete r.quit;
      dirty = true;
      if (!agentInFront(t) && enabled) back.push({ addr, r: { ...r } });
    }
    // Remember the conversation each local agent is in, while it's in front.
    for (const t of live.values()) {
      const i = info.get(t.address);
      // Only a conversation with a transcript (its model was read): an empty one can't resume.
      if (!i?.session || !i.model || !["claude", "codex"].includes(i.app) || !agentInFront(t)) continue;
      const r = c.recs[t.address];
      const tab = t.labels?.["herdr.tab"] ?? null;
      if (!r || r.pid !== t.pid || r.id !== i.session || r.tab !== tab) {
        c.recs[t.address] = { pid: t.pid, tab, app: i.app, id: i.session, cwd: i.cwd ?? t.foreground?.cwd ?? t.cwd ?? null, at: now };
        dirty = true;
      } else if (now - r.at > 3600000) { r.at = now; dirty = true; }
    }
    if (back.length) {
      cx.spawn(async () => {
        let n = 0;
        for (const b of back) {
          // Without HC_TERMINAL_ID: sent from inside a terminal, hc wraps the text as a message
          // from that agent (<hc from="t7">…</hc>), which a shell can't run.
          try { const res = await exec("env", ["-u", "HC_TERMINAL_ID", "hc", "send", b.addr, await resumeLine(b.r)]); if (res?.code === 0) n++; } catch {}
        }
        if (n) notify({ title: S.revived(n), body: S.revivedBody, level: "info" });
      });
    }
    if (dirty) this.save(cx);
  }

  load(cx) {
    const c = this.c;
    if (c.loading) return;
    c.loading = true;
    cx.spawn(async () => {
      let text = null;
      try { text = await readTextFile(FILE()); } catch {}
      let recs = {};
      try { const d = JSON.parse(text ?? "{}"); if (d && typeof d === "object" && !Array.isArray(d)) recs = d; } catch {}
      c.recs = recs;
      c.text = text;
      c.loaded = true;
    });
  }

  // One write at a time; a change while writing is written after.
  save(cx) {
    const c = this.c;
    c.dirty = true;
    if (c.writing) return;
    c.writing = true;
    cx.spawn(async () => {
      while (c.dirty) {
        c.dirty = false;
        const text = JSON.stringify(c.recs, null, 1) + "\n";
        if (text === c.text) continue;
        try {
          await writeTextFile(FILE(), text, c.text);
          c.text = text;
        } catch {
          // Changed under us (by hand): read it again; the next look writes.
          try { c.text = await readTextFile(FILE()); } catch {}
          break;
        }
      }
      c.writing = false;
    });
  }
}
