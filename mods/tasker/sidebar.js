// The sidebar: Now (what unblocks progress) and Projects (the outline).
// The sidebar copy also keeps the books: it ties new tabs to the tasks that
// launched them, moves tasks as their agents work, and adds up agent time.

import { div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { theme, run, shared, setShared, setAgentOrder, home, spaces, terminals, panes, nextCommand, props, notify } from "herdr";
import { S } from "./strings.js";
import { setStatus } from "./lib/store.js";
import { nowView, projectTree, untrackedName } from "./lib/world.js";
import { arrived, link, openHere, adopt, openInProject } from "./lib/actions.js";
import { RANK, shortModel, kilo, base, tilde, today, isLater, laterLabel } from "./lib/util.js";
import { taskMark, prioChip, dueChip, agentMark, sectionHeader, iconButton, programIcon, CHEVRON, icon, agentFor, shownLists } from "./lib/ui.js";
import { sharedCache } from "./lib/cache.js";
import { openDialog } from "./lib/open.js";
import { projectColor } from "./dialogs.js";

const lead = (x) => [...(x.agents ?? [])].sort((a, b) => (RANK[b.top] ?? 0) - (RANK[a.top] ?? 0))[0] ?? null;

export const Sidebar = {
  initSidebar(cx) {
    this.folded = new Set(JSON.parse(localStorage.getItem("folded") ?? "[]"));
    this.filters = JSON.parse(localStorage.getItem("filters") ?? '{"done":false}');
    // A list can show one view only ({ view: "now" | "projects" }): two of them, one above
    // the other, show both at once. Without it, the list has Now/Projects tabs.
    this.fixedView = ["now", "projects"].includes(props()?.view) ? props().view : null;
    // Bookkeeping state lives where every list sees it: with two lists on screen,
    // whichever draws first records a change, and the other finds it recorded.
    this.books = sharedCache("books").info; // prevTop: task id -> top state; workSince: address -> ms
    this.handle = cx.focus_handle();
    this.order = [];
    cx.timer.every(30000, (cx) => cx.notify()); // durations
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommandSafe();
        if (c == null) return;
        // Key commands reach every list on screen: the first one acts.
        if (!this.isFirstList()) continue;
        if (c === "focus") this.handle.focus();
        else this.command(c, cx);
        cx.notify();
      }
    });
  },

  // The list that takes key commands and sets agent.next/prev: the only one on screen,
  // Now when both show (the list you work from), else the first.
  isFirstList() {
    const lists = shownLists();
    if (!lists.length) return true;
    return (lists.includes("now") ? "now" : lists[0]) === this.fixedView;
  },

  view() {
    return this.fixedView ?? shared("tasker.view") ?? "now";
  },

  // To the other view: the other tab, or the other list when both show.
  switchView() {
    const next = this.view() === "now" ? "projects" : "now";
    if (!this.fixedView || !shownLists().includes(next)) return setShared("tasker.view", next);
    sharedCache("lists").info.focus = next;
    setShared("tasker.listFocus", Date.now()); // redraws every list; that one takes the keys
  },

  fold(id, cx) {
    this.folded.has(id) ? this.folded.delete(id) : this.folded.add(id);
    localStorage.setItem("folded", JSON.stringify([...this.folded]));
    cx.notify();
  },

  // Selecting shows the task in the detail panel when it's open; it never opens it:
  // the panel is there when the person wants more (its button, cmd-i, i, Details).
  select(id) {
    setShared("tasker.selected", id);
  },

  // The pane to show for a task: its agent's (the one that needs you most), else a
  // terminal in one of its open tabs.
  paneOf(x) {
    const e = x && lead(x);
    if (e?.a?.pane) return e.a.pane;
    for (const tab of x?.live ?? []) {
      const p = panes().find((y) => y.tab === tab && y.terminal);
      if (p) return p.pane;
    }
    return null;
  },

  // To the task's agent or terminal; without one, its form.
  go(task, x) {
    const pane = this.paneOf(x);
    if (pane) run("pane.focus", { pane });
    else this.openTaskForm({ task: task.id });
  },

  // Keys: j/k move, enter goes to the agent, space done, 1-3 priority, n new, e edit, l launch, w worktree, / jump.
  command(c, cx) {
    const sel = shared("tasker.selected");
    const i = this.order.indexOf(sel);
    const task = this.store.task(sel);
    const move = (d) => { const id = this.order[Math.max(0, Math.min(this.order.length - 1, (i < 0 ? -d : i) + d))]; if (id) setShared("tasker.selected", id); };
    const upd = (fn) => task && cx.spawn(async () => this.store.update((d) => { const x = d.tasks.find((y) => y.id === task.id); if (!x) return false; fn(x); x.updated = Date.now(); }));
    // "select:<task id>" (herdr-app do tasker.select:<id>): show that task, for scripts and agents.
    // Asked for by a script or a notification: the panel opens for it.
    if (c.startsWith("select:")) {
      const id = c.slice(7);
      if (this.store.task(id)) { this.select(id); run("layout.show", { id: "tasker-detail" }); }
      return;
    }
    switch (c) {
      case "down": return move(1);
      case "up": return move(-1);
      case "open": return task && this.go(task, this.world?.taskById.get(task.id));
      case "done": return upd((x) => setStatus(x, x.status === "done" ? "next" : "done"));
      case "p1": case "p2": case "p3": return upd((x) => { x.priority = Number(c[1]); });
      case "new": return this.openTaskForm({});
      case "edit": return task && this.openTaskForm({ task: task.id });
      case "launch": return task && this.launch(cx, task, false);
      case "worktree": return task?.repo && this.launch(cx, task, true);
      case "resume": return task && this.resume(cx, task);
      case "later": return task && openDialog("later", { task: task.id });
      case "details": return task && run("layout.show", { id: "tasker-detail" });
      case "jump": return openDialog("jump");
      case "board": return this.openBoard();
      case "settings": return openDialog("settings");
      case "linear": return openDialog("issues", { source: "linear" });
      case "view": return this.switchView();
    }
  },

  key(e, cx) {
    const map = { j: "down", down: "down", k: "up", up: "up", enter: "open", space: "done", 1: "p1", 2: "p2", 3: "p3", n: "new", e: "edit", l: "launch", w: "worktree", r: "resume", z: "later", i: "details", "/": "jump", tab: "view" };
    const c = e.modifiers?.control || e.modifiers?.platform || e.modifiers?.alt ? null : map[e.key];
    if (!c) return;
    this.command(c, cx);
    cx.stop_propagation();
    cx.notify();
  },

  // The board is a tab whose pane is this mod: go to the one open, else make one here.
  openBoard() {
    const pane = panes().find((p) => p.mod === "tasker");
    if (pane) run("pane.focus", { pane: pane.pane });
    else run("tab.new", { name: S.board, mod: "tasker", props: { role: "board" } });
  },

  openTaskForm(p) {
    openDialog("task", p);
  },

  // ── Bookkeeping (this copy only) ────────────────────────────────────────
  keepBooks(cx, w) {
    const ops = [];
    const now = Date.now();
    // New tabs from launches.
    const pending = shared("tasker.pending") ?? [];
    if (pending.length) {
      const sp = spaces();
      const left = [];
      const taken = new Set(w.taskOfTab.keys());
      for (const p of pending) {
        const tab = arrived({ ...p, beforeTabs: new Set(p.beforeTabs), beforeSpaces: new Set(p.beforeSpaces) }, sp, taken);
        if (tab) { taken.add(tab); cx.spawn(async () => link(this.store, p.task, tab, terminals())); }
        else if (now - p.at < 30000) left.push(p);
      }
      if (left.length !== pending.length) setShared("tasker.pending", left);
    }
    // Agent time, per agent.
    const live = new Set();
    for (const x of w.tasks) {
      for (const e of x.agents) {
        const addr = e.a.address;
        live.add(addr);
        const workSince = (this.books.workSince ??= {});
        const since = workSince[addr];
        if (e.status === "working" && since == null) workSince[addr] = now;
        if (e.status !== "working" && since != null) {
          const ms = Math.min(now - since, 8 * 3600000);
          ops.push((d) => { const t = d.tasks.find((y) => y.id === x.t.id); if (t) t.agent_ms = (t.agent_ms ?? 0) + ms; });
          delete workSince[addr];
        }
      }
    }
    for (const a of Object.keys(this.books.workSince ?? {})) if (!live.has(a)) delete this.books.workSince[a];
    // The conversation each local agent is in, kept on its task so it can be resumed.
    for (const x of w.tasks) {
      for (const e of x.agents) {
        const info = e.a.address.includes("/") ? null : this.info.get(e.a.address);
        if (!info?.session || (x.t.sessions ?? []).some((s) => s.id === info.session)) continue;
        const rec = { app: info.app, id: info.session, cwd: info.cwd ? tilde(info.cwd, home()) : null, at: now };
        ops.push((d) => {
          const t = d.tasks.find((y) => y.id === x.t.id);
          if (t && !(t.sessions ?? []).some((s) => s.id === rec.id)) t.sessions = [...(t.sessions ?? []), rec].slice(-5);
        });
      }
    }
    // Task status follows its agents; never to done by itself.
    const first = this.books.prevTop == null;
    const prev = this.books.prevTop ?? {};
    this.books.prevTop = {};
    for (const x of w.tasks) {
      const top = x.top;
      this.books.prevTop[x.t.id] = top;
      if (first || prev[x.t.id] === top || x.t.archived || x.t.status === "dropped") continue;
      const was = prev[x.t.id];
      if (top === "working" && ["inbox", "next", "waiting", "review", "done"].includes(x.t.status)) ops.push((d) => setStatus(d.tasks.find((y) => y.id === x.t.id), "doing"));
      if (was === "working" && (top === "done" || top === "idle") && x.t.status === "doing") {
        ops.push((d) => setStatus(d.tasks.find((y) => y.id === x.t.id), "review"));
      }
      // Herdr itself notifies when an agent needs you or finishes: no second toast here.
    }
    this.remind(w, ops, now);
    if (ops.length) cx.spawn(async () => this.store.update((d) => { for (const op of ops) op(d); }));
  },

  // Tasks put off whose day came: back in Now, with a notification. And once a day,
  // what's due or late. `books.sent` keeps two lists on screen from sending twice.
  remind(w, ops, now) {
    const day = today();
    const sent = (this.books.sent ??= {});
    const on = this.store.data.settings.reminders !== false;
    const pick = (list) => list.map((x) => x.t);
    const tell = (title, tasks, level = "info") => {
      if (!on || !tasks.length) return;
      notify({ title, body: tasks.map((t) => t.title).slice(0, 4).join(" · ") + (tasks.length > 4 ? " …" : ""), level,
        action: tasks.length === 1 ? { name: `tasker.select:${tasks[0].id}` } : { name: "tasker.focus" } });
    };
    const back = pick(w.tasks.filter((x) => x.open && !x.t.archived && x.t.snooze && x.t.snooze !== "someday" && x.t.snooze <= day && sent[`back:${x.t.id}`] !== x.t.snooze));
    for (const t of back) {
      sent[`back:${t.id}`] = t.snooze;
      ops.push((d) => { const y = d.tasks.find((z) => z.id === t.id); if (y && y.snooze === t.snooze) { y.snooze = null; y.updated = now; } });
    }
    tell(S.backTitle(back.length), back);
    // One notification per task a day: one back from Later today isn't told again as due.
    const told = new Set(back.map((t) => t.id));
    const due = pick(w.tasks.filter((x) => x.open && !x.t.archived && !told.has(x.t.id) && !isLater(x.t) && x.t.due && x.t.due <= day && x.t.reminded !== day && sent[`due:${x.t.id}`] !== day));
    for (const t of due) {
      sent[`due:${t.id}`] = day;
      ops.push((d) => { const y = d.tasks.find((z) => z.id === t.id); if (y) y.reminded = day; });
    }
    tell(S.dueTitle(due.some((t) => t.due < day), due.length), due, due.some((t) => t.due < day) ? "warning" : "info");
  },

  // ── Rows ────────────────────────────────────────────────────────────────
  taskRow(t, x, { showRepo = false, depth = 0 } = {}) {
    const task = x.t;
    const e = lead(x);
    const info = e ? this.info.get(e.a.address) : null;
    const selected = shared("tasker.selected") === task.id;
    const blocked = e?.top === "blocked";
    const msg = blocked ? (e.report?.msg ?? "").replace(/^answer:\s*/i, "") : null;
    const since = this.sinceOf(e);
    const meta = e ? [shortModel(info?.model), info?.effort, info?.ctx ? S.ctx(kilo(info.ctx)) : null, agentFor(e.top, since)].filter(Boolean).join(" · ") : null;
    const later = isLater(task) ? S.laterUntil(laterLabel(task.snooze)) : null;
    const second = msg || meta || later || (task.next_step ? `→ ${task.next_step}` : null);
    const done = task.status === "done" || task.status === "dropped";
    const due = done ? null : dueChip(t, task.due);
    return v_flex().id(`t-${task.id}`).pl(8 + depth * 14).pr(6).py(4).flex_none().rounded(8).gap(1)
      .when(selected, (el) => el.bg(t.selected))
      .cursor_pointer().hover((s) => s.bg(t.hover))
      // Shows the task and brings its tab to the front; a task with none keeps the keys here.
      .on_click((_e, cx) => {
        this.select(task.id);
        const pane = this.paneOf(x);
        if (pane) run("pane.focus", { pane }); else this.handle.focus();
        cx.notify();
      })
      .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); setShared("tasker.selected", task.id); openDialog("menu", { task: task.id }); })
      .on_hover((on, cx) => { this.hovered = on ? task.id : this.hovered === task.id ? null : this.hovered; cx.notify(); })
      .child(h_flex().h(20).gap(7).items_center()
        .child(taskMark(t, task, e?.top))
        .child(div().flex_1().min_w(0).truncate().text_color(done || later ? t.dim : t.foreground).when(e?.top === "done", (el) => el.font_semibold()).child(task.title))
        .when(showRepo && Boolean(task.repo), (el) => el.child(div().flex_none().max_w(90).truncate().text_size(11).text_color(t.dim).child(base(task.repo))))
        .when(this.hovered === task.id && !e && !done, (el) => el.child(iconButton(t, `go-${task.id}`, "play", S.startHint, (_e, cx) => this.launch(cx, task, false))))
        .when(Boolean(due), (el) => el.child(due))
        .child(prioChip(t, task.priority)))
      .when(Boolean(second), (el) => el.child(div().pl(23).truncate().text_size(11).text_color(blocked ? t.blocked : t.dim).child(second)));
  },

  untrackedRow(t, u, depth = 0) {
    const e = u.agents[0];
    const p0 = u.panes[0];
    const name = untrackedName(u);
    const pic = programIcon(e?.a.program ?? p0?.program, 14, t.muted) ?? icon("square-terminal", 13, t.dim);
    const pane = e?.a.pane ?? p0?.pane;
    const info = e ? this.info.get(e.a.address) : null;
    // The same second line as a task's: model, effort, context, how long in this state.
    const meta = e ? [shortModel(info?.model), info?.effort, info?.ctx ? S.ctx(kilo(info.ctx)) : null, agentFor(u.top ?? e.status, this.sinceOf(e))].filter(Boolean).join(" · ") : "";
    const blocked = u.top === "blocked";
    const msg = blocked ? (e?.report?.msg ?? "").replace(/^answer:\s*/i, "") : "";
    const second = msg || meta;
    return v_flex().id(`u-${u.tab}`).pl(8 + depth * 14).pr(6).py(3).flex_none().gap(1).rounded(8)
      .cursor_pointer().hover((s) => s.bg(t.hover))
      .on_click(() => pane && run("pane.focus", { pane }))
      .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openDialog("loose", { tab: u.tab }); })
      .child(h_flex().h(20).gap(7).items_center()
      .child(h_flex().w(16).justify_center().child(agentMark(t, u.top) ?? pic))
      .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(name))
      .child(div().id(`track-${u.tab}`).px(6).h(18).rounded(4).flex().items_center().text_size(10.5).text_color(t.dim)
        .border_1().border_color(t.input).hover((s) => s.text_color(t.foreground).bg(t.hover)).tooltip(S.makeTaskHint)
        .on_click((_e, cx) => {
          cx.stop_propagation();
          cx.spawn(async () => { const id = await adopt(this.store, u); if (id) setShared("tasker.selected", id); });
        })
        .child(S.makeTask)))
      .when(Boolean(second), (el) => el.child(div().pl(23).truncate().text_size(11).text_color(blocked ? t.blocked : t.dim).child(second)));
  },

  // ── Now ─────────────────────────────────────────────────────────────────
  nowRows(t, w) {
    const v = nowView(w, this.store.data);
    const rows = [];
    const order = [];
    // `shut`: folded until opened (Later: out of the way is the point).
    const section = (id, label, list, color, { max = 99, untracked = [], shut = false } = {}) => {
      if (!list.length && !untracked.length) return;
      const key = shut ? `${id}:open` : id;
      const open = shut ? this.folded.has(key) : !this.folded.has(key);
      rows.push(sectionHeader(t, `sec-${id}`, label, list.length + untracked.length, color, open, (cx) => this.fold(key, cx)));
      if (!open) return;
      for (const x of list.slice(0, max)) { rows.push(this.taskRow(t, x, { showRepo: true })); order.push(x.t.id); }
      for (const u of untracked) rows.push(this.untrackedRow(t, u));
      if (list.length > max) rows.push(div().id(`more-${id}`).pl(31).h(22).text_size(11).text_color(t.dim).cursor_pointer().hover((s) => s.text_color(t.foreground))
        .on_click(() => setShared("tasker.view", "projects")).child(S.more(list.length - max)));
    };
    section("needs", S.needsYou, v.needs, t.blocked, { untracked: v.untrackedNeeds });
    section("review", S.toReview, v.review, t.done, { untracked: v.untrackedDone });
    section("working", S.working, v.working, t.working, { untracked: v.untrackedWorking });
    section("next", S.nextUp, v.next, t.foreground, { max: 7 });
    section("stalled", S.stalled, v.stalled, t.ansi3);
    section("inbox", S.inbox, v.inbox, t.dim, { max: 5 });
    section("loose", S.notInTask, [], t.dim, { untracked: v.untrackedIdle });
    section("later", S.later, v.later, t.dim, { shut: true });
    this.order = order;
    if (!rows.length) rows.push(div().px(12).pt(12).text_size(12).text_color(t.dim).child(S.emptyNow));
    return rows;
  },

  // ── Projects ────────────────────────────────────────────────────────────
  projectRows(t, w) {
    const tree = projectTree(w, this.store.data, home(), this.filters);
    const rows = [];
    const order = [];
    const repoRows = (proj, r) => {
      const id = `r:${proj?.id ?? "-"}:${r.key}`;
      const open = !this.folded.has(id);
      const sp = r.spaces[0];
      const st = sp?.repo;
      // Open: a space is in it, or one of its tasks has a terminal alive (an agent started elsewhere).
      const live = Boolean(sp) || r.tasks.some((x) => x.live.length > 0);
      const top = [...r.tasks.map((x) => x.top), ...r.untracked.map((u) => u.top)].reduce((m, s) => ((RANK[s] ?? 0) > (RANK[m] ?? 0) ? s : m), null);
      rows.push(h_flex().id(id).pl(18).pr(6).h(26).flex_none().gap(6).items_center().rounded(6).cursor_pointer()
        .hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => this.fold(id, cx))
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openDialog("repo", { repo: r.key, project: proj?.id ?? null }); })
        .child(svg(CHEVRON(open)).size(10).flex_none().text_color(t.dim))
        .child(div().flex_none().max_w(150).truncate().text_color(live ? t.foreground : t.dim).child(r.name))
        .when(Boolean(st?.branch), (el) => el.child(div().id(`br-${id}`).min_w(0).truncate().text_size(11).text_color(t.dim).tooltip(S.branchHint(st.branch)).child(`⎇ ${st.branch}`)))
        .when((st?.ahead ?? 0) > 0, (el) => el.child(div().id(`ah-${id}`).text_size(10.5).text_color(t.dim).tooltip(S.aheadHint(st.ahead)).child(`↑${st.ahead}`)))
        .when((st?.dirty ?? 0) > 0, (el) => el.child(div().id(`dt-${id}`).text_size(10.5).text_color(t.ansi3).tooltip(S.dirtyHint(st.dirty)).child(`•${st.dirty}`)))
        .when(!live, (el) => el.child(div().id(`no-${id}`).text_size(10.5).text_color(t.dim).tooltip(S.notOpenHint).child(S.notOpen)))
        .child(div().flex_1())
        .when(!open && Boolean(top), (el) => el.child(agentMark(t, top)))
        .child(iconButton(t, `term-${id}`, "square-terminal", S.newTerminal, () => openHere(r.key)))
        .child(iconButton(t, `add-${id}`, "plus", S.newTask, () => this.openTaskForm({ repo: r.key, project: proj?.id ?? null })))
        .child(iconButton(t, `more-${id}`, "ellipsis", S.repoMenu, () => openDialog("repo", { repo: r.key, project: proj?.id ?? null }))));
      if (!open) return;
      for (const x of r.tasks) { rows.push(this.taskRow(t, x, { depth: 2 })); order.push(x.t.id); }
      for (const u of r.untracked) rows.push(this.untrackedRow(t, u, 2));
    };
    const projectHeader = (x) => {
      const p = x.p;
      const id = `p:${p?.id ?? "-"}`;
      const open = !this.folded.has(id);
      rows.push(h_flex().id(id).px(8).pt(8).h(32).flex_none().gap(7).items_center().cursor_pointer()
        .on_click((_e, cx) => this.fold(id, cx))
        .on_mouse_down("right", (_e, cx) => { if (p) { cx.stop_propagation(); openDialog("project-menu", { project: p.id }); } })
        .child(div().size(9).rounded(3).flex_none().bg(p ? projectColor(p) : t.dim))
        .child(div().flex_1().min_w(0).truncate().text_size(12).font_semibold().text_color(p ? t.foreground : t.dim).child(p?.name ?? S.noProject))
        .when(!open && Boolean(x.top), (el) => el.child(agentMark(t, x.top)))
        // A terminal and a task for the whole project (every repository), and its menu.
        .when(Boolean(p?.repos?.length), (el) => el.child(iconButton(t, `pterm-${id}`, "square-terminal", S.projectTerminal, () => openInProject(p))))
        .when(Boolean(p), (el) => el
          .child(iconButton(t, `padd-${id}`, "plus", S.projectTaskHint, () => this.openTaskForm({ project: p.id })))
          .child(iconButton(t, `pmore-${id}`, "ellipsis", S.projectMenu, () => openDialog("project-menu", { project: p.id }))))
        .child(div().text_size(11).text_color(t.dim).child(String(x.count)))
        .child(svg(CHEVRON(open)).size(11).flex_none().text_color(t.dim)));
      if (!open) return;
      for (const t2 of x.loose) { rows.push(this.taskRow(t, t2, { depth: 1 })); order.push(t2.t.id); }
      for (const r of x.repos.values()) repoRows(p, r);
    };
    for (const x of tree.projects) projectHeader(x);
    if (tree.orphan.count || tree.orphan.repos.size) projectHeader(tree.orphan);
    this.order = order;
    if (!rows.length) rows.push(div().px(12).pt(12).text_size(12).text_color(t.dim).child(S.emptyProjects));
    return rows;
  },

  renderSidebar(cx) {
    const t = theme();
    const w = this.world;
    const view = this.view();
    // Asked to take the keys (tab in the other list).
    const lists = sharedCache("lists").info;
    if (this.fixedView && lists.focus === this.fixedView) { lists.focus = null; this.handle.focus(); }
    const rows = !this.store.loaded ? [div().px(12).text_color(t.dim).child(S.loading)]
      : view === "now" ? this.nowRows(t, w) : this.projectRows(t, w);
    // agent.next/prev follow the list.
    const seen = new Set();
    const addrs = [];
    for (const id of this.order) for (const e of w.taskById.get(id)?.agents ?? []) if (!seen.has(e.a.address)) { seen.add(e.a.address); addrs.push(e.a.address); }
    // agent.next/prev follow the first list on screen.
    if (this.isFirstList()) setAgentOrder(addrs);
    const tabBtn = (id, label) => div().id(`v-${id}`).px(9).h(24).gap(5).rounded(6).flex().items_center().text_size(12).cursor_pointer()
      .bg(view === id ? t.selected : t.chrome).text_color(view === id ? t.foreground : t.muted).font_medium()
      .hover((s) => s.bg(t.hover)).on_click(() => setShared("tasker.view", id)).child(icon(id === "now" ? "zap" : "folder-tree", 13)).child(label);
    return v_flex().id("tasker-sidebar").track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx))
      .size_full().min_h(0).bg(t.chrome).text_size(12.8).text_color(t.foreground)
      .child(h_flex().px(10).h(40).flex_none().gap(4).items_center().border_b(1).border_color(t.border)
        .when(!this.fixedView, (el) => el.child(tabBtn("now", S.now)).child(tabBtn("projects", S.projects)))
        .when(Boolean(this.fixedView), (el) => el.child(h_flex().px(4).gap(6).items_center().text_size(12).font_medium().text_color(t.muted)
          .child(icon(view === "now" ? "zap" : "folder-tree", 13)).child(view === "now" ? S.now : S.projects)))
        .child(div().flex_1())
        .when(view === "projects", (el) => el.child(iconButton(t, "flt-done", this.filters.done ? "eye" : "eye-off", this.filters.done ? S.hideDone : S.showDone, (_e, cx) => {
          this.filters.done = !this.filters.done; localStorage.setItem("filters", JSON.stringify(this.filters)); cx.notify();
        })).child(iconButton(t, "add-proj", "folder-plus", S.newProject, () => openDialog("project"))))
        .child(iconButton(t, "board", "square-kanban", S.openBoard, () => this.openBoard()))
        .child(iconButton(t, "jump", "search", S.searchTasks, () => this.command("jump", null)))
        .child(iconButton(t, "add-task", "plus", S.newTask, () => this.openTaskForm({}))))
      .when(Boolean(this.store.error), (el) => el.child(div().px(12).py(6).text_size(11).text_color(t.blocked).child(this.store.error)))
      .child(v_flex().id("tasker-list").flex_1().min_h(0).px(6).pb(10).overflow_y_scrollbar().children(rows));
  },
};

// Key commands bound to this mod in keys.json ("tasker.jump"…), and "focus" from pane.go.
async function nextCommandSafe() {
  try { return await nextCommand(); } catch { return null; }
}
