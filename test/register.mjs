// node --import ./test/register.mjs: the mod's imports of "herdr", "gpui-kit" and
// "gpui-base" resolve to the fakes in test/stubs, and mods get a localStorage.
import { register } from "node:module";

const store = new Map();
globalThis.__storage = store;
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
  clear: () => store.clear(),
};

register(new URL("./loader.mjs", import.meta.url));
