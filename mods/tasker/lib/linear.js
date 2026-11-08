// Linear: the open issues assigned to you, to import as tasks. Uses your personal
// API key, from $LINEAR_API_KEY or the file data/tasker/linear-key (never tasks.json).
// Reads only; nothing is changed in Linear.

import { exec, readTextFile, appHome } from "herdr";

const API = "https://api.linear.app/graphql";
export const KEY_FILE = () => `${appHome()}/data/tasker/linear-key`;

const QUERY = `query TaskerAssigned {
  viewer { assignedIssues(first: 50, orderBy: updatedAt, filter: { state: { type: { nin: ["completed", "canceled"] } } }) {
    nodes { identifier title url description priority dueDate state { name } team { key } labels { nodes { name } } }
  } }
}`;

export async function linearKey() {
  try {
    const r = await exec("sh", ["-c", 'printf %s "$LINEAR_API_KEY"']);
    if (r.code === 0 && r.stdout.trim()) return r.stdout.trim();
  } catch {}
  try {
    const k = (await readTextFile(KEY_FILE()))?.trim();
    if (k) return k;
  } catch {}
  return null;
}

// Linear's priority (0 none, 1 urgent, 2 high, 3 medium, 4 low) → P1–P3.
export const priorityOf = (p) => (p === 1 || p === 2 ? 1 : p === 3 ? 2 : p === 4 ? 3 : 2);

// Issues as the import dialog lists them.
export async function linearIssues(key) {
  const r = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: key },
    body: JSON.stringify({ query: QUERY }),
  });
  let d = null;
  try { d = await r.json(); } catch {}
  if (!r.ok || d?.errors?.length) {
    const why = d?.errors?.[0]?.message ?? `HTTP ${r.status}`;
    throw new Error(r.status === 401 || /auth/i.test(why) ? `Linear refused the key (${why}).` : `Linear: ${why}`);
  }
  return (d?.data?.viewer?.assignedIssues?.nodes ?? []).map((i) => ({
    source: "linear",
    number: i.identifier,
    title: i.title,
    url: i.url,
    body: i.description ?? "",
    priority: priorityOf(i.priority),
    due: /^\d{4}-\d{2}-\d{2}$/.test(i.dueDate ?? "") ? i.dueDate : null,
    labels: [i.state?.name, ...(i.labels?.nodes ?? []).map((l) => l.name)].filter(Boolean).map((name) => ({ name })),
  }));
}
