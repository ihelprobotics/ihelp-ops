// Shared store for the standalone SENTINEL build board (Upstash Redis over REST).
//
// The same keys iHelp Ops reads and writes at /sentinel (app/lib/plan-store.ts
// in the Ops repo), so an edit in either place shows in both. This copy has no
// sign-in and no GitHub token: it edits the plan, and cannot start a task.
//
// Layout:
//   sentinel:rev        integer, bumped on every write (clients poll it)
//   sentinel:seeded     set once when the board is first loaded from the page
//   sentinel:tids       sorted set: task id -> display order
//   sentinel:t:<id>     hash: task fields
//   sentinel:dids       sorted set: decision id -> display order
//   sentinel:d:<id>     hash: decision fields
//
// A task with `issue` set was started in Ops and follows its GitHub issue.
// Like the Ops store, this one never writes `issue`, drops a typed status or
// assignee for a linked task, and refuses to delete it.

const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

const P = "sentinel:";
const REV = P + "rev";
const KINDS = { t: P + "tids", d: P + "dids" };
const ID_RE = /^[A-Za-z0-9_$-]{1,24}$/;
const FIELD_RE = /^[a-z]{1,16}$/;
const MAX_VAL = 8000;

// Returns 0 when patching an item that no longer exists, -1 when creating an
// id that is already taken, otherwise the new revision.
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

// -2 when the task is linked to an issue.
const DEL_LUA = `
local linked = redis.call('HGET', KEYS[2], 'issue')
if linked and linked ~= '' then return -2 end
local n = redis.call('ZREM', KEYS[1], ARGV[1])
redis.call('DEL', KEYS[2])
if n == 0 then return 0 end
return redis.call('INCR', KEYS[3])`;

async function pipeline(cmds) {
  let r;
  try {
    r = await fetch(URL_ + "/pipeline", {
      method: "POST",
      headers: { Authorization: "Bearer " + TOKEN, "Content-Type": "application/json" },
      body: JSON.stringify(cmds),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (e) {
    throw new Error(`The board's store (Upstash) did not answer: ${e?.message ?? e}.`);
  }
  if (!r.ok) {
    throw new Error(
      `The board's store answered ${r.status}.` +
        (r.status === 401 ? " KV_REST_API_TOKEN is wrong or was rotated." : " Check the Upstash database in the Vercel Storage tab.")
    );
  }
  const out = await r.json();
  return out.map((x) => {
    if (x.error) throw new Error(`The board's store refused a command: ${x.error}`);
    return x.result;
  });
}

const toObj = (flat) => {
  const o = {};
  for (let i = 0; i < flat.length; i += 2) o[flat[i]] = flat[i + 1];
  return o;
};

async function readKind(kind) {
  const [ids] = await pipeline([["ZRANGE", KINDS[kind], 0, -1]]);
  if (!ids.length) return [];
  const rows = await pipeline(ids.map((id) => ["HGETALL", P + kind + ":" + id]));
  return ids.map((id, i) => Object.assign(toObj(rows[i] || []), { id }));
}

function cleanFields(fields) {
  const flat = [];
  for (const [k, v] of Object.entries(fields || {})) {
    if (k === "id" || k === "issue" || !FIELD_RE.test(k)) continue;
    flat.push(k, String(v == null ? "" : v).slice(0, MAX_VAL));
  }
  return flat;
}

async function seed(body) {
  const [ok] = await pipeline([["SET", P + "seeded", "1", "NX"]]);
  if (ok !== "OK") return;
  const cmds = [];
  for (const kind of ["t", "d"]) {
    const items = (kind === "t" ? body.tasks : body.decisions) || [];
    items.forEach((it, i) => {
      if (!it || !ID_RE.test(it.id)) return;
      const flat = cleanFields(it);
      cmds.push(["ZADD", KINDS[kind], i, it.id]);
      if (flat.length) cmds.push(["HSET", P + kind + ":" + it.id, ...flat]);
    });
  }
  cmds.push(["INCR", REV]);
  for (let i = 0; i < cmds.length; i += 200) await pipeline(cmds.slice(i, i + 200));
}

async function applyOps(ops) {
  const results = [];
  for (const op of ops.slice(0, 200)) {
    const zkey = op && Object.hasOwn(KINDS, op.kind) ? KINDS[op.kind] : undefined;
    if (!zkey || !ID_RE.test(op.id)) { results.push({ ok: false, error: "bad_op" }); continue; }
    const hkey = P + op.kind + ":" + op.id;
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

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!URL_ || !TOKEN) {
    return res.status(503).json({
      error: "KV_REST_API_URL and KV_REST_API_TOKEN are not set on this Vercel project, so the board's store cannot be reached. Copy both from the mitra-build-board project.",
    });
  }
  try {
    if (req.method === "GET") {
      const [rev, seeded] = await pipeline([["GET", REV], ["GET", P + "seeded"]]);
      const cur = Number(rev || 0);
      if (req.query.rev != null && Number(req.query.rev) === cur) return res.json({ rev: cur, unchanged: true });
      const [tasks, decisions] = await Promise.all([readKind("t"), readKind("d")]);
      return res.json({ rev: cur, seeded: !!seeded, tasks, decisions });
    }
    if (req.method === "POST") {
      const body = req.body || {};
      if (body.seed) { await seed(body.seed); return res.json({ ok: true }); }
      if (!Array.isArray(body.ops)) return res.status(400).json({ error: "Send { ops: [...] }: a list of patch or del operations." });
      const results = await applyOps(body.ops);
      const [rev] = await pipeline([["GET", REV]]);
      return res.json({ rev: Number(rev || 0), results });
    }
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: `${req.method} is not supported here. Use GET to read the board or POST to edit it.` });
  } catch (e) {
    console.error(e);
    return res.status(503).json({ error: e?.message ?? String(e) });
  }
}
