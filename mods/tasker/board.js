// The board: a tab with one column per status. Drag a card to another column
// to change its status; click it to open it; right-click for its menu.

import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { theme, setShared, run, shared, props } from "herdr";
import { S } from "./strings.js";
import { setStatus } from "./lib/store.js";
import { RANK, byUrgency, base, shortModel, issueLabel, isLater, laterLabel } from "./lib/util.js";
import { statusIcon, taskMark, prioChip, dueChip, chip, iconButton, icon, agentFor, agentMark, programIcon } from "./lib/ui.js";
import { untrackedName } from "./lib/world.js";
import { adopt, openBoard } from "./lib/actions.js";
import { openDialog } from "./lib/open.js";
import { projectColor } from "./dialogs.js";

const COLUMNS = ["inbox", "next", "doing", "waiting", "review", "done"];
const DONE_DAYS = 7;

export const Board = {
  initBoard(cx) {
    // Every board is a tab: the board of every project, or one project's ({ project }).
    // Its pills go from one board to another; the tab's name says which one this is.
    this.fixedProject = props()?.project ?? null;
    this.boardProject = this.fixedProject;
    this.pressed = null; // task id held down
    this.over = null; // column under the pointer while dragging
    cx.timer.every(30000, (cx) => cx.notify());
  },

  boardColumns(w) {
    const now = Date.now();
    const cols = Object.fromEntries(COLUMNS.map((c) => [c, []]));
    for (const x of w.tasks) {
      if (x.t.archived || x.t.status === "dropped") continue;
      if (this.boardProject && x.project !== this.boardProject) continue;
      if (x.t.status === "done" && now - (x.t.done_at ?? 0) > DONE_DAYS * 86400000 && !x.live.length) continue;
      cols[x.t.status]?.push(x);
    }
    for (const c of COLUMNS) {
      cols[c].sort(c === "done"
        ? (a, b) => (b.t.done_at ?? 0) - (a.t.done_at ?? 0)
        : (a, b) => (RANK[b.top] ?? 0) - (RANK[a.top] ?? 0) || byUrgency(a.t, b.t));
    }
    return cols;
  },

  drop(cx, status) {
    // A loose agent dropped on a column: it becomes a task there. Released on its own lane: go to it.
    if (String(this.pressed ?? "").startsWith("tab:")) {
      const tab = this.pressed.slice(4);
      const u = this.world.untracked.find((x) => x.tab === tab);
      this.pressed = null;
      this.over = null;
      if (u && status !== "loose") {
        cx.spawn(async () => { const id = await adopt(this.store, u, { status }); if (id) setShared("tasker.selected", id); });
      } else if (u) {
        const pane = u.agents[0]?.a.pane;
        if (pane) run("pane.focus", { pane });
      }
      return cx.notify();
    }
    const from = this.pressed;
    const task = from && this.store.task(from);
    this.pressed = null;
    this.over = null;
    if (!task) return cx.notify();
    if (task.status !== status) {
      cx.spawn(async () => this.store.update((d) => { const t = d.tasks.find((y) => y.id === from); if (!t) return false; setStatus(t, status); }));
    } else {
      setShared("tasker.selected", from);
      run("layout.show", { id: "tasker-detail" });
    }
    cx.notify();
  },

  card(t, x) {
    const task = x.t;
    const e = [...x.agents].sort((a, b) => (RANK[b.top] ?? 0) - (RANK[a.top] ?? 0))[0];
    const info = e ? this.info.get(e.a.address) : null;
    const blocked = e?.top === "blocked";
    const selected = shared("tasker.selected") === task.id;
    const lifted = this.pressed === task.id && this.over && this.over !== task.status;
    const meta = e ? [shortModel(info?.model), info?.effort, agentFor(e.top, this.sinceOf(e))].filter(Boolean).join(" · ") : null;
    const project = this.store.project(x.project);
    const due = task.status === "done" ? null : dueChip(t, task.due);
    return v_flex().id(`card-${task.id}`).p(9).gap(6).flex_none().rounded(9).bg(t.background)
      .border_1().border_color(blocked ? t.blocked : selected ? t.accent : t.border)
      .when(lifted, (el) => el.opacity(0.45))
      .when(!lifted && isLater(task), (el) => el.opacity(0.6))
      .cursor_pointer().hover((s) => s.border_color(t.input))
      .on_mouse_down("left", (_e, cx) => { this.pressed = task.id; this.over = task.status; cx.notify(); })
      .on_mouse_down("right", (_e, cx) => {
        cx.stop_propagation();
        setShared("tasker.selected", task.id);
        openDialog("menu", { task: task.id });
      })
      .child(h_flex().gap(7).items_start()
        .child(div().pt(1).child(taskMark(t, task, e?.top)))
        .child(div().flex_1().min_w(0).text_size(12.8).text_color(task.status === "done" ? t.dim : t.foreground).child(task.title)))
      .when(Boolean(task.next_step) && task.status !== "done", (el) => el.child(div().truncate().text_size(11).text_color(t.dim).child(`→ ${task.next_step}`)))
      .when(blocked && Boolean(e?.report?.msg), (el) => el.child(div().text_size(11).text_color(t.blocked).child(e.report.msg.replace(/^answer:\s*/i, ""))))
      .when(!blocked && Boolean(meta), (el) => el.child(div().truncate().text_size(11).text_color(t.muted).child(meta)))
      .child(h_flex().gap(5).items_center().flex_wrap()
        .child(prioChip(t, task.priority))
        .when(Boolean(due), (el) => el.child(due))
        .when(isLater(task), (el) => el.child(chip(t, S.laterUntil(laterLabel(task.snooze)), t.dim)))
        .when(Boolean(task.issue), (el) => el.child(chip(t, issueLabel(task.issue), t.dim)))
        .when(Boolean(task.branch), (el) => el.child(h_flex().gap(3).items_center().text_size(10).text_color(t.dim).child(icon("git-branch", 11)).child(task.branch.replace(/^task\//, ""))))
        .child(div().flex_1())
        .when(Boolean(project) && !this.boardProject, (el) => el.child(div().size(7).rounded(2).bg(projectColor(project))))
        .when(Boolean(task.repo), (el) => el.child(div().text_size(10.5).text_color(t.dim).child(base(task.repo)))));
  },

  // Agents in no task, as cards to drag onto a column.
  looseCard(t, u) {
    const e = u.agents[0];
    const info = e ? this.info.get(e.a.address) : null;
    const meta = e ? [shortModel(info?.model), info?.effort, agentFor(u.top ?? e.status, this.sinceOf(e))].filter(Boolean).join(" · ") : "";
    const lifted = this.pressed === `tab:${u.tab}` && this.over && this.over !== "loose";
    return v_flex().id(`loose-${u.tab}`).p(9).gap(5).flex_none().rounded(9).bg(t.background)
      .border_1().border_color(u.top === "blocked" ? t.blocked : t.border).when(lifted, (el) => el.opacity(0.45))
      .cursor_pointer().hover((s) => s.border_color(t.input))
      .on_mouse_down("left", (_e, cx) => { this.pressed = `tab:${u.tab}`; this.over = "loose"; cx.notify(); })
      .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openDialog("loose", { tab: u.tab }); })
      .child(h_flex().gap(7).items_center()
        .child(h_flex().w(16).justify_center().child(agentMark(t, u.top ?? e?.status) ?? (programIcon(e?.a.program, 14, t.muted) ?? div())))
        .child(div().flex_1().min_w(0).truncate().text_size(12.5).child(untrackedName(u))))
      .when(Boolean(meta), (el) => el.child(div().truncate().text_size(11).text_color(t.muted).child(meta)))
      .child(div().text_size(10.5).text_color(t.dim).child(base(u.where.key ?? "")));
  },

  looseColumn(t, list) {
    const over = String(this.pressed ?? "").startsWith("tab:") && this.over === "loose";
    return v_flex().id("col-loose").flex_1().min_w(160).max_w(240).h_full().min_h(0).rounded(10)
      .bg(t.canvas).border_1().border_color(over ? t.accent : t.border)
      .on_mouse_move((_e, cx) => { if (this.pressed && this.over !== "loose") { this.over = "loose"; cx.notify(); } })
      .on_mouse_up("left", (_e, cx) => this.drop(cx, "loose"))
      .child(h_flex().px(12).h(38).flex_none().gap(7).items_center()
        .child(icon("bot", 14, t.dim))
        .child(div().font_semibold().text_size(12.5).text_color(t.muted).child(S.noTaskLane))
        .child(div().text_size(11.5).text_color(t.dim).child(String(list.length))))
      .child(div().px(12).pb(6).text_size(10.5).text_color(t.dim).child(S.noTaskLaneHint))
      .child(v_flex().id("col-list-loose").flex_1().min_h(0).px(8).pb(8).gap(7).overflow_y_scrollbar()
        .children(list.map((u) => this.looseCard(t, u))));
  },

  column(t, status, list, wip) {
    const over = this.pressed && this.over === status;
    const full = status === "doing" && list.length > wip;
    return v_flex().id(`col-${status}`).flex_1().min_w(170).max_w(320).h_full().min_h(0).rounded(10)
      .bg(over ? t.selected : t.chrome).border_1().border_color(over ? t.accent : t.border)
      .on_mouse_move((_e, cx) => { if (this.pressed && this.over !== status) { this.over = status; cx.notify(); } })
      .on_mouse_up("left", (_e, cx) => this.drop(cx, status))
      .child(h_flex().px(12).h(38).flex_none().gap(7).items_center()
        .child(statusIcon(t, status, 14))
        .child(div().font_semibold().text_size(12.5).child(S.statusLabel[status]))
        .child(div().text_size(11.5).text_color(full ? t.ansi3 : t.dim).child(status === "doing" ? `${list.length}/${wip}` : String(list.length)))
        .child(div().flex_1())
        .when(["inbox", "next"].includes(status), (el) => el.child(iconButton(t, `col-add-${status}`, "plus", S.newTask,
          () => openDialog("task", { status, project: this.boardProject })))))
      .child(v_flex().id(`col-list-${status}`).flex_1().min_h(0).px(8).pb(8).gap(7).overflow_y_scrollbar()
        .children(list.map((x) => this.card(t, x)))
        .when(!list.length, (el) => el.child(div().h(56).rounded(8).border_1().border_color(over ? t.accent : t.border).flex().items_center().justify_center()
          .text_size(11).text_color(t.dim).child(S.emptyColumn))));
  },

  renderBoard(cx) {
    const t = theme();
    const own = this.fixedProject ? this.store.project(this.fixedProject) : null;
    // The project went (deleted): its board shows every project.
    this.boardProject = own ? own.id : this.fixedProject && !this.store.loaded ? this.fixedProject : null;
    const cols = this.boardColumns(this.world);
    const wip = this.store.data.settings.wip;
    // Agents in no task (of the shown project, when one is picked).
    const loose = this.world.untracked.filter((u) => u.agents.length && (!this.boardProject || (u.project ?? this.world.projectOfRepo.get(u.where.key)) === this.boardProject));
    // A pill per board: this one lit, the others go to their tab (made when not open).
    const pill = (id, label, color) => {
      const here = this.boardProject === id;
      return h_flex().id(`bp-${id ?? "all"}`).px(9).h(24).gap(6).rounded(6).items_center().text_size(12)
        .bg(here ? t.selected : t.canvas).text_color(here ? t.foreground : t.muted)
        .when(!here, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).tooltip(id ? S.boardOf(label) : S.boardAll)
          .on_click(() => openBoard(id ? this.store.project(id) : null)))
        .when(Boolean(color), (el) => el.child(div().size(8).rounded(2).bg(color))).child(label);
    };
    return v_flex().id("tasker-board").size_full().min_h(0).bg(t.canvas).text_color(t.foreground)
      // Released outside any column: the drag is off.
      .on_mouse_up("left", (_e, cx) => { if (this.pressed) { this.pressed = null; this.over = null; cx.notify(); } })
      .child(h_flex().px(14).h(44).flex_none().gap(6).items_center()
        .child(div().pr(8).text_size(14).font_semibold().child(S.board))
        .child(pill(null, S.allProjects))
        .children(this.store.data.projects.map((p) => pill(p.id, p.name, projectColor(p))))
        .child(div().flex_1())
        .child(div().text_size(11).text_color(t.dim).child(S.boardHint)))
      .child(h_flex().id("board-cols").flex_1().min_h(0).px(14).pb(14).gap(10).items_start().overflow_x_scrollbar()
        .when(loose.length > 0, (el) => el.child(this.looseColumn(t, loose)))
        .children(COLUMNS.map((c) => this.column(t, c, cols[c], wip))));
  },
};
