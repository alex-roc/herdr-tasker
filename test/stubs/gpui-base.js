// gpui-base controls, faked: flex helpers and input states that keep a value.

import { element } from "./gpui-kit.js";

export const h_flex = () => element("h_flex");
export const v_flex = () => element("v_flex");

class FieldState {
  static new(opts = {}) { return new this(opts); }
  constructor(opts) { this.opts = opts; this.v = opts.value ?? ""; this.listeners = {}; this.focused = false; }
  on(ev, fn) { (this.listeners[ev] ??= []).push(fn); return this; }
  value() { return this.v; }
  set_value(v) { this.v = v; }
  focus() { this.focused = true; }
  // Test helpers: type and press enter as the person would.
  type(v, cx) { this.v = v; for (const fn of this.listeners.change ?? []) fn({}, cx); }
  submit(cx) { for (const fn of this.listeners.submit ?? []) fn({}, cx); }
}

export class InputState extends FieldState {}
export class TextareaState extends FieldState {}

export const Input = { new: (state) => { if (!(state instanceof FieldState)) throw new Error("Input.new expects an InputState"); return element("input"); } };
export const Textarea = { new: (state) => { if (!(state instanceof FieldState)) throw new Error("Textarea.new expects a TextareaState"); return element("textarea"); } };
