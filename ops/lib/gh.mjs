// GitHub access for background jobs.
//
// Nothing here exits the process. This module is imported by the Vercel cron
// route, where a hard exit would kill the function instead of returning the
// named error the route is written to produce.

const API = "https://api.github.com";

function token() {
  const t = process.env.GH_DISPATCH_TOKEN;
  if (!t) {
    throw new Error("GH_DISPATCH_TOKEN is not set. Nothing can be verified without it, so this run stops rather than reporting an empty board as good news.");
  }
  return t;
}

const headers = () => ({
  Authorization: `Bearer ${token()}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
});

export async function gh(path) {
  const res = await fetch(path.startsWith("http") ? path : API + path, { headers: headers() });
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status} ${await res.text()}`);
  return res.json();
}

export async function ghAll(path, maxPages = 5) {
  let url = path.startsWith("http") ? path : API + path;
  const out = [];
  for (let i = 0; i < maxPages && url; i++) {
    const res = await fetch(url, { headers: headers() });
    if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
    out.push(...(await res.json()));
    const link = res.headers.get("link") || "";
    const next = link.split(",").find((s) => s.includes('rel="next"'));
    url = next ? next.slice(next.indexOf("<") + 1, next.indexOf(">")) : null;
  }
  return out;
}

/** Repositories to report on. A function, not a constant, so the check happens
 *  when it is called rather than when the module is imported. */
export function repos() {
  const list = (process.env.REPOS || process.env.OPS_REPO || "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  if (list.length === 0) {
    throw new Error("Set REPOS (or OPS_REPO) to a comma-separated list such as 'ihelp/ev-edge,ihelp/eldercare'.");
  }
  return list;
}

export const hoursSince = (iso) => (Date.now() - new Date(iso).getTime()) / 36e5;
export const fmtAge = (h) => (h < 1 ? `${Math.round(h * 60)}m` : h < 48 ? `${Math.round(h)}h` : `${Math.round(h / 24)}d`);
