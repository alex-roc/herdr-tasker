#!/usr/bin/env node
// A demo of tasker in the running Herdr window, for screenshots and trying it out:
// three made-up repositories in ~/tasker-demo, tasks in every status, and stand-in
// agents (scripts/fake-agent.sh) working, blocked on a question and done.
//
//   node scripts/demo.mjs          set it up (your tasks.json is put aside first)
//   node scripts/demo.mjs --clean  close the demo spaces, delete ~/tasker-demo, restore your tasks
//
// Nothing here touches your own spaces or repositories.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync, copyFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HOME = homedir();
const ROOT = join(HOME, "tasker-demo");
const STATE = join(ROOT, ".demo.json");
const APP = process.env.HERDR_APP_HOME ?? join(HOME, ".config", "herdr-app");
const FILE = join(APP, "data", "tasker", "tasks.json");
const BACKUP = `${FILE}.before-demo`;
const AGENT = join(dirname(fileURLToPath(import.meta.url)), "fake-agent.sh");
const DAY = 86400000;

const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts }).trim();
const herdr = (command, args) => JSON.parse(sh("herdr-app", ["do", command, JSON.stringify(args)]));
const day = (n) => { const d = new Date(Date.now() + n * DAY); return d.toISOString().slice(0, 10); };

function clean() {
  if (existsSync(STATE)) {
    const { spaces = [] } = JSON.parse(readFileSync(STATE, "utf8"));
    for (const id of spaces) { try { herdr("space.close", { id, confirmed: true }); } catch {} }
  }
  if (existsSync(BACKUP)) renameSync(BACKUP, FILE);
  rmSync(ROOT, { recursive: true, force: true });
  console.log("Demo removed; your tasks.json is back.");
}

function repo(name, files, dirty = {}) {
  const dir = join(ROOT, name);
  mkdirSync(dir, { recursive: true });
  for (const [f, text] of Object.entries(files)) { mkdirSync(dirname(join(dir, f)), { recursive: true }); writeFileSync(join(dir, f), text); }
  sh("git", ["init", "-q", "-b", "main"], { cwd: dir });
  sh("git", ["add", "."], { cwd: dir });
  sh("git", ["-c", "user.name=Demo", "-c", "user.email=demo@example.com", "commit", "-qm", "Start"], { cwd: dir });
  for (const [f, text] of Object.entries(dirty)) writeFileSync(join(dir, f), text);
  return `~/tasker-demo/${name}`;
}

function agent(title, state, msg = "") {
  return ["env", `TITLE=${title}`, "sh", AGENT, state, msg];
}

function setup() {
  if (existsSync(ROOT)) { console.error(`${ROOT} exists: run with --clean first.`); process.exit(1); }
  const web = repo("acme-web", { "README.md": "# acme-web\n", "src/auth/login.tsx": "export {};\n" }, { "src/auth/login.tsx": "export const login = () => {};\n", "src/auth/callback.ts": "// wip\n" });
  const api = repo("acme-api", { "README.md": "# acme-api\n", "src/limits.ts": "export {};\n" });
  const book = repo("handbook", { "README.md": "# Handbook\n" });
  const abs = (r) => r.replace(/^~/, HOME);

  const w1 = herdr("space.new", { folder: abs(web), tab: "Add OAuth login", argv: agent("Add OAuth login", "working") });
  const w2 = herdr("tab.new", { space: w1.space, name: "Pick a database", folder: abs(web), argv: agent("Pick a database", "blocked", "Sessions: Postgres or SQLite?") });
  const a1 = herdr("space.new", { folder: abs(api), tab: "Rate limiter", argv: agent("Rate-limit the public API", "done") });
  const b1 = herdr("space.new", { folder: abs(book) });
  writeFileSync(STATE, JSON.stringify({ spaces: [w1.space, a1.space, b1.space] }));

  mkdirSync(dirname(FILE), { recursive: true });
  if (existsSync(FILE) && !existsSync(BACKUP)) copyFileSync(FILE, BACKUP);
  const now = Date.now();
  let n = 0;
  const task = (f) => ({ id: `demo${++n}`, project: null, repo: null, status: "next", priority: 2, due: null, estimate: null, next_step: "", notes: "",
    issue: null, worktree: null, branch: null, tabs: [], created: now - (3 + n) * DAY, updated: now - DAY, done_at: null, agent_ms: 0,
    history: [{ s: "inbox", at: now - (3 + n) * DAY }, { s: f.status ?? "next", at: f.updated ?? now - DAY }], ...f });
  const data = {
    version: 1,
    settings: { wip: 3, stale_days: 3, agent: "claude" },
    projects: [
      { id: "acme", name: "Acme", color: "ansi4", repos: [web, api] },
      { id: "book", name: "Handbook", color: "ansi5", repos: [book] },
    ],
    tasks: [
      task({ title: "Add OAuth login", project: "acme", repo: web, status: "doing", priority: 1, due: day(2), next_step: "Wire the callback route", tabs: [w1.tab], agent_ms: 47 * 60000, estimate: "1d" }),
      task({ title: "Pick a database for sessions", project: "acme", repo: web, status: "doing", tabs: [w2.tab], agent_ms: 12 * 60000 }),
      task({ title: "Rate-limit the public API", project: "acme", repo: api, status: "review", priority: 1, tabs: [a1.tab], agent_ms: 33 * 60000,
        issue: { number: 31, url: "https://github.com/example/acme-api/issues/31", body: "" } }),
      task({ title: "Fix the flaky checkout test", project: "acme", repo: web, priority: 1, due: day(0), next_step: "Reproduce with --repeat 50" }),
      task({ title: "Write the onboarding guide", project: "book", repo: book, priority: 2, due: day(4), estimate: "3h" }),
      task({ title: "Upgrade to Node 24", project: "acme", repo: api, priority: 3 }),
      task({ title: "Pricing page copy", project: "acme", repo: web, status: "waiting", next_step: "Waiting on design", updated: now - 5 * DAY }),
      task({ title: "Try a dark theme for the docs", project: "book", status: "inbox", priority: 3 }),
      task({ title: "Import the old wiki", project: "book", repo: book, status: "inbox" }),
      task({ title: "Ship the v1.4 changelog", project: "book", repo: book, status: "done", done_at: now - 2 * 3600000 }),
      task({ title: "Rotate the API keys", project: "acme", repo: api, status: "done", done_at: now - 2 * DAY }),
    ],
  };
  writeFileSync(FILE, JSON.stringify(data, null, 1) + "\n");
  herdr("space.select", { id: w1.space });
  console.log("Demo ready: three repos in ~/tasker-demo, 11 tasks, 3 stand-in agents. Clean up with: node scripts/demo.mjs --clean");
}

process.argv.includes("--clean") ? clean() : setup();
