// Caches shared by every copy of the mod.

// Shared by every copy of the mod (sidebar, detail, board): one look per agent, not three.
// Plain data on globalThis, so it also survives a hot reload; work in flight that a
// reload cancelled counts as done after a minute.
export function sharedCache(name) {
  const all = (globalThis.__tasker ??= {});
  return (all[name] ??= { info: {}, seen: {}, busy: {} });
}

const STUCK = 60000;
export const busy = (c, k, now = Date.now()) => c.busy[k] != null && now - c.busy[k] < STUCK;
