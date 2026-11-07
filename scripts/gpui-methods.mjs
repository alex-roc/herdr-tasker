// Writes test/stubs/gpui-methods.json: every element method gpui-kit declares,
// so the tests' fake elements refuse a mistyped one, as the real app would.
// Run after a Herdr update: node scripts/gpui-methods.mjs [path/to/gpui-kit.d.ts]
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";

const file = process.argv[2] ?? `${process.env.HERDR_APP_HOME ?? `${homedir()}/.config/herdr-app`}/gpui-kit.d.ts`;
const text = readFileSync(file, "utf8");
const names = new Set();
for (const m of text.matchAll(/^\s{4}([a-z_][a-z_0-9]*)\s*<Self extends [A-Za-z]+>\(this: Self/gm)) names.add(m[1]);
const out = new URL("../test/stubs/gpui-methods.json", import.meta.url);
writeFileSync(out, JSON.stringify([...names].sort(), null, 0) + "\n");
console.log(`${names.size} element methods → ${out.pathname}`);
