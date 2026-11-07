// A stand-in for gpui-kit in Node: elements record what they were told, and
// refuse what the real app refuses (a null child, a child used twice, a method
// gpui-kit doesn't have). Tests walk the tree and fire its handlers.

import { readFileSync } from "node:fs";

const METHODS = new Set(JSON.parse(readFileSync(new URL("./gpui-methods.json", import.meta.url), "utf8")));

let seq = 0;

export function isElement(x) {
  return Boolean(x && typeof x === "function" && x.__node);
}

function checkChild(c, where) {
  if (c === null || c === undefined) throw new Error(`${where}(value) expects an element, a string, or an entity (got ${c})`);
  if (isElement(c)) {
    if (c.__node.consumed) throw new Error(`${where}: element ${c.__node.kind}#${c.__node.id ?? c.__node.n} used twice`);
    c.__node.consumed = true;
  } else if (!["string", "number", "boolean"].includes(typeof c)) {
    throw new Error(`${where}(value) expects an element or a string (got ${typeof c})`);
  }
}

export function element(kind) {
  const node = { kind, n: ++seq, id: null, children: [], handlers: {}, calls: [], consumed: false };
  const proxy = new Proxy(function () {}, {
    get(_target, prop) {
      if (prop === "__node") return node;
      if (typeof prop === "symbol" || prop === "then") return undefined;
      if (prop === "child") return (c) => { checkChild(c, "child"); if (c !== false) node.children.push(c); return proxy; };
      if (prop === "children") {
        return (list) => {
          if (list == null || typeof list[Symbol.iterator] !== "function") throw new Error("children(list) expects an iterable");
          for (const c of list) { checkChild(c, "children"); if (c !== false) node.children.push(c); }
          return proxy;
        };
      }
      if (prop === "when") {
        return (cond, fn) => {
          if (!cond) return proxy;
          const out = fn(proxy);
          if (!isElement(out)) throw new Error(".when(cond, fn): fn must return the element");
          return out;
        };
      }
      if (prop === "map") return (fn) => fn(proxy);
      if (prop === "hover") {
        return (fn) => { fn(element("style")); return proxy; };
      }
      if (prop === "id") return (id) => { if (typeof id !== "string") throw new Error(`id() expects a string, got ${typeof id}`); node.id = id; return proxy; };
      if (!METHODS.has(prop)) throw new Error(`.${prop}() is not a gpui-kit element method`);
      if (prop.startsWith("on_")) {
        return (...args) => {
          const fn = args.at(-1);
          if (typeof fn !== "function") throw new Error(`.${prop}() expects a handler`);
          node.handlers[prop + (args.length > 1 ? `:${args[0]}` : "")] = fn;
          return proxy;
        };
      }
      return (...args) => { node.calls.push([prop, args]); return proxy; };
    },
  });
  return proxy;
}

export const div = () => element("div");
export const svg = (path) => { const e = element("svg"); e.__node.src = path; return e; };
export const image = (path) => { const e = element("image"); e.__node.src = path; return e; };

export class View {}

// Every element in a tree, depth first.
export function walk(root, out = []) {
  if (!isElement(root)) return out;
  out.push(root.__node);
  for (const c of root.__node.children) walk(c, out);
  return out;
}

// The text of a tree, joined.
export function text(root) {
  if (!isElement(root)) return typeof root === "string" || typeof root === "number" ? String(root) : "";
  return root.__node.children.map(text).join(" ");
}
