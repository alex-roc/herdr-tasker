// tasker: a task manager over repos and coding agents.
// One mod, several roles by props: { role: "sidebar" | "detail" | "status" | "board" },
// or { dialog: ... } when opened as an overlay. Data: data/tasker/tasks.json.

import { View, div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { props, run, theme, spaces, panes, agents, terminals, home, window, shared, setShared, notify } from "herdr";
import { S } from "./strings.js";
import { Store } from "./lib/store.js";
import { icon, onScreen } from "./lib/ui.js";
import { openDialog } from "./lib/open.js";
import { RepoCache } from "./lib/git.js";
import { AgentInfo } from "./lib/agentinfo.js";
import { build } from "./lib/world.js";
import { Usage } from "./lib/usage.js";
import { sharedCache } from "./lib/cache.js";
import { launch } from "./lib/actions.js";
import { today, localDay, resetsLabel } from "./lib/util.js";
import { Sidebar } from "./sidebar.js";
import { Detail } from "./detail.js";
import { Dialogs } from "./dialogs.js";
import { Board } from "./board.js";

export default class Tasker extends View {
  init(_props, cx) {
    const p = props() ?? {};
    this.role = p.dialog ? "dialog" : p.role ?? "sidebar";
    this.store = new Store();
    this.store.watch(cx);
    this.repos = new RepoCache();
    this.info = new AgentInfo();
    this.world = null;
    // When each agent's state last changed: terminals() doesn't always say.
    // One record for every copy, so the sidebar, the board and the detail agree.
    const c = sharedCache("since");
    if (!c.loaded) { try { Object.assign(c.info, JSON.parse(localStorage.getItem("since") ?? "{}")); } catch {} c.loaded = true; }
    this.since = c.info;
    if (this.role === "sidebar") this.initSidebar(cx);
    else if (this.role === "detail") this.initDetail(cx);
    else if (this.role === "dialog") this.initDialog(cx);
    else if (this.role === "board") this.initBoard(cx);
    else {
      this.usage = new Usage();
      cx.timer.every(60000, (cx) => cx.notify());
    }
  }

  // Herdr's live data joined with the tasks, once per render. Without a cx (a menu
  // that only needs the spaces), nothing is looked up.
  look(cx) {
    const sp = spaces(), ps = panes(), ts = terminals();
    const ag = agents();
    this.world = build({ data: this.store.data, sp, ps, ag, ts, repos: this.repos, h: home() });
    this.track(ag, ts);
    if (!cx || this.role === "dialog") return;
    if (this.role === "sidebar") {
      // Repo state of every local space (remote ones stay as folders).
      const list = this.world.spaces.filter((s) => s.folder && !s.on).map((s) => ({ folder: s.folder, on: null }));
      this.repos.refresh(cx, list, window()?.active ? 45000 : 180000);
    }
    // Every agent's model and context: in tasks and in no task alike.
    if (this.role !== "status") this.info.refresh(cx, [...this.world.tasks.flatMap((x) => x.agents), ...this.world.untracked.flatMap((u) => u.agents)].map((e) => e.term).filter(Boolean));
  }

  // Stamps agents whose state changed (done and idle count as one, as in Herdr's list).
  track(ag, ts) {
    const now = Date.now();
    const ms = new Map(ts.map((t) => [t.address, t.status_ms]));
    let dirty = false;
    for (const a of ag) {
      const s = a.status === "done" ? "idle" : a.status;
      if (this.since[a.address]?.s === s) continue;
      this.since[a.address] = { s, at: this.since[a.address] ? now : ms.get(a.address) ?? now };
      dirty = true;
    }
    if (!dirty) return;
    const live = new Set(ag.map((a) => a.address));
    for (const [k, v] of Object.entries(this.since)) if (!live.has(k) && now - v.at > 7 * 86400000) delete this.since[k];
    try { localStorage.setItem("since", JSON.stringify(this.since)); } catch {}
  }

  // When an agent's state last changed: the core's own stamp, else its tab's
  // (Herdr keeps working_since and changed_at per tab), else what tasker saw.
  sinceOf(e) {
    if (!e) return null;
    const tab = this.world?.spaceOfTab.get(e.a.tab)?.tab;
    const fromTab = e.status === "working" ? tab?.working_since : tab?.changed_at;
    return e.term?.status_ms ?? fromTab ?? this.since[e.a.address]?.at ?? null;
  }

  launch(cx, task, worktree, resume = null) {
    cx.spawn(() => this.startAgent(task, worktree, resume));
  }

  // Continues the task's last agent conversation (after a restart, or a closed tab).
  resume(cx, task) {
    cx.spawn(() => this.resumeAgent(task));
  }

  // The work itself, for a dialog that waits on it before closing.
  async startAgent(task, worktree, resume = null) {
    try {
      const pending = await launch(this.store, task, { worktree, resume });
      setShared("tasker.pending", [...(shared("tasker.pending") ?? []), { ...pending, beforeTabs: [...pending.beforeTabs], beforeSpaces: [...pending.beforeSpaces] }]);
    } catch (e) {
      notify({ title: S.launchFailed, body: String(e?.message ?? e), level: "error" });
    }
  }

  async resumeAgent(task) {
    const s = task?.sessions?.at(-1);
    if (s) await this.startAgent(task, false, s);
  }

  renderStatus(cx) {
    const t = theme();
    const w = this.world;
    const d = this.store.data;
    const open = w.tasks.filter((x) => x.open);
    const doneToday = w.tasks.filter((x) => x.t.done_at && localDay(x.t.done_at) === today()).length;
    const doing = open.filter((x) => x.t.status === "doing").length;
    const needs = open.filter((x) => x.top === "blocked").length + w.untracked.filter((u) => u.top === "blocked").length;
    const working = [...w.byTab.values()].flat().filter((e) => e.status === "working").length;
    const max = d.settings.wip;
    const over = doing > max;
    const item = (id, color, iconName, text, onClick) => h_flex().id(id).gap(5).items_center().text_color(color)
      .when(Boolean(iconName), (el) => el.child(icon(iconName, 12)))
      .when(Boolean(onClick), (el) => el.cursor_pointer().hover((s) => s.opacity(0.8)).on_click(onClick))
      .child(text);
    // Plan usage: looked at every few minutes, only with the window in front.
    if (d.settings.usage && window()?.active) this.usage.refresh(cx);
    const usage = d.settings.usage ? ["claude", "codex"].map((app) => this.usageItem(t, app, item)).filter(Boolean) : [];
    return h_flex().size_full().px(14).gap(14).items_center().bg(t.chrome).border_t(1).border_color(t.border).text_size(11.5)
      .child(item("st-done", doneToday ? t.ansi2 : t.dim, "circle-check", S.doneToday(doneToday)))
      .child(item("st-doing", over ? t.ansi3 : t.muted, null, over ? S.doingOver(doing, max) : S.doingCount(doing, max)))
      .when(needs > 0, (el) => el.child(item("st-needs", t.blocked, "circle-alert", S.needCount(needs), () => setShared("tasker.view", "now"))))
      .child(item("st-working", working ? t.working : t.dim, "bot", S.workingCount(working)))
      .child(div().flex_1())
      .children(usage)
      .child(item("st-open", t.dim, null, S.openCount(open.length)))
      // The task panel: open when you want more about a task; selecting never opens it.
      .child(div().id("st-detail").cursor_pointer().text_color(onScreen("tasker-detail") ? t.foreground : t.dim).hover((s) => s.text_color(t.foreground))
        .tooltip(S.detailsToggle).on_click((_e, cx) => { run("layout.toggle", { id: "tasker-detail" }); cx.notify(); }).child(icon("panel-right", 13)))
      .child(div().id("st-settings").text_color(t.dim).cursor_pointer().hover((s) => s.text_color(t.foreground)).tooltip(S.settings)
        .on_click(() => openSettings()).child(icon("settings", 13)));
  }

  // "Claude 28% wk 34%", colored by the fuller limit; the hover says when each resets.
  usageItem(t, app, item) {
    const u = this.usage.get(app);
    if (!u) return null;
    const name = S.usageApp[app];
    const again = (_e, cx) => this.usage.refresh(cx, { force: true });
    if (!u.five && !u.week) return u.error ? item(`st-u-${app}`, t.dim, null, `${name} !`, again).tooltip(S.usageError(name, u.error)) : null;
    const top = Math.max(u.five?.pct ?? 0, u.week?.pct ?? 0);
    const color = top >= 90 ? t.blocked : top >= 70 ? t.ansi3 : t.muted;
    const w = (x) => (x ? { pct: x.pct, resets: resetsLabel(x.resets) } : null);
    const asOf = app === "codex" && u.at ? resetsLabel(u.at) : null;
    return item(`st-u-${app}`, color, null, S.usageItem(name, u.five?.pct, u.week?.pct), again)
      .tooltip(u.error ? S.usageError(name, u.error) : S.usageHint(name, w(u.five), w(u.week), asOf));
  }

  render(cx) {
    if (this.role === "dialog") return this.renderDialog(cx);
    this.look(cx);
    if (this.role === "sidebar") {
      if (this.store.loaded) this.keepBooks(cx, this.world);
      return this.renderSidebar(cx);
    }
    if (this.role === "detail") return this.renderDetail(cx);
    if (this.role === "board") return this.renderBoard(cx);
    return this.renderStatus(cx);
  }
}

export const openSettings = () => openDialog("settings");

Object.assign(Tasker.prototype, Sidebar, Detail, Dialogs, Board);
