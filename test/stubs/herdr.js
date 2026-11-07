// The `herdr` module, faked for Node. Tests set the world in `H` (spaces, agents,
// terminals, files, what programs answer) and read back what the mod did
// (commands run, overlays opened, notifications).

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const COLORS = ["background", "foreground", "canvas", "chrome", "surface", "popover", "raised", "hover", "selected", "border", "input",
  "muted", "dim", "accent", "accent_foreground", "solid", "solid_foreground", "selection", "working", "blocked", "done", "idle", "unknown",
  ...Array.from({ length: 16 }, (_, i) => `ansi${i}`)];

export const H = {};

export function reset(over = {}) {
  for (const k of Object.keys(H)) delete H[k];
  Object.assign(H, {
    home: "/home/me",
    appHome: mkdtempSync(join(tmpdir(), "tasker-test-")),
    spaces: [], panes: [], agents: [], terminals: [],
    shared: {}, props: null, focused: null, window: { active: true, platform: "macos" },
    files: new Map(), watchers: [], commandQueue: [], commandWaiters: [],
    runs: [], overlays: [], closed: [], notes: [], agentOrder: null, labels: [], sent: [],
    knownAgents: [
      { key: "claude", name: "Claude Code", run: ["claude"], installed: true, agent: true },
      { key: "codex", name: "Codex", run: ["codex"], installed: true, agent: true },
      { key: "aider", name: "Aider", run: ["aider"], installed: false, agent: true },
    ],
    // (cmd, args, opts) => { code, stdout, stderr } | throws
    exec: () => ({ code: 0, stdout: "", stderr: "" }),
    execLog: [],
    hc: (args) => ({ code: 0, stdout: "", stderr: "" }),
    hcLog: [],
    ...over,
  });
  globalThis.__storage?.clear();
  delete globalThis.__tasker;
  return H;
}
reset();

export const theme = () => Object.fromEntries(COLORS.map((c, i) => [c, `#${(0x101010 + i * 0x030507).toString(16).padStart(6, "0").slice(-6)}`]));
export const settings = () => ({ dark: true });
export const home = () => H.home;
export const appHome = () => H.appHome;
export const spaces = () => H.spaces;
export const panes = () => H.panes;
export const agents = () => H.agents;
export const terminals = () => H.terminals;
export const focused = () => H.focused;
export const window = () => H.window;
export const layout = () => H.layout ?? null;
export const machines = () => [{ name: null, layout: "ready" }];
export const props = () => H.props;
export const shared = (k) => H.shared[k];
export const setShared = (k, v) => { H.shared[k] = v; return null; };
export const setAgentOrder = (list) => { H.agentOrder = list; return null; };
export const run = (name, args) => { H.runs.push([name, args ?? {}]); return null; };
export const notify = (n) => { H.notes.push(n); return null; };
export const openOverlay = (spec) => { H.overlays.push(spec); return `ov${H.overlays.length}`; };
export const closeOverlay = (id) => { H.closed.push(id); return null; };
export const playSound = () => null;
export const knownAgents = async () => H.knownAgents;

export async function exec(cmd, args = [], opts = {}) {
  H.execLog.push([cmd, args, opts]);
  return H.exec(cmd, args, opts);
}

export async function hc(args) {
  H.hcLog.push(args);
  return H.hc(args);
}

const fkey = (path, on) => (on ? `${on}:${path}` : path);

export async function readTextFile(path, opts = {}) {
  return H.files.get(fkey(path, opts.on)) ?? null;
}

export async function writeTextFile(path, text, expected) {
  const now = H.files.get(path) ?? null;
  if (now !== expected) throw new Error("stale snapshot");
  H.files.set(path, text);
  return null;
}

// Resolves on the next H.touch(path) under dir.
export function watchFolder(dir) {
  return new Promise((resolve) => H.watchers.push({ dir, resolve }));
}

export function touch(path) {
  const ws = H.watchers.filter((w) => path.startsWith(w.dir));
  H.watchers = H.watchers.filter((w) => !ws.includes(w));
  for (const w of ws) w.resolve([path]);
}

export function nextCommand() {
  if (H.commandQueue.length) return Promise.resolve(H.commandQueue.shift());
  return new Promise((resolve) => H.commandWaiters.push(resolve));
}

export function command(c) {
  const w = H.commandWaiters.shift();
  if (w) w(c); else H.commandQueue.push(c);
}
