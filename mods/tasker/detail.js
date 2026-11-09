// The detail panel: one task, its agents, its changes and its history.

import { div } from "gpui-kit";
import { v_flex, h_flex, TextareaState, Textarea } from "gpui-base";
import { theme, run, shared, hc, home, window, focused } from "herdr";
import { S } from "./strings.js";
import { setStatus, kept } from "./lib/store.js";
import { diffStat } from "./lib/git.js";
import { send, pullRequest, openUrl } from "./lib/actions.js";
import { RANK, duration, shortModel, kilo, base, untilde, STATUSES, issueLabel, isLater, laterLabel } from "./lib/util.js";
import { STATUS_ICON, statusIcon, statusColor, prioColor, dueChip, agentMark, button, chip, programIcon, icon, onScreen, agentFor } from "./lib/ui.js";
import { openDialog } from "./lib/open.js";

const LOOK_EVERY = 15000; // screen and diff, while shown and the window is in front
const PR_EVERY = 60000; // gh goes to the network
const CLOCK_EVERY = 60000; // durations ("in Doing for 5m")

export const Detail = {
  initDetail(cx) {
    this.det = {}; // what was looked up for the shown task: { id, sig, at, screen, where, diff, pr, prAt }
    this.feedback = TextareaState.new({ placeholder: S.feedbackPlaceholder, rows: 3 });
    this.feedback.on("change", (_e, cx) => { this.feedbackText = this.feedback.value(); cx.notify(); });
    this.feedbackText = "";
    // Looks again without drawing: the panel redraws only when what it found changed
    // (every redraw of a mod redraws the whole window, terminals included).
    cx.timer.every(LOOK_EVERY, (cx) => {
      const x = this.world?.taskById.get(shared("tasker.selected"));
      if (x && window()?.active) { this.det.at = 0; this.lookUp(cx, x); }
    });
    cx.timer.every(CLOCK_EVERY, (cx) => { if (window()?.active && onScreen("tasker-detail")) cx.notify(); });
  },

  // Screen, diff and PR of the shown task: when it changes, then every few seconds,
  // and never while the panel is hidden or the window is in the background. The
  // agent's screen isn't read while its terminal has the focus: it's in view already.
  lookUp(cx, x) {
    const id = x.t.id;
    const e = this.leadOf(x);
    const sig = `${id}|${e?.a.address ?? ""}|${e?.top ?? ""}`;
    if (this.det.busy || !onScreen("tasker-detail")) return;
    if (this.det.sig === sig && (!window()?.active || Date.now() - (this.det.at ?? 0) < LOOK_EVERY)) return;
    if (this.det.id !== id) this.det = { id, prAt: 0 };
    this.det.sig = sig;
    this.det.at = Date.now();
    this.det.busy = true;
    const h = home();
    const where = x.t.worktree ? untilde(x.t.worktree, h) : e?.term?.cwd ?? (x.t.repo ? untilde(x.t.repo, h) : null);
    const shown = (d) => JSON.stringify([d.screen, d.where, d.diff, d.pr]);
    const before = shown(this.det);
    const inView = Boolean(e?.a.pane) && focused()?.pane === e.a.pane;
    cx.spawn(async (cx) => {
      try {
        const local = e && !e.a.address.includes("/");
        const [screen, diff] = await Promise.all([
          local && !inView ? hc(["read", e.a.address, "--lines", "8"]) : null,
          where ? diffStat(where, null) : null,
        ]);
        // The last lines with text, without hc's own notes.
        if (!inView) this.det.screen = screen?.code === 0 ? (screen.stdout ?? "").split("\n").filter((l) => l.trim() && !l.startsWith("[hc]")).slice(-8) : null;
        this.det.where = where;
        this.det.diff = diff;
        if (where && ["review", "doing", "done"].includes(x.t.status) && Date.now() - (this.det.prAt ?? 0) > PR_EVERY) {
          this.det.pr = await pullRequest(where);
          this.det.prAt = Date.now();
        }
      } catch {}
      this.det.busy = false;
      if (shown(this.det) !== before) cx.notify();
    });
  },

  leadOf(x) {
    return [...(x.agents ?? [])].sort((a, b) => (RANK[b.top] ?? 0) - (RANK[a.top] ?? 0))[0] ?? null;
  },

  upd(cx, id, fn) {
    cx.spawn(async () => this.store.update((d) => { const t = d.tasks.find((y) => y.id === id); if (!t) return false; fn(kept(t)); t.updated = Date.now(); }));
  },

  section(t, label, ...children) {
    return v_flex().gap(6).pt(16)
      .child(div().text_size(10.5).font_semibold().text_color(t.dim).child(label.toUpperCase()))
      .children(children.filter(Boolean));
  },

  agentCard(t, e) {
    const info = this.info.get(e.a.address);
    const since = this.sinceOf(e);
    const meta = [shortModel(info?.model), info?.effort, info?.ctx ? S.ctx(kilo(info.ctx) + (info.ctxMax ? `/${kilo(info.ctxMax)}` : "")) : null,
      e.term?.turn ? S.turn(e.term.turn) : null, agentFor(e.status, since)].filter(Boolean);
    const records = Object.values(e.term?.records ?? {}).filter((r) => r?.title);
    const question = e.top === "blocked" ? (e.report?.msg ?? "").replace(/^answer:\s*/i, "") : "";
    return v_flex().id(`ag-${e.a.address}`).p(8).gap(4).rounded(8).border_1().border_color(e.top === "blocked" ? t.blocked : t.border).bg(t.surface)
      .cursor_pointer().hover((s) => s.bg(t.hover)).on_click(() => run("pane.focus", { pane: e.a.pane }))
      .child(h_flex().gap(7).items_center()
        .child(programIcon(e.a.program, 14, t.foreground) ?? div())
        .child(div().flex_1().min_w(0).truncate().font_medium().child(e.term?.title || e.a.title || e.a.program?.name || e.a.address))
        .child(div().text_size(10.5).text_color(t.dim).child(e.a.address))
        .child(agentMark(t, e.top, false) ?? div()))
      .when(meta.length > 0, (el) => el.child(div().text_size(11).text_color(t.muted).child(meta.join(" · "))))
      .when(Boolean(question), (el) => el.child(div().text_size(11.5).text_color(t.blocked).child(question)))
      .children(records.slice(0, 5).map((r, i) => h_flex().pl(6).gap(6).items_center().text_size(11).text_color(t.muted)
        .child(div().text_color(t.dim).child(i === Math.min(records.length, 5) - 1 ? "└" : "├"))
        .child(agentMark(t, r.state) ?? div())
        .child(div().flex_1().truncate().child(String(r.title)))))
      .children(e.subs.slice(0, 5).map((k) => h_flex().pl(6 + (k.depth - 1) * 10).gap(6).items_center().text_size(11).text_color(t.muted)
        .child(div().text_color(t.dim).child("└"))
        .child(div().flex_1().truncate().child(k.term.name || k.term.title || k.term.address))));
  },

  renderDetail(cx) {
    const t = theme();
    const id = shared("tasker.selected");
    const x = id ? this.world?.taskById.get(id) : null;
    const shell = (body) => v_flex().id("tasker-detail").size_full().min_h(0).bg(t.chrome).text_size(12.5).text_color(t.foreground)
      .child(h_flex().px(14).h(40).flex_none().items_center().border_b(1).border_color(t.border)
        .child(div().flex_1().text_size(11.5).font_medium().text_color(t.dim).child(S.task))
        .when(Boolean(x), (el) => el.child(div().id("d-edit").px(6).text_color(t.dim).cursor_pointer().hover((s) => s.text_color(t.foreground)).tooltip(S.editTask)
          .on_click(() => openDialog("task", { task: x.t.id })).child(icon("pencil", 14))))
        .child(div().id("d-close").px(6).text_color(t.dim).cursor_pointer().hover((s) => s.text_color(t.foreground)).tooltip(S.close)
          .on_click(() => run("layout.hide", { id: "tasker-detail" })).child(icon("x", 14))))
      .child(v_flex().id("d-body").flex_1().min_h(0).px(14).pb(16).overflow_y_scrollbar().child(body));
    if (!x) return shell(div().pt(14).text_color(t.dim).child(S.noTaskSelected));
    this.lookUp(cx, x);
    const task = x.t;
    const e = this.leadOf(x);
    const now = Date.now();
    const lastChange = (task.history ?? []).at(-1)?.at ?? task.created;
    const det = this.det.id === task.id ? this.det : {};
    const due = dueChip(t, task.due);

    // Status as a compact row of icons with the current one named.
    const statusRow = h_flex().gap(3).flex_wrap().children(STATUSES.map((s) => {
      const on = task.status === s;
      return h_flex().id(`ds-${s}`).px(on ? 7 : 5).h(24).rounded(6).items_center().gap(5).cursor_pointer()
        .text_size(11.5).bg(on ? statusColor(t, s) + "2a" : t.chrome).text_color(on ? statusColor(t, s) : t.dim)
        .hover((el) => el.bg(t.hover)).tooltip(S.statusLabel[s])
        .on_click((_e, cx) => this.upd(cx, task.id, (y) => setStatus(y, s)))
        .child(icon(STATUS_ICON[s], 13)).when(on, (el) => el.child(S.statusLabel[s]));
    }));
    const prioRow = h_flex().gap(3).children([1, 2, 3].map((n) => div().id(`dp-${n}`).px(7).h(22).rounded(5).flex().items_center().cursor_pointer()
      .text_size(11).font_semibold().bg(task.priority === n ? prioColor(t, n) + "2a" : t.chrome).text_color(task.priority === n ? prioColor(t, n) : t.dim)
      .hover((el) => el.bg(t.hover)).tooltip(S.priorityHint[n]).on_click((_e, cx) => this.upd(cx, task.id, (y) => { y.priority = n; })).child(S.priorityLabel[n])));

    const last = task.sessions?.at(-1);
    const actions = h_flex().gap(6).flex_wrap()
      .when(!e && Boolean(last), (el) => el.child(button(t, "d-resume", S.resume, (_e, cx) => this.resume(cx, task),
        { primary: true, small: true, iconName: "rotate-ccw", tooltip: last ? S.resumeHint(last.app, duration(now - last.at)) : null })))
      .when(!e, (el) => el.child(button(t, "d-launch", S.start, (_e, cx) => this.launch(cx, task, false), { primary: !last, small: true, iconName: "play" }))
        .when(Boolean(task.repo) && !task.worktree, (el) => el.child(button(t, "d-launch-wt", S.startWorktree, (_e, cx) => this.launch(cx, task, true), { small: true, iconName: "git-fork", tooltip: S.startWorktreeHint }))))
      .when(Boolean(e), (el) => el.child(button(t, "d-focus", S.focusAgent, () => run("pane.focus", { pane: e.a.pane }), { primary: true, small: true, iconName: "arrow-right" })))
      // Later: put it off, or bring it back now.
      .when(isLater(task), (el) => el.child(button(t, "d-back", S.bringBack, (_e, cx) => this.upd(cx, task.id, (y) => { y.snooze = null; }), { small: true, iconName: "rotate-ccw" })))
      .when(!isLater(task) && !["done", "dropped"].includes(task.status), (el) => el.child(button(t, "d-later", `${S.later}…`, () => openDialog("later", { task: task.id }), { small: true, iconName: "moon", tooltip: S.laterHint })))
      .when(task.status === "review", (el) => el.child(button(t, "d-done", S.markDone, (_e, cx) => this.upd(cx, task.id, (y) => setStatus(y, "done")), { small: true, iconName: "circle-check" })))
      .when(Boolean(det.where), (el) => el.child(button(t, "d-changes", S.showChanges, () => { run("layout.select", { stack: "panel-body", child: "changes" }); run("layout.show", { id: "panel" }); }, { small: true, iconName: "git-pull-request" })));

    const pr = det.pr;
    const diff = det.diff;
    const review = (diff?.files || pr || task.branch) ? this.section(t, S.changes,
      h_flex().gap(8).flex_wrap().text_size(11.5)
        .when(Boolean(task.branch), (el) => el.child(div().text_color(t.muted).child(`⎇ ${task.branch}`)))
        .when(Boolean(diff?.files), (el) => el.child(div().text_color(t.muted).child(S.files(diff.files))).child(div().text_color(t.ansi2).child(`+${diff.add}`)).child(div().text_color(t.ansi1).child(`−${diff.del}`))),
      pr ? h_flex().gap(6).items_center().flex_wrap()
        .child(div().id("d-pr-link").cursor_pointer().on_click(() => openUrl(pr.url))
          .child(chip(t, `PR #${pr.number} ${String(pr.state ?? "").toLowerCase()}`, pr.state === "MERGED" ? t.ansi5 : pr.state === "OPEN" ? t.ansi2 : t.dim)))
        .when(pr.total > 0, (el) => el.child(chip(t, pr.failed.length ? S.checksFailedChip(pr.failed.length) : pr.pending ? S.checksRunning(pr.pending) : S.checksPassed, pr.failed.length ? t.blocked : pr.pending ? t.ansi3 : t.ansi2)))
        .when(Boolean(pr.review), (el) => el.child(chip(t, pr.review.toLowerCase().replace(/_/g, " "), t.dim))) : null,
      e ? h_flex().gap(6).flex_wrap()
        .when(!pr, (el) => el.child(button(t, "d-pr", S.askPR, (_e, cx) => cx.spawn(async () => send(e.a.address, S.prRequest)), { small: true, iconName: "git-pull-request" })))
        .when(Boolean(pr?.failed?.length), (el) => el.child(button(t, "d-checks", S.sendFailedChecks, (_e, cx) => cx.spawn(async () => send(e.a.address, S.checksFailed(pr.failed))), { small: true, danger: true, iconName: "circle-alert" }))) : null,
    ) : null;

    const sendIt = (cx) => {
      const text = this.feedbackText.trim();
      if (!text || this.sending) return;
      this.sending = true;
      cx.spawn(async (cx) => {
        this.sendError = await send(e.a.address, text);
        if (!this.sendError) { this.feedback.set_value(""); this.feedbackText = ""; }
        this.sending = false;
        cx.notify();
      });
    };
    const feedback = e ? this.section(t, S.feedbackTitle,
      Textarea.new(this.feedback).h(64).p(7).rounded(7).border_1().border_color(t.input).bg(t.background).text_size(12),
      h_flex().justify_end().child(button(t, "d-send", S.sendFeedback, (_e, cx) => sendIt(cx), { small: true, primary: Boolean(this.feedbackText.trim()), iconName: "send" })),
      this.sendError ? div().text_size(11).text_color(t.blocked).child(this.sendError) : null) : null;

    const worked = (task.agent_ms ?? 0) + (e?.status === "working" && this.sinceOf(e) ? now - this.sinceOf(e) : 0);
    const body = v_flex().pt(12)
      .child(h_flex().gap(8).items_start()
        .child(div().pt(2).child(statusIcon(t, task.status, 17)))
        .child(div().flex_1().min_w(0).text_size(15).font_semibold().child(task.title)))
      .child(h_flex().pt(6).gap(6).items_center().flex_wrap().text_size(11).text_color(t.dim)
        .when(Boolean(task.repo), (el) => el.child(div().child(base(task.repo))))
        .when(Boolean(due), (el) => el.child(due))
        .when(isLater(task), (el) => el.child(chip(t, S.laterUntil(laterLabel(task.snooze)), t.dim)))
        .when(Boolean(task.estimate), (el) => el.child(chip(t, S.estimateChip(task.estimate), t.dim)))
        .when(Boolean(task.issue?.url), (el) => el.child(div().id("d-issue").text_color(t.accent).cursor_pointer().hover((s) => s.opacity(0.8))
          .on_click(() => openUrl(task.issue.url)).child(issueLabel(task.issue)))))
      .child(v_flex().pt(10).gap(6).child(statusRow).child(prioRow))
      .child(div().pt(10).child(actions))
      .when(Boolean(task.next_step), (el) => el.child(this.section(t, S.nextStep, div().text_color(t.foreground).child(task.next_step))))
      .when(Boolean(task.notes), (el) => el.child(this.section(t, S.notes, div().text_color(t.muted).child(task.notes))))
      .when(x.agents.length > 0, (el) => el.child(this.section(t, S.agents, ...x.agents.map((a) => this.agentCard(t, a)))))
      .when(Boolean(det.screen?.length), (el) => el.child(this.section(t, S.screen, v_flex().p(8).rounded(7).bg(t.background).text_size(11).text_color(t.muted)
        .children(det.screen.map((l) => div().truncate().child(l))))))
      .when(Boolean(review), (el) => el.child(review))
      .when(Boolean(feedback), (el) => el.child(feedback))
      .child(this.section(t, S.time, v_flex().gap(3).text_size(11.5).text_color(t.muted)
        .child(div().child(S.inStateFor(S.statusLabel[task.status], duration(now - lastChange))))
        .when(worked > 0, (el) => el.child(div().child(S.agentWorked(duration(worked)))))
        .child(div().child(S.createdAgo(duration(now - (task.created ?? now)))))))
      .child(this.section(t, S.activity, ...[...(task.history ?? [])].reverse().slice(0, 12).map((hh) => h_flex().gap(8).text_size(11).text_color(t.muted)
        .child(statusIcon(t, hh.s, 12))
        .child(div().flex_1().child(S.statusLabel[hh.s] ?? hh.s))
        .child(div().text_color(t.dim).child(S.ago(duration(now - hh.at)))))));
    return shell(body);
  },
};
