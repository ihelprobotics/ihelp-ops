// The build boards' shared store: Upstash Redis, over its REST API. One
// database, one key prefix per board (app/lib/plan-boards.ts).
//
// A board is a plan, not work. Its tasks are a breakdown somebody wrote
// before any of it was started — what to do, what it depends on, which
// decision gates it — and a plan is edited by hand, by several people at once.
// That is a different thing from a task on the Ops board, which is a GitHub
// issue whose status nobody types. So it lives in its own store, and the line
// between the two is one field: `issue`.
//
//   No `issue`   A planning row. Status is typed, because nothing has
//                happened that could prove it.
//   `issue` set  Started in Ops. The row points at owner/name#n, and its status
//                and assignee are derived from GitHub like every other task
//                here. The store refuses a typed status or assignee for it, and
//                nobody can type the link — only app/lib/plan-start.ts writes
//                it, after the issue exists.
//
// Why Redis and not the Postgres behind lib/db.ts: the MITRA board was already
// live on this store, with the team's edits in it, before it moved into Ops.
// Moving it would have meant a migration of data people are actively changing,
// for no gain in what the board can do; later boards share it so there is one
// store, not two. No npm dependency — this is fetch.
//
// Layout, for <b> the board's key (mitra, sentinel):
//   <b>:rev            integer, bumped on every write (clients poll it)
//   <b>:seeded         set once when the board is first loaded from the page
//   <b>:tids           sorted set: task id -> display order
//   <b>:t:<id>         hash: task fields
//   <b>:dids           sorted set: decision id -> display order
//   <b>:d:<id>         hash: decision fields
//
// The standalone copies of the boards (mitra-build-board.vercel.app,
// sentinel-build-board.vercel.app) read and write the same keys.
//
// Each edit writes only the fields that changed, so two people editing
// different fields of one task never overwrite each other.

type Kind = "t" | "d";

// The board key is checked against PLAN_BOARDS by every route before it gets
// here, so it is never caller-chosen text in a Redis key.
function keys(board: string) {
  const P = board + ":";
  return { P, REV: P + "rev", KINDS: { t: P + "tids", d: P + "dids" } as Record<Kind, string> };
}

export const ID_RE = /^[A-Za-z0-9_$-]{1,24}$/;
const FIELD_RE = /^[a-z]{1,16}$/;
const MAX_VAL = 8000;

/** owner/name#number — the only shape `issue` holds once a task is started. */
export const ISSUE_RE = /^([A-Za-z0-9._-]+\/[A-Za-z0-9._-]+)#(\d+)$/;

/** A start that died mid-flight frees its claim after this long. */
const CLAIM_STALE_MS = 2 * 60 * 1000;

// Returns 0 when patching an item that no longer exists, -1 when creating an id
// that is already taken, otherwise the new revision. Drops `issue` always, and
// `status` and `assignee` once the task is linked: both come from GitHub now.
const PATCH_LUA = `
local exists = redis.call('ZSCORE', KEYS[1], ARGV[1])
if ARGV[2] == '1' then
  if exists then return -1 end
  redis.call('ZADD', KEYS[1], ARGV[3], ARGV[1])
elseif not exists then
  return 0
end
local linked = redis.call('HGET', KEYS[2], 'issue')
linked = linked and linked ~= ''
local out = {}
for i = 4, #ARGV, 2 do
  local k = ARGV[i]
  if k ~= 'issue' and not ((k == 'status' or k == 'assignee') and linked) then
    out[#out + 1] = k
    out[#out + 1] = ARGV[i + 1]
  end
end
if #out > 0 then redis.call('HSET', KEYS[2], unpack(out)) end
return redis.call('INCR', KEYS[3])`;

// -2 when the task is linked to an issue: deleting the row would leave a live
// issue that nothing on the board points at.
const DEL_LUA = `
local linked = redis.call('HGET', KEYS[2], 'issue')
if linked and linked ~= '' then return -2 end
local n = redis.call('ZREM', KEYS[1], ARGV[1])
redis.call('DEL', KEYS[2])
if n == 0 then return 0 end
return redis.call('INCR', KEYS[3])`;

// 'ok' when this caller now holds the claim; 'gone' when the task does not
// exist; otherwise the value already there (a link, or somebody else's claim).
const CLAIM_LUA = `
if not redis.call('ZSCORE', KEYS[2], ARGV[1]) then return 'gone' end
local cur = redis.call('HGET', KEYS[1], 'issue')
if cur and cur ~= '' then
  local ts = string.match(cur, '^pending:(%d+)$')
  if not ts or (tonumber(ARGV[2]) - tonumber(ts)) < tonumber(ARGV[3]) then return cur end
end
redis.call('HSET', KEYS[1], 'issue', 'pending:' .. ARGV[2])
redis.call('INCR', KEYS[3])
return 'ok'`;

// Replaces the claim with the link, or clears it after a failure. Only if the
// claim is still ours — a claim that went stale and was taken over is not.
const SETTLE_LUA = `
if redis.call('HGET', KEYS[1], 'issue') ~= ARGV[1] then return 0 end
if ARGV[2] == '' then redis.call('HDEL', KEYS[1], 'issue')
else redis.call('HSET', KEYS[1], 'issue', ARGV[2]) end
return redis.call('INCR', KEYS[2])`;

function config() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    throw new Error(
      "KV_REST_API_URL and KV_REST_API_TOKEN are not set, so the build boards' store cannot be reached. Connect the mitra-board-kv Upstash database to this Vercel project (Storage tab), or copy both values from the mitra-build-board project."
    );
  }
  return { url, token };
}

async function pipeline(cmds: (string | number)[][]): Promise<any[]> {
  const { url, token } = config();
  let r: Response;
  try {
    r = await fetch(url + "/pipeline", {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify(cmds),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch (e: any) {
    throw new Error(`The build boards' store (Upstash) did not answer: ${e?.message ?? e}. Check the database in the Vercel Storage tab.`);
  }
  if (!r.ok) {
    throw new Error(
      `The build boards' store answered ${r.status}.` +
        (r.status === 401 ? " KV_REST_API_TOKEN is wrong or was rotated." : " Check the Upstash database in the Vercel Storage tab.")
    );
  }
  const out = await r.json();
  return out.map((x: any) => {
    if (x.error) throw new Error(`The build boards' store refused a command: ${x.error}`);
    return x.result;
  });
}

const toObj = (flat: string[]) => {
  const o: Record<string, string> = {};
  for (let i = 0; i < flat.length; i += 2) o[flat[i]] = flat[i + 1];
  return o;
};

async function readKind(board: string, kind: Kind) {
  const { P, KINDS } = keys(board);
  const [ids] = await pipeline([["ZRANGE", KINDS[kind], 0, -1]]);
  if (!ids.length) return [];
  const rows = await pipeline(ids.map((id: string) => ["HGETALL", P + kind + ":" + id]));
  return ids.map((id: string, i: number) => Object.assign(toObj(rows[i] || []), { id }));
}

function cleanFields(fields: unknown): string[] {
  const flat: string[] = [];
  for (const [k, v] of Object.entries((fields as Record<string, unknown>) || {})) {
    if (k === "id" || k === "issue" || !FIELD_RE.test(k)) continue;
    flat.push(k, String(v == null ? "" : v).slice(0, MAX_VAL));
  }
  return flat;
}

export async function revision(board: string): Promise<{ rev: number; seeded: boolean }> {
  const { P, REV } = keys(board);
  const [rev, seeded] = await pipeline([["GET", REV], ["GET", P + "seeded"]]);
  return { rev: Number(rev || 0), seeded: !!seeded };
}

export async function readBoard(board: string) {
  const { rev, seeded } = await revision(board);
  const [tasks, decisions] = await Promise.all([readKind(board, "t"), readKind(board, "d")]);
  return { rev, seeded, tasks, decisions };
}

export async function readTask(board: string, id: string): Promise<Record<string, string> | null> {
  const { P, KINDS } = keys(board);
  const [inSet, flat] = await pipeline([["ZSCORE", KINDS.t, id], ["HGETALL", P + "t:" + id]]);
  return inSet == null ? null : Object.assign(toObj(flat || []), { id });
}

/** Runs once, ever: the first page load fills an empty store from its own data. */
export async function seed(board: string, body: any) {
  const { P, REV, KINDS } = keys(board);
  const [ok] = await pipeline([["SET", P + "seeded", "1", "NX"]]);
  if (ok !== "OK") return;
  const cmds: (string | number)[][] = [];
  for (const kind of ["t", "d"] as Kind[]) {
    const items = (kind === "t" ? body?.tasks : body?.decisions) || [];
    items.forEach((it: any, i: number) => {
      if (!it || !ID_RE.test(it.id)) return;
      const flat = cleanFields(it);
      cmds.push(["ZADD", KINDS[kind], i, it.id]);
      if (flat.length) cmds.push(["HSET", P + kind + ":" + it.id, ...flat]);
    });
  }
  cmds.push(["INCR", REV]);
  for (let i = 0; i < cmds.length; i += 200) await pipeline(cmds.slice(i, i + 200));
}

export type OpResult = { ok: true } | { ok: false; error: "bad_op" | "id_taken" | "gone" | "linked" };

export async function applyOps(board: string, ops: any[]): Promise<OpResult[]> {
  const { P, REV, KINDS } = keys(board);
  const results: OpResult[] = [];
  for (const op of ops.slice(0, 200)) {
    const kind = op?.kind as Kind;
    const zkey = Object.hasOwn(KINDS, kind) ? KINDS[kind] : undefined;
    if (!zkey || !ID_RE.test(op.id)) { results.push({ ok: false, error: "bad_op" }); continue; }
    const hkey = P + kind + ":" + op.id;
    if (op.op === "del") {
      const [r] = await pipeline([["EVAL", DEL_LUA, 3, zkey, hkey, REV, op.id]]);
      results.push(r === -2 ? { ok: false, error: "linked" } : { ok: true });
    } else if (op.op === "patch") {
      const create = op.create ? "1" : "0";
      const order = Number.isFinite(op.order) ? op.order : Date.now();
      const [r] = await pipeline([["EVAL", PATCH_LUA, 3, zkey, hkey, REV, op.id, create, order, ...cleanFields(op.fields)]]);
      results.push(r === -1 ? { ok: false, error: "id_taken" } : r === 0 ? { ok: false, error: "gone" } : { ok: true });
    } else {
      results.push({ ok: false, error: "bad_op" });
    }
  }
  return results;
}

/**
 * Reserve a task for starting, so two people pressing Start at once open one
 * issue rather than two. Returns the claim token, or why there is none.
 */
export async function claimTask(board: string, id: string): Promise<{ token: string } | { gone: true } | { existing: string }> {
  const { P, REV, KINDS } = keys(board);
  const now = String(Date.now());
  const [r] = await pipeline([["EVAL", CLAIM_LUA, 3, P + "t:" + id, KINDS.t, REV, id, now, CLAIM_STALE_MS]]);
  if (r === "ok") return { token: "pending:" + now };
  if (r === "gone") return { gone: true };
  return { existing: String(r) };
}

/** Swap the claim for the issue it produced, or release it with `ref` empty. */
export async function settleClaim(board: string, id: string, token: string, ref: string): Promise<boolean> {
  const { P, REV } = keys(board);
  const [r] = await pipeline([["EVAL", SETTLE_LUA, 2, P + "t:" + id, REV, token, ref]]);
  return r !== 0;
}
