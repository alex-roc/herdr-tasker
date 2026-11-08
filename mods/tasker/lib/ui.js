// Shared pieces of tasker's UI, drawn with the person's theme colors.

import { div, svg, image } from "gpui-kit";
import { layout } from "herdr";
import { h_flex } from "gpui-base";
import { S } from "../strings.js";
import { dueLabel, daysUntil, duration } from "./util.js";

export const SPINNER = "mods/workspace-chrome/spinner.svg";
export const CHEVRON = (open) => `mods/workspace-chrome/chevron-${open ? "down" : "right"}.svg`;

// Icons are Lucide (ISC), shipped in mods/tasker/icons: tinted with the text color.
export const ICON = (name) => `mods/tasker/icons/${name}.svg`;
export function icon(name, size = 14, color) {
  const el = svg(ICON(name)).size(size).flex_none();
  return color ? el.text_color(color) : el;
}

// Task status, one icon each.
export const STATUS_ICON = { inbox: "inbox", next: "circle-dot", doing: "circle-play", waiting: "circle-pause", review: "eye", done: "circle-check", dropped: "circle-x" };
export const statusIcon = (t, status, size = 14) => icon(STATUS_ICON[status] ?? "circle-dot", size, statusColor(t, status));

export function statusColor(t, status) {
  return {
    inbox: t.dim, next: t.muted, doing: t.working, waiting: t.ansi3, review: t.done, done: t.ansi2, dropped: t.dim,
  }[status] ?? t.dim;
}

export function prioColor(t, p) {
  return p === 1 ? t.ansi1 : p === 2 ? t.ansi3 : t.dim;
}

// An agent's state as Herdr's agents list draws it.
export function agentMark(t, status, compact = true) {
  if (status === "working") return svg(SPINNER).size(12).mx(1).flex_none().text_color(t.working).spin(900);
  if (status === "blocked") {
    return compact
      ? div().size(14).flex_none().rounded(4).bg(t.blocked + "26").text_size(10.5).font_bold().text_color(t.blocked).flex().items_center().justify_center().child("!")
      : div().flex_none().px(6).h(18).rounded(5).bg(t.blocked + "26").text_size(10.5).font_semibold().text_color(t.blocked).flex().items_center().child(S.needsYou);
  }
  if (status === "done") return div().size(7).mx(3).flex_none().rounded(4).bg(t.done);
  if (status === "idle") return div().size(7).mx(3).flex_none().rounded(4).border(1.5).border_color(t.idle ?? t.dim);
  return null;
}

// "working 12m", "finished 3m ago": how long an agent has been as it is.
export function agentFor(status, since, now = Date.now()) {
  if (!since) return null;
  const d = duration(now - since);
  return (S.agentFor[status] ?? S.agentFor.idle)(d);
}

export function taskMark(t, task, top) {
  const a = top ? agentMark(t, top) : null;
  return h_flex().w(16).flex_none().justify_center().child(a ?? statusIcon(t, task.status, 13));
}

export function chip(t, text, color, opts = {}) {
  return div().flex_none().px(5).h(16).rounded(4).flex().items_center()
    .bg((color ?? t.dim) + (opts.solid ? "" : "22")).text_size(10).font_semibold()
    .text_color(opts.solid ? t.background : color ?? t.dim).child(text);
}

export function prioChip(t, p) {
  return chip(t, S.priorityLabel[p] ?? "P2", prioColor(t, p));
}

export function dueChip(t, due) {
  const label = dueLabel(due);
  if (!label) return null;
  const n = daysUntil(due);
  return chip(t, label, n < 0 ? t.blocked : n <= 1 ? t.ansi3 : t.dim);
}

export function button(t, id, label, onClick, { primary = false, small = false, danger = false, iconName = null, tooltip = null, disabled = false } = {}) {
  const bg = primary ? t.solid : t.raised;
  const fg = primary ? t.solid_foreground : danger ? t.blocked : t.foreground;
  return h_flex().id(id).h(small ? 24 : 30).px(small ? 8 : 12).flex_none().items_center().justify_center().rounded(7)
    .border_1().border_color(primary ? t.solid : t.input).bg(bg).text_color(fg)
    .text_size(small ? 11.5 : 12.5).font_medium()
    .when(disabled, (el) => el.opacity(0.45))
    .when(!disabled, (el) => el.cursor_pointer().hover((s) => s.opacity(0.85)).on_click((e, cx) => { cx.stop_propagation(); onClick(e, cx); }))
    .when(Boolean(tooltip), (el) => el.tooltip(tooltip))
    .when(Boolean(iconName), (el) => el.gap(5).child(icon(iconName, small ? 12 : 14)))
    .child(label);
}

// `name`: a Lucide icon in mods/tasker/icons.
export function iconButton(t, id, name, tooltip, onClick) {
  return div().id(id).flex_none().px(4).h(22).rounded(5).flex().items_center()
    .text_color(t.dim).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
    .tooltip(tooltip)
    .on_click((e, cx) => { cx.stop_propagation(); onClick(e, cx); })
    .child(icon(name, 14));
}

export function sectionHeader(t, id, label, count, color, open, onToggle) {
  return h_flex().id(id).px(8).pt(10).h(30).flex_none().gap(6).items_center()
    .text_size(11).font_medium().cursor_pointer()
    .on_click((_e, cx) => onToggle(cx))
    .child(div().truncate().text_color(color ?? t.dim).child(label))
    .child(div().text_color(t.dim).child(String(count)))
    .child(div().flex_1())
    .child(svg(CHEVRON(open)).size(11).flex_none().text_color(t.dim));
}

// Whether a node of the shown layout is on screen (false when it or a parent is hidden,
// or the layout has no such node).
export function onScreen(id) {
  const walk = (n) => {
    if (!n || n.hidden) return false;
    if (n.id === id) return true;
    return shownChildren(n).some(walk);
  };
  return walk(layout());
}

// A stack shows one child: the active one, else its first.
export function shownChildren(n) {
  const kids = n?.children ?? [];
  if (n?.type !== "stack") return kids;
  return [kids.find((c) => c.id === n.active) ?? kids[0]].filter(Boolean);
}

// The views of the tasker lists on screen, in layout order: [null] for the one with
// Now/Projects tabs, ["now", "projects"] for the two side by side.
export function shownLists() {
  const out = [];
  const walk = (n) => {
    if (!n || n.hidden) return;
    const c = n.content;
    if (c?.mod === "tasker" && (c.props?.role ?? "sidebar") === "sidebar" && !c.props?.dialog) out.push(c.props?.view ?? null);
    shownChildren(n).forEach(walk);
  };
  walk(layout());
  return out;
}

export function programIcon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}
