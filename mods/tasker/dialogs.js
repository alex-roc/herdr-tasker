// tasker's dialogs and popups: each is this mod opened as an overlay with
// props { dialog, ... } (see lib/open.js). They write tasks.json themselves;
// every other copy sees the change through its file watch.

import { div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, TextareaState, Textarea } from "gpui-base";
import { props, closeOverlay, theme, home, spaces, panes, shared, setShared, run, notify, knownAgents, terminals, layout, pickFolder } from "herdr";
import { untrackedName } from "./lib/world.js";
import { S } from "./strings.js";
import { newTask, newProject, setStatus, kept } from "./lib/store.js";
import { STATUSES, tilde, untilde, base, byUrgency, OPEN, parseDue, dueLabel, issueLabel, isLater, laterLabel, parseLater } from "./lib/util.js";
import { linearKey, linearIssues } from "./lib/linear.js";
import { place, repoState } from "./lib/git.js";
import { STATUS_ICON, button, chip, statusIcon, statusColor, prioColor, prioChip, icon } from "./lib/ui.js";
import { openDialog } from "./lib/open.js";
import * as act from "./lib/actions.js";

const COLORS = { ansi4: "#5b8def", ansi6: "#22a99a", ansi2: "#3fae6a", ansi3: "#e3814f", ansi5: "#8b7cf6", ansi1: "#d9649a" };
export const projectColor = (p) => COLORS[p?.color] ?? COLORS.ansi4;

const close = () => closeOverlay(props().overlay);

function field(t, label, el, hint) {
  return v_flex().gap(5)
    .child(h_flex().gap(8).items_baseline().child(div().text_size(11).text_color(t.dim).child(label))
      .when(Boolean(hint), (h) => h.child(div().flex_1().min_w(0).truncate().text_size(10.5).text_color(hint?.color ?? t.dim).child(hint?.text ?? ""))))
    .child(el);
}

function input(t, state, focused, bad = false) {
  return Input.new(state).h(32).px(9).rounded(8).border_1().border_color(bad ? t.blocked : focused ? t.accent : t.input)
    .bg(t.background).text_size(12.8).text_color(t.foreground);
}

// options: [value, label, color?, Lucide icon?]
function segmented(t, id, options, value, onPick) {
  return h_flex().gap(4).flex_wrap().children(options.map(([v, label, color, iconName]) =>
    div().id(`${id}-${v}`).h(24).px(8).gap(5).rounded(6).flex().items_center().text_size(11.5).cursor_pointer()
      .border_1().border_color(v === value ? (color ?? t.accent) : t.input)
      .bg(v === value ? (color ?? t.accent) + "26" : t.background)
      .text_color(v === value ? (color ?? t.foreground) : t.muted)
      .hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => { onPick(v); cx.notify(); })
      .when(Boolean(iconName), (el) => el.child(icon(iconName, 12)))
      .child(label)));
}

// Folders tasks can live in: the projects' repos and the repos open now (looked at side by side).
async function repoChoices(store) {
  const h = home();
  const out = new Map();
  for (const p of store.data.projects) for (const r of p.repos ?? []) out.set(tilde(untilde(r, h), h), p.id);
  const ps = panes();
  const folders = [...new Set(spaces().filter((s) => !s.machine).map((s) => place(s, ps)).filter(Boolean))];
  const states = await Promise.all(folders.map((f) => repoState(f, null).catch(() => null)));
  // Only folders in git: a home folder or a download folder isn't a repository.
  folders.forEach((f, i) => {
    if (!states[i]) return;
    const k = tilde(states[i].main, h);
    if (!out.has(k)) out.set(k, null);
  });
  return [...out.keys()];
}

export const Dialogs = {
  // Runs `work`, then closes. Never the other way round: closing drops this copy of
  // the mod, and with it whatever it had spawned and not finished.
  closeAfter(cx, work) {
    if (this.saving) return;
    this.saving = true;
    cx.spawn(async () => { try { await work(); } finally { close(); } });
  },

  initDialog(cx) {
    const p = props() ?? {};
    this.handle = cx.focus_handle();
    const init = {
      task: () => this.initTaskForm(cx, p),
      project: () => this.initProjectForm(cx, p),
      jump: () => this.initJump(cx),
      issues: () => this.initIssues(cx, p),
      repo: () => this.initRepoMenu(cx),
      "project-menu": () => this.initRepoMenu(cx),
      later: () => this.initLater(cx, p),
      settings: () => this.initSettings(cx),
    }[p.dialog];
    if (init) init(); else this.handle.focus();
  },

  renderDialog(cx) {
    const t = theme();
    const p = props() ?? {};
    const body = {
      task: () => this.taskForm(t, cx),
      project: () => this.projectForm(t, cx),
      menu: () => this.menu(t, p),
      repo: () => this.repoMenu(t, p),
      "project-menu": () => this.projectMenu(t, p),
      later: () => this.laterForm(t, cx),
      jump: () => this.jump(t, cx),
      issues: () => this.issuesList(t, cx),
      archive: () => this.archiveConfirm(t, p),
      loose: () => this.looseMenu(t, p, cx),
      "confirm-delete": () => this.deleteConfirm(t, p),
      "confirm-close": () => this.closeConfirm(t, p, cx),
      settings: () => this.settingsForm(t, cx),
    }[p.dialog]?.() ?? div();
    return v_flex().id("tasker-dialog").track_focus(this.handle)
      .on_key_down((e, cx) => { if (e.key === "escape") { close(); cx.stop_propagation(); } })
      .size_full().min_h(0).bg(t.popover).text_color(t.foreground).text_size(12.8).child(body);
  },

  title(t, text) {
    return h_flex().items_center().gap(8).pb(12).child(div().flex_1().min_w(0).truncate().text_size(15).font_semibold().child(text))
      .child(div().text_size(11).text_color(t.dim).child("Esc"));
  },

  // ── Task form ──────────────────────────────────────────────────────────
  initTaskForm(cx, p) {
    const existing = p.task ? this.store.task(p.task) : null;
    this.form = existing ? { ...existing } : {
      title: "", project: p.project ?? null, repo: p.repo ?? null, status: p.status ?? "next", priority: 2,
      due: null, estimate: null, next_step: "", notes: "",
    };
    this.isNew = !existing;
    this.saving = false;
    const mk = (key, placeholder) => {
      const st = InputState.new({ value: this.form[key] ?? "", placeholder });
      st.on("change", (_e, cx) => { this.form[key] = st.value(); cx.notify(); });
      st.on("submit", (_e, cx) => this.saveTask(cx));
      st.on("focus", (_e, cx) => { this.focusedField = key; cx.notify(); });
      return st;
    };
    this.inputs = { title: mk("title", S.titlePlaceholder), next_step: mk("next_step", S.nextStepPlaceholder), due: mk("due", S.duePlaceholder), estimate: mk("estimate", S.estimatePlaceholder) };
    this.notes = TextareaState.new({ value: this.form.notes ?? "", rows: 7 });
    this.notes.on("change", () => { this.form.notes = this.notes.value(); });
    this.inputs.title.focus();
    this.focusedField = "title";
    this.repoList = [];
    cx.spawn(async (cx) => {
      await this.store.load();
      // A task opened before the file was read: fill the form now.
      if (p.task && this.isNew && this.store.task(p.task)) { this.initTaskForm(cx, p); return; }
      this.repoList = await repoChoices(this.store);
      cx.notify();
    });
  },

  saveTask(cx) {
    const f = this.form;
    const due = parseDue(f.due);
    if (!String(f.title ?? "").trim() || due === undefined || this.saving) return;
    this.saving = true;
    const id = props().task;
    cx.spawn(async () => {
      let ok = false;
      try {
        ok = await this.store.update((d) => {
          const fields = { title: f.title.trim(), project: f.project, repo: f.repo, priority: f.priority, due, estimate: (f.estimate ?? "").trim() || null, next_step: (f.next_step ?? "").trim(), notes: f.notes ?? "" };
          if (!id) { const t = newTask(d, { ...fields, status: f.status }); setShared("tasker.selected", t.id); return; }
          const t = d.tasks.find((x) => x.id === id);
          if (!t) return false;
          Object.assign(kept(t), fields, { updated: Date.now() });
          setStatus(t, f.status);
        });
      } finally {
        this.saving = false;
      }
      if (ok) close();
      else if (this.store.error) notify({ title: S.appName, body: this.store.error, level: "error" });
    });
  },

  taskForm(t, cx) {
    const f = this.form;
    const h = home();
    const projects = this.store.data.projects;
    const inProject = f.project ? (projects.find((p) => p.id === f.project)?.repos ?? []).map((r) => tilde(untilde(r, h), h)) : [];
    const repos = [...new Set([...inProject, ...(f.project ? [] : this.repoList), ...(f.repo ? [f.repo] : [])])];
    const due = parseDue(f.due);
    const dueHint = due === undefined ? { text: S.dueBad, color: t.blocked } : due ? { text: `${dueLabel(due)} · ${due}` } : null;
    const canSave = Boolean(String(f.title ?? "").trim()) && due !== undefined;
    return this.withFooter(t, v_flex().gap(12)
      .child(this.title(t, this.isNew ? S.newTaskTitle : S.editTask))
      .child(field(t, S.title, input(t, this.inputs.title, this.focusedField === "title")))
      .child(field(t, S.project, segmented(t, "proj", [[null, S.none], ...projects.map((p) => [p.id, p.name, projectColor(p)])], f.project, (v) => { f.project = v; })))
      .child(field(t, S.repo, segmented(t, "repo", [[null, S.none], ...repos.map((r) => [r, base(r)])], f.repo, (v) => { f.repo = v; })))
      .child(field(t, S.status, segmented(t, "st", STATUSES.map((s) => [s, S.statusLabel[s], statusColor(t, s), STATUS_ICON[s]]), f.status, (v) => { f.status = v; })))
      .child(field(t, S.priority, segmented(t, "pr", [1, 2, 3].map((n) => [n, `${S.priorityLabel[n]} ${S.priorityHint[n]}`, prioColor(t, n)]), f.priority, (v) => { f.priority = v; })))
      .child(h_flex().gap(12)
        .child(div().flex_1().min_w(0).child(field(t, S.due, input(t, this.inputs.due, this.focusedField === "due", due === undefined), dueHint)))
        .child(div().w(110).child(field(t, S.estimate, input(t, this.inputs.estimate, this.focusedField === "estimate")))))
      .child(field(t, S.nextStep, input(t, this.inputs.next_step, this.focusedField === "next_step")))
      .child(field(t, S.notes, Textarea.new(this.notes).h(140).p(8).rounded(8).border_1().border_color(t.input).bg(t.background).text_size(12.5), { text: S.notesHint })),
    [button(t, "cancel", S.cancel, close), button(t, "save", S.save, (_e, cx) => this.saveTask(cx), { primary: true, disabled: !canSave || this.saving })]);
  },

  // A form that scrolls, with its buttons always in view.
  withFooter(t, body, buttons, left = []) {
    return v_flex().size_full().min_h(0)
      .child(v_flex().id("dlg-body").flex_1().min_h(0).px(18).pt(18).pb(8).overflow_y_scrollbar().child(body))
      .child(h_flex().flex_none().px(18).py(12).gap(8).border_t(1).border_color(t.border).children(left).child(div().flex_1()).children(buttons));
  },

  // ── Project form ───────────────────────────────────────────────────────
  initProjectForm(cx, p) {
    const existing = p.project ? this.store.project(p.project) : null;
    this.form = existing ? { ...existing, repos: [...(existing.repos ?? [])] } : { name: "", color: "ansi4", repos: p.repo ? [p.repo] : [] };
    this.isNew = !existing;
    this.saving = false;
    this.nameInput = InputState.new({ value: this.form.name, placeholder: S.namePlaceholder });
    this.nameInput.on("change", (_e, cx) => { this.form.name = this.nameInput.value(); cx.notify(); });
    this.nameInput.on("submit", (_e, cx) => this.saveProject(cx));
    this.nameInput.focus();
    this.repoList = null;
    cx.spawn(async (cx) => {
      await this.store.load();
      if (p.project && this.isNew && this.store.project(p.project)) { this.initProjectForm(cx, p); return; }
      this.repoList = await repoChoices(this.store);
      cx.notify();
    });
  },

  saveProject(cx) {
    const f = this.form;
    if (!String(f.name ?? "").trim() || this.saving) return;
    this.saving = true;
    const id = props().project;
    cx.spawn(async () => {
      let ok = false;
      try {
        ok = await this.store.update((d) => {
          // A repo belongs to one project.
          for (const p of d.projects) if (p.id !== id) p.repos = (p.repos ?? []).filter((r) => !f.repos.includes(r));
          if (!id) { newProject(d, { name: f.name.trim(), color: f.color, repos: f.repos }); return; }
          const p = d.projects.find((x) => x.id === id);
          if (!p) return false;
          Object.assign(p, { name: f.name.trim(), color: f.color, repos: f.repos });
        });
      } finally {
        this.saving = false;
      }
      if (ok) close();
    });
  },

  // A folder from the system's picker: its repository (the main checkout, as a worktree
  // belongs to its repo), else the folder itself. Added ticked.
  addFolder(cx) {
    cx.spawn(async (cx) => {
      let folder = null;
      try { folder = await pickFolder({ prompt: S.addFolderPrompt }); } catch {}
      if (!folder) return;
      const h = home();
      const st = await repoState(folder, null).catch(() => null);
      const key = tilde(st?.main ?? folder, h);
      const f = this.form;
      if (!f.repos.includes(key)) f.repos = [...f.repos, key];
      cx.notify();
    });
  },

  projectForm(t, cx) {
    const f = this.form;
    const all = [...new Set([...f.repos, ...(this.repoList ?? [])])];
    const owner = new Map();
    for (const p of this.store.data.projects) for (const r of p.repos ?? []) owner.set(r, p);
    return this.withFooter(t, v_flex().gap(12)
      .child(this.title(t, this.isNew ? S.newProject : S.editProject))
      .child(field(t, S.name, Input.new(this.nameInput).h(32).px(9).rounded(8).border_1().border_color(t.accent).bg(t.background).text_size(12.8)))
      .child(field(t, S.color, h_flex().gap(6).children(Object.entries(COLORS).map(([k, c]) =>
        div().id(`c-${k}`).size(20).rounded(10).bg(c).cursor_pointer().border_2().border_color(f.color === k ? t.foreground : c)
          .on_click((_e, cx) => { f.color = k; cx.notify(); })))))
      .child(field(t, S.repos, v_flex().gap(2).max_h(220).overflow_y_scrollbar().children(
        this.repoList == null && !all.length ? [div().text_color(t.dim).child(S.loading)]
          : !all.length ? [div().text_color(t.dim).child(S.reposHint)]
          : all.map((r) => {
            const on = f.repos.includes(r);
            const other = owner.get(r);
            return h_flex().id(`r-${r}`).h(26).px(6).gap(8).rounded(6).items_center().cursor_pointer().hover((s) => s.bg(t.hover))
              .on_click((_e, cx) => { f.repos = on ? f.repos.filter((x) => x !== r) : [...f.repos, r]; cx.notify(); })
              .child(icon(on ? "circle-check" : "circle", 14, on ? t.accent : t.dim))
              .child(div().flex_1().truncate().child(r))
              .when(Boolean(other) && other.id !== props().project, (el) => el.child(div().text_size(10.5).text_color(t.dim).child(S.inProject(other.name))));
          })).child(h_flex().pt(4).child(button(t, "add-folder", `${S.addFolder}…`, (_e, cx) => this.addFolder(cx), { small: true, iconName: "folder-plus" }))), { text: S.reposHint })),
    [button(t, "cancel", S.cancel, close), button(t, "save", S.save, (_e, cx) => this.saveProject(cx), { primary: true, disabled: !String(f.name ?? "").trim() })],
    this.isNew ? [] : [button(t, "del", S.remove, (_e, cx) => {
      const id = props().project;
      cx.spawn(async () => { await this.store.update((d) => { d.projects = d.projects.filter((p) => p.id !== id); for (const x of d.tasks) if (x.project === id) x.project = null; }); close(); });
    }, { danger: true, iconName: "trash-2" })]);
  },

  // ── Context menu of a task ─────────────────────────────────────────────
  menu(t, p) {
    const task = this.store.task(p.task);
    if (!task) return div().p(10).text_color(t.dim).child(S.loading);
    const upd = (fn) => (_e, cx) => this.closeAfter(cx, () => this.store.update((d) => { const x = d.tasks.find((y) => y.id === task.id); if (!x) return false; fn(kept(x)); x.updated = Date.now(); }));
    const item = (id, iconName, label, onClick, hint, color) => h_flex().id(id).h(28).px(8).gap(8).rounded(6).items_center().cursor_pointer()
      .text_color(color ?? t.foreground).hover((s) => s.bg(t.hover)).on_click(onClick)
      .child(icon(iconName, 13, color ?? t.muted)).child(div().flex_1().child(label))
      .when(Boolean(hint), (el) => el.child(div().text_size(11).text_color(t.dim).child(hint)));
    const sep = () => div().h(1).my(4).bg(t.border);
    return v_flex().p(5).text_size(12.5)
      .child(item("details", "panel-right", S.showDetails, () => { close(); run("layout.show", { id: "tasker-detail" }); }, "i"))
      .child(item("edit", "pencil", `${S.editTask}…`, () => { close(); openDialog("task", { task: task.id }); }, "e"))
      .child(item("launch", "play", S.start, (_e, cx) => this.closeAfter(cx, () => this.startAgent(task, false)), "l"))
      .when(Boolean(task.sessions?.length), (el) => el.child(item("resume", "rotate-ccw", S.resume, (_e, cx) => this.closeAfter(cx, () => this.resumeAgent(task)), "r")))
      .when(Boolean(task.repo), (el) => el.child(item("launch-wt", "git-fork", S.startWorktree, (_e, cx) => this.closeAfter(cx, () => this.startAgent(task, true)), "w")))
      .child(sep())
      .child(h_flex().px(8).py(4).gap(4).flex_wrap().children(STATUSES.map((s) => div().id(`s-${s}`).px(6).h(22).rounded(5).flex().items_center().cursor_pointer()
        .bg(task.status === s ? statusColor(t, s) + "26" : t.popover).text_color(statusColor(t, s)).hover((x) => x.bg(t.hover))
        .tooltip(S.statusLabel[s]).on_click(upd((x) => setStatus(x, s))).child(statusIcon(t, s, 13)))))
      .child(h_flex().px(8).py(4).gap(4).children([1, 2, 3].map((n) => div().id(`p-${n}`).px(8).h(22).rounded(5).flex().items_center().cursor_pointer()
        .bg(task.priority === n ? prioColor(t, n) + "26" : t.popover).text_color(prioColor(t, n)).hover((x) => x.bg(t.hover))
        .tooltip(S.priorityHint[n]).on_click(upd((x) => { x.priority = n; })).child(S.priorityLabel[n]))))
      .child(sep())
      // Later: put it off until a day (it comes back by itself), or someday.
      .child(h_flex().px(8).py(4).gap(4).flex_wrap().items_center()
        .child(h_flex().id("later-l").gap(5).pr(2).items_center().text_size(11.5).text_color(t.muted).tooltip(S.laterHint).child(icon("moon", 13)).child(S.later))
        .children([["tomorrow", S.laterTomorrow], ["mon", S.laterNextWeek], ["someday", S.laterSomeday]].map(([word, label]) => {
          const v = parseLater(word);
          return div().id(`later-${word}`).px(7).h(22).rounded(5).flex().items_center().cursor_pointer().text_size(11.5)
            .bg(task.snooze === v ? t.selected : t.popover).hover((x) => x.bg(t.hover)).on_click(upd((x) => { x.snooze = v; })).child(label);
        }))
        .child(div().id("later-pick").px(7).h(22).rounded(5).flex().items_center().cursor_pointer().text_size(11.5).text_color(t.muted)
          .hover((x) => x.bg(t.hover)).on_click(() => { close(); openDialog("later", { task: task.id }); }).child(S.laterPick)))
      .when(isLater(task), (el) => el.child(item("bring-back", "rotate-ccw", `${S.bringBack} (${laterLabel(task.snooze)})`, upd((x) => { x.snooze = null; }))))
      .child(sep())
      .child(item("archive", "circle-check", `${S.archive}…`, () => { close(); openDialog("archive", { task: task.id }); }))
      .child(item("delete", "trash-2", `${S.remove}…`, () => { close(); openDialog("confirm-delete", { task: task.id }); }, null, t.blocked));
  },

  // ── Menu of a repository: terminals and agents outside tasks, tasks, project ──
  initRepoMenu(cx) {
    this.handle.focus();
    this.agentList = [];
    cx.spawn(async (cx) => {
      try { this.agentList = (await knownAgents()).filter((a) => a.installed && a.run?.length && a.agent); } catch {}
      cx.notify();
    });
  },

  repoMenu(t, p) {
    if (!p.repo) return div();
    const h = home();
    const item = (id, iconName, label, onClick) => h_flex().id(id).h(28).px(8).gap(8).rounded(6).items_center().cursor_pointer()
      .hover((s) => s.bg(t.hover)).on_click(onClick).child(icon(iconName, 13, t.muted)).child(div().flex_1().truncate().child(label));
    const sep = () => div().h(1).my(4).bg(t.border);
    const owner = this.store.data.projects.find((x) => (x.repos ?? []).some((r) => tilde(untilde(r, h), h) === p.repo));
    const assign = (pid) => (_e, cx) => {
      this.closeAfter(cx, () => this.store.update((d) => {
        for (const x of d.projects) x.repos = (x.repos ?? []).filter((r) => tilde(untilde(r, h), h) !== p.repo);
        const x = pid && d.projects.find((y) => y.id === pid);
        if (x) x.repos.push(p.repo);
      }));
    };
    return v_flex().p(5).text_size(12.5)
      .child(div().px(8).pt(4).pb(6).text_size(11).text_color(t.dim).truncate().child(p.repo))
      .child(item("r-term", "square-terminal", S.newTerminal, () => { close(); act.openHere(p.repo); }))
      .when(this.spacesOf([p.repo]).length > 0, (el) => el.child(item("r-close", "circle-x", `${S.closeRepo}…`, () => { close(); openDialog("confirm-close", { repos: [p.repo], name: base(p.repo) }); })))
      .children(this.agentList.map((a) => item(`r-ag-${a.key}`, "bot", S.newAgent(a.name), () => { close(); act.openHere(p.repo, a.run); })))
      .child(sep())
      .child(item("r-task", "plus", `${S.newTaskTitle}…`, () => { close(); openDialog("task", { repo: p.repo, project: p.project ?? owner?.id ?? null }); }))
      .child(item("r-issues", "circle-dot", `${S.importIssues}…`, () => { close(); openDialog("issues", { repo: p.repo, project: owner?.id ?? null }); }))
      .child(item("r-linear", "list-plus", `${S.importLinear}…`, () => { close(); openDialog("issues", { source: "linear", repo: p.repo, project: owner?.id ?? null }); }))
      .child(sep())
      .child(div().px(8).pt(2).pb(4).text_size(11).text_color(t.dim).child(S.moveToProject))
      .child(h_flex().px(8).pb(4).gap(4).flex_wrap()
        .child(div().id("r-p-none").px(7).h(22).rounded(5).flex().items_center().cursor_pointer().text_size(11.5)
          .bg(!owner ? t.selected : t.popover).hover((x) => x.bg(t.hover)).on_click(assign(null)).child(S.noProjectShort))
        .children(this.store.data.projects.map((x) => div().id(`r-p-${x.id}`).px(7).h(22).rounded(5).flex().items_center().gap(5).cursor_pointer().text_size(11.5)
          .bg(owner?.id === x.id ? t.selected : t.popover).hover((y) => y.bg(t.hover)).on_click(assign(x.id))
          .child(div().size(7).rounded(2).bg(projectColor(x))).child(x.name))));
  },

  // ── Menu of a project: a terminal or an agent across its repos, a task, the form ──
  projectMenu(t, p) {
    const proj = this.store.project(p.project);
    if (!proj) return div().p(10).text_color(t.dim).child(S.loading);
    const item = (id, iconName, label, onClick) => h_flex().id(id).h(28).px(8).gap(8).rounded(6).items_center().cursor_pointer()
      .hover((s) => s.bg(t.hover)).on_click(onClick).child(icon(iconName, 13, t.muted)).child(div().flex_1().truncate().child(label));
    const sep = () => div().h(1).my(4).bg(t.border);
    const has = (proj.repos ?? []).length > 0;
    const at = act.projectPlace(proj, home());
    // Plan (its board, a task), work (a terminal or an agent across its repositories), manage.
    return v_flex().p(5).text_size(12.5)
      .child(h_flex().px(8).pt(4).pb(6).gap(6).items_center()
        .child(div().size(8).rounded(2).flex_none().bg(projectColor(proj)))
        .child(div().flex_1().min_w(0).truncate().font_semibold().child(proj.name))
        .child(div().flex_none().text_size(11).text_color(t.dim).child(has ? S.reposCount(proj.repos.length) : S.noRepos)))
      .child(item("p-board", "square-kanban", S.projectBoard, () => { close(); act.openBoard(proj); }))
      .child(item("p-task", "plus", `${S.newTaskTitle}…`, () => { close(); openDialog("task", { project: proj.id }); }))
      .child(sep())
      .child(div().px(8).pb(2).text_size(11).text_color(t.dim).truncate().child(has ? S.workIn(tilde(at.folder, home())) : S.workInHome))
      .child(item("p-term", "square-terminal", S.projectTerminal, () => { close(); act.openInProject(proj); }))
      .children(this.agentList.map((a) => item(`p-ag-${a.key}`, "bot", S.newAgent(a.name), () => { close(); act.openInProject(proj, a.run); })))
      .child(sep())
      .child(item("p-edit", "pencil", `${S.editProjectItem}…`, () => { close(); openDialog("project", { project: proj.id }); }))
      .when(this.spacesOf(proj.repos ?? [], proj.id).length > 0, (el) => el.child(item("p-close", "circle-x", `${S.closeProject}…`, () => { close(); openDialog("confirm-close", { repos: proj.repos, name: proj.name, project: proj.id }); })));
  },

  // ── Menu of a tab in no task ───────────────────────────────────────────
  looseMenu(t, p, cx) {
    this.look(cx);
    const u = this.world.untracked.find((x) => x.tab === p.tab);
    if (!u) return div().p(10).text_color(t.dim).child(S.loading);
    const pane = u.agents[0]?.a.pane ?? u.panes[0]?.pane;
    const item = (id, iconName, label, onClick) => h_flex().id(id).h(28).px(8).gap(8).rounded(6).items_center().cursor_pointer()
      .hover((s) => s.bg(t.hover)).on_click(onClick).child(icon(iconName, 13, t.muted)).child(div().flex_1().truncate().child(label));
    return v_flex().p(5).text_size(12.5)
      .child(div().px(8).pt(4).pb(6).text_size(11).text_color(t.dim).truncate().child(untrackedName(u)))
      .child(item("l-make", "plus", S.makeTask, (_e, cx) => this.closeAfter(cx, async () => {
        const id = await act.adopt(this.store, u);
        if (id) setShared("tasker.selected", id);
      })))
      .child(item("l-add", "list-plus", S.addToTask, () => { close(); openDialog("jump", { attach: u.tab }); }))
      .when(Boolean(pane), (el) => el.child(item("l-go", "arrow-right", S.focusAgent, () => { close(); run("pane.focus", { pane }); })));
  },

  // ── Later: a day typed as for a due date, or "someday" ──────────────────
  initLater(cx, p) {
    this.saving = false;
    this.laterText = "";
    this.laterInput = InputState.new({ placeholder: S.laterPlaceholder });
    this.laterInput.on("change", (_e, cx) => { this.laterText = this.laterInput.value(); cx.notify(); });
    this.laterInput.on("submit", (_e, cx) => this.saveLater(cx));
    this.laterInput.focus();
    cx.spawn(async (cx) => { if (!this.store.loaded) await this.store.load(); cx.notify(); });
  },

  saveLater(cx) {
    const v = parseLater(this.laterText);
    const id = props().task;
    if (!v || !id) return;
    this.closeAfter(cx, () => this.store.update((d) => { const x = d.tasks.find((y) => y.id === id); if (!x) return false; kept(x).snooze = v; x.updated = Date.now(); }));
  },

  laterForm(t, cx) {
    const task = this.store.task(props().task);
    const v = parseLater(this.laterText);
    const hint = !this.laterText.trim() ? null : v ? { text: S.laterUntil(laterLabel(v)) + (v === "someday" ? "" : ` · ${v}`) }
      : { text: v === null ? S.laterPast : S.laterBad, color: t.blocked };
    return v_flex().p(18).gap(10).size_full()
      .child(this.title(t, S.laterTitle(task?.title ?? "")))
      .child(field(t, S.later, input(t, this.laterInput, true, this.laterText.trim() && !v), hint))
      .child(div().flex_1())
      .child(h_flex().gap(8).justify_end().child(button(t, "cancel", S.cancel, close))
        .child(button(t, "later-save", S.laterSave, (_e, cx) => this.saveLater(cx), { primary: true, iconName: "moon", disabled: !v })));
  },

  // ── Archive and delete ─────────────────────────────────────────────────
  confirmBox(t, title, body, buttons) {
    return v_flex().p(18).gap(10).size_full()
      .child(this.title(t, title))
      .child(div().text_color(t.muted).child(body))
      .child(div().flex_1())
      .child(h_flex().gap(8).justify_end().child(button(t, "cancel", S.cancel, close)).children(buttons));
  },

  archiveConfirm(t, p) {
    const task = this.store.task(p.task);
    if (!task) return div();
    const go = (removeWorktree) => (_e, cx) => {
      if (this.saving) return;
      this.saving = true;
      cx.spawn(async () => {
        const warning = await act.archive(this.store, task, { removeWorktree });
        close();
        if (warning) notify({ title: S.archive, body: warning, level: "warning" });
      });
    };
    return this.confirmBox(t, S.archiveTitle(task.title),
      task.worktree ? S.archiveBodyWorktree(task.worktree, task.branch) : S.archiveBody, [
        ...(task.worktree ? [button(t, "arch-wt", S.archiveAndRemove, go(true), { danger: true })] : []),
        button(t, "arch", S.archive, go(false), { primary: true }),
      ]);
  },

  // The spaces open in these repositories (a worktree's space counts as its repo's), and
  // with `project`, the project's own spaces (where its tabs above the repositories are).
  spacesOf(repos, project = null) {
    this.look(null);
    const h = home();
    const keys = new Set(repos.map((r) => tilde(untilde(r, h), h)));
    const own = new Set(project ? this.world.untracked.filter((u) => u.project === project).map((u) => u.where.s.id) : []);
    const proj = project ? this.store.project(project) : null;
    const at = proj ? act.projectPlace(proj, h) : null;
    const mine = (s) => own.has(s.s.id) || (at && s.s.name === proj.name && s.folder === at.folder);
    return this.world.spaces.filter((s) => !s.on && ((s.key && keys.has(s.key)) || mine(s)));
  },

  closeConfirm(t, p, cx) {
    this.look(cx);
    const list = this.spacesOf(p.repos ?? [], p.project ?? null);
    const tabs = new Set(list.flatMap((s) => (s.s.tabs ?? []).map((x) => x.id)));
    const agents = [...this.world.byTab.entries()].filter(([tab]) => tabs.has(tab)).reduce((n, [, es]) => n + es.length, 0);
    const go = () => { for (const s of list) run("space.close", { id: s.s.id, confirmed: true }); close(); };
    return this.confirmBox(t, S.closeTitle(p.name ?? ""), S.closeBody(list.length, agents),
      [button(t, "close-it", S.closeIt, go, { danger: true, iconName: "circle-x", disabled: !list.length })]);
  },

  deleteConfirm(t, p) {
    const task = this.store.task(p.task);
    if (!task) return div();
    const del = (_e, cx) => this.closeAfter(cx, async () => {
      await this.store.update((d) => { const x = d.tasks.find((y) => y.id === task.id); if (!x) return false; x.deleted = true; x.updated = Date.now(); });
      if (shared("tasker.selected") === task.id) setShared("tasker.selected", null);
    });
    return this.confirmBox(t, S.deleteTitle(task.title), S.deleteBody, [button(t, "del", S.remove, del, { danger: true, iconName: "trash-2" })]);
  },

  // ── Settings ───────────────────────────────────────────────────────────
  initSettings(cx) {
    this.handle.focus();
    this.agentList = null;
    cx.spawn(async (cx) => {
      try { this.agentList = (await knownAgents()).filter((a) => a.run?.length && a.agent); } catch { this.agentList = []; }
      cx.notify();
    });
  },

  settingsForm(t, cx) {
    const s = this.store.data.settings;
    const set = (patch) => (_e, cx) => cx.spawn(async (cx) => { await this.store.update((d) => { Object.assign(d.settings, patch); }); cx.notify(); });
    const stepper = (id, value, min, max, label, key) => h_flex().gap(6).items_center()
      .child(div().id(`${id}-minus`).size(24).rounded(6).border_1().border_color(t.input).flex().items_center().justify_center().cursor_pointer()
        .hover((x) => x.bg(t.hover)).when(value > min, (el) => el.on_click(set({ [key]: value - 1 }))).child("−"))
      .child(div().min_w(64).text_size(12.5).flex().justify_center().child(label))
      .child(div().id(`${id}-plus`).size(24).rounded(6).border_1().border_color(t.input).flex().items_center().justify_center().cursor_pointer()
        .hover((x) => x.bg(t.hover)).when(value < max, (el) => el.on_click(set({ [key]: value + 1 }))).child("+"));
    // Installed agents, and the chosen one even when it isn't.
    const agents = (this.agentList ?? []).filter((a) => a.installed || a.key === s.agent);
    const known = agents.some((a) => a.key === s.agent);
    // The layout's stack of lists (tasker's own layout has one; a custom layout may not).
    const find = (n) => (n?.id === "tasker-lists" ? n : (n?.children ?? []).map(find).find(Boolean));
    const lists = find(layout());
    const setting = (label, hint, el) => v_flex().gap(6)
      .child(div().text_size(12).font_medium().child(label)).child(el)
      .child(div().text_size(11).text_color(t.dim).child(hint));
    return this.withFooter(t, v_flex().gap(14)
      .child(this.title(t, S.settingsTitle))
      .child(setting(S.track, S.trackHint, h_flex().gap(4).children([[true, S.on], [false, S.off]].map(([v, label]) =>
        h_flex().id(`track-${v}`).h(26).px(10).rounded(6).items_center().text_size(11.5).cursor_pointer()
          .border_1().border_color(s.track === v ? t.accent : t.input).bg(s.track === v ? t.accent + "26" : t.background)
          .hover((x) => x.bg(t.hover)).on_click(set({ track: v })).child(label)))))
      .when(Boolean(lists), (el) => el.child(setting(S.listsLayout, S.listsLayoutHint, h_flex().gap(4).children([["tasker-sidebar", S.listsTabs], ["tasker-split", S.listsStacked]].map(([child, label]) => {
        const on = (lists.active ?? lists.children?.[0]?.id) === child;
        return h_flex().id(`lists-${child}`).h(26).px(10).rounded(6).items_center().text_size(11.5).cursor_pointer()
          .border_1().border_color(on ? t.accent : t.input).bg(on ? t.accent + "26" : t.background)
          .hover((x) => x.bg(t.hover)).on_click(() => run("layout.select", { stack: "tasker-lists", child })).child(label);
      })))))
      .child(setting(S.wipLimit, S.wipLimitHint, stepper("wip", s.wip, 1, 20, String(s.wip), "wip")))
      .child(setting(S.staleDays, S.staleDaysHint, stepper("stale", s.stale_days, 1, 60, S.days(s.stale_days), "stale_days")))
      .child(setting(S.revive, S.reviveHint, h_flex().gap(4).children([[true, S.on], [false, S.off]].map(([v, label]) =>
        h_flex().id(`rev-${v}`).h(26).px(10).rounded(6).items_center().text_size(11.5).cursor_pointer()
          .border_1().border_color(s.revive === v ? t.accent : t.input).bg(s.revive === v ? t.accent + "26" : t.background)
          .hover((x) => x.bg(t.hover)).on_click(set({ revive: v })).child(label)))))
      .child(setting(S.reminders, S.remindersHint, h_flex().gap(4).children([[true, S.on], [false, S.off]].map(([v, label]) =>
        h_flex().id(`rem-${v}`).h(26).px(10).rounded(6).items_center().text_size(11.5).cursor_pointer()
          .border_1().border_color(s.reminders === v ? t.accent : t.input).bg(s.reminders === v ? t.accent + "26" : t.background)
          .hover((x) => x.bg(t.hover)).on_click(set({ reminders: v })).child(label)))))
      .child(setting(S.showUsage, S.showUsageHint, h_flex().gap(4).children([[true, S.on], [false, S.off]].map(([v, label]) =>
        h_flex().id(`usage-${v}`).h(26).px(10).rounded(6).items_center().text_size(11.5).cursor_pointer()
          .border_1().border_color(s.usage === v ? t.accent : t.input).bg(s.usage === v ? t.accent + "26" : t.background)
          .hover((x) => x.bg(t.hover)).on_click(set({ usage: v })).child(label)))))
      .child(setting(S.defaultAgent, S.defaultAgentHint, this.agentList == null ? div().text_color(t.dim).child(S.loading)
        : h_flex().gap(4).flex_wrap().children([...agents, ...(known ? [] : [{ key: s.agent, name: s.agent, installed: false }])].map((a) => {
          const on = a.key === s.agent;
          return h_flex().id(`ag-${a.key}`).h(26).px(9).gap(6).rounded(6).items_center().text_size(11.5).cursor_pointer()
            .border_1().border_color(on ? t.accent : t.input).bg(on ? t.accent + "26" : t.background)
            .text_color(a.installed ? t.foreground : t.dim).hover((x) => x.bg(t.hover))
            .on_click(set({ agent: a.key }))
            .child(a.name).when(!a.installed, (el) => el.child(div().text_size(10).text_color(t.dim).child(S.notInstalled)));
        })))), [button(t, "close", S.close, close, { primary: true })]);
  },

  // ── Jump palette ───────────────────────────────────────────────────────
  initJump(cx) {
    this.query = "";
    this.at = 0;
    this.q = InputState.new({ placeholder: S.searchTasks.replace(" (/)", "") });
    this.q.on("change", (_e, cx) => { this.query = this.q.value(); this.at = 0; cx.notify(); });
    this.q.on("submit", (_e, cx) => this.pickJump(undefined, cx));
    this.q.focus();
  },

  jumpList() {
    const words = this.query.toLowerCase().split(/\s+/).filter(Boolean);
    const projects = new Map(this.store.data.projects.map((p) => [p.id, p.name]));
    const attach = Boolean(props()?.attach);
    return this.store.data.tasks.filter((x) => !x.deleted && !x.archived && (!attach || OPEN.has(x.status)))
      .filter((x) => words.every((w) => `${x.title} ${x.repo ?? ""} ${x.next_step ?? ""} ${projects.get(x.project) ?? ""} ${issueLabel(x.issue)}`.toLowerCase().includes(w)))
      .sort((a, b) => (OPEN.has(a.status) ? 0 : 1) - (OPEN.has(b.status) ? 0 : 1) || byUrgency(a, b)).slice(0, 12);
  },

  pickJump(id, cx) {
    const list = this.jumpList();
    const task = id ? list.find((x) => x.id === id) : list[this.at];
    if (!task) return;
    // As a click in the list: select it and bring its agent to the front. Opened to put
    // a loose tab in a task: tie it first.
    const tab = props()?.attach;
    setShared("tasker.selected", task.id);
    if (tab && cx) { this.closeAfter(cx, () => act.link(this.store, task.id, tab, terminals())); return; }
    this.look(null);
    const pane = this.paneOf(this.world.taskById.get(task.id));
    if (pane) run("pane.focus", { pane });
    close();
  },

  jump(t, cx) {
    const list = this.jumpList();
    return v_flex().p(10).gap(6).size_full().min_h(0)
      .on_key_down((e, cx) => {
        if (e.key === "down") { this.at = Math.min(this.at + 1, list.length - 1); cx.notify(); cx.stop_propagation(); }
        if (e.key === "up") { this.at = Math.max(this.at - 1, 0); cx.notify(); cx.stop_propagation(); }
      })
      .when(Boolean(props()?.attach), (el) => el.child(div().px(2).pb(2).text_size(12).text_color(t.muted).child(S.addToTaskTitle)))
      .child(Input.new(this.q).h(34).px(10).rounded(8).border_1().border_color(t.accent).bg(t.background).text_size(13))
      .child(v_flex().flex_1().min_h(0).overflow_y_scrollbar().children(list.map((x, i) =>
        h_flex().id(`j-${x.id}`).h(30).px(8).gap(8).rounded(6).items_center().cursor_pointer()
          .bg(i === this.at ? t.selected : t.popover).hover((s) => s.bg(t.hover))
          .on_click((_e, cx) => this.pickJump(x.id, cx))
          .child(statusIcon(t, x.status, 13))
          .child(div().flex_1().truncate().child(x.title))
          .when(Boolean(x.repo), (el) => el.child(div().text_size(11).text_color(t.dim).child(base(x.repo))))
          .child(prioChip(t, x.priority))))
        .when(!list.length, (el) => el.child(div().p(8).text_color(t.dim).child(this.query ? S.noMatch(this.query) : S.noTasks))));
  },

  // ── Import issues: GitHub (gh) or Linear ───────────────────────────────
  initIssues(cx, p) {
    this.issues = null;
    this.issuesError = null;
    this.picked = new Set();
    this.handle.focus();
    cx.spawn(async (cx) => {
      try {
        if (p.source === "linear") {
          const key = await linearKey();
          if (!key) this.issuesError = S.linearNoKey;
          else this.issues = await linearIssues(key);
        } else {
          this.issues = (await act.issues(untilde(p.repo, home()))).map((i) => ({ ...i, source: "github" }));
        }
      } catch (e) { this.issuesError = String(e?.message ?? e); }
      cx.notify();
    });
  },

  issuesList(t, cx) {
    const p = props();
    const linear = p.source === "linear";
    const known = new Set(this.store.data.tasks.map((x) => x.issue?.url).filter(Boolean));
    const list = (this.issues ?? []).filter((i) => !known.has(i.url));
    return v_flex().p(18).gap(10).size_full().min_h(0)
      .child(this.title(t, linear ? S.linearTitle(p.repo ? base(p.repo) : null) : S.issuesTitle(base(p.repo ?? ""))))
      .when(linear && !this.issuesError, (el) => el.child(div().text_size(11.5).text_color(t.dim).child(S.linearHint)))
      .child(v_flex().flex_1().min_h(0).overflow_y_scrollbar().gap(2).children(
        this.issuesError ? [div().text_color(this.issuesError === S.linearNoKey ? t.muted : t.blocked).child(this.issuesError)]
          : !this.issues ? [div().text_color(t.dim).child(S.loading)]
          : !list.length ? [div().text_color(t.dim).child(S.noIssues)]
          : list.map((i) => {
            const on = this.picked.has(i.url);
            return h_flex().id(`i-${i.number}`).min_h(28).px(6).gap(8).rounded(6).items_center().cursor_pointer().hover((s) => s.bg(t.hover))
              .on_click((_e, cx) => { on ? this.picked.delete(i.url) : this.picked.add(i.url); cx.notify(); })
              .child(icon(on ? "circle-check" : "circle", 14, on ? t.accent : t.dim))
              .child(div().w(linear ? 64 : 40).flex_none().truncate().text_color(t.dim).child(issueLabel(i)))
              .child(div().flex_1().truncate().child(String(i.title ?? "")))
              .when(Boolean(i.due), (el) => el.child(chip(t, i.due.slice(5), t.dim)))
              .children((i.labels ?? []).slice(0, 2).map((l) => chip(t, String(l.name ?? ""), t.dim)));
          })))
      .child(h_flex().gap(8).justify_end()
        .child(button(t, "cancel", S.cancel, close))
        .child(button(t, "import", S.importN(this.picked.size), (_e, cx) => {
          const chosen = list.filter((i) => this.picked.has(i.url));
          if (!chosen.length || this.saving) return;
          this.saving = true;
          cx.spawn(async () => {
            await this.store.update((d) => {
              for (const i of chosen) {
                newTask(d, { title: i.title, repo: p.repo ?? null, project: p.project ?? null, status: "inbox",
                  priority: i.priority ?? 2, due: i.due ?? null,
                  issue: { source: i.source, number: i.number, url: i.url, body: (i.body ?? "").slice(0, 4000) } });
              }
            });
            close();
          });
        }, { primary: true, disabled: !this.picked.size })));
  },
};
