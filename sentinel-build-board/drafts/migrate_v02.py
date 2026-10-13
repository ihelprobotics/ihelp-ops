"""Moves the live SENTINEL board from v0.1 to v0.2 without losing the team's edits.

Usage (credentials from the environment: KV_REST_API_URL, KV_REST_API_TOKEN):
  python sentinel-build-board/drafts/migrate_v02.py            dry run: says what it would do
  python sentinel-build-board/drafts/migrate_v02.py --apply    writes, in one transaction

For a task that exists live, a field is written from v0.2 only if nobody has
changed it since v0.1 — a field the team edited keeps the team's value and is
reported. Status, assignee and issue are never written for an existing task.
Tasks the team added keep their place after the plan's. New v0.2 tasks are
created. Display order follows v0.2. The revision is bumped so open boards
pick the change up on their next poll.
"""
import json, os, pathlib, re, sys, urllib.request

HERE = pathlib.Path(__file__).parent
V01 = HERE.parent / "SENTINEL elderly-care build board.html"
V02 = HERE.parent / "SENTINEL elderly-care build board v0.2.html"
P = "sentinel:"
NEVER = {"id", "status", "assignee", "issue"}

URL = os.environ.get("KV_REST_API_URL")
TOKEN = os.environ.get("KV_REST_API_TOKEN")
if not URL or not TOKEN:
    sys.exit("KV_REST_API_URL and KV_REST_API_TOKEN are not set. Load them from mitra-build-board/.env.local.")


def call(path, body):
    req = urllib.request.Request(URL + path, data=json.dumps(body).encode(), method="POST",
                                 headers={"Authorization": "Bearer " + TOKEN, "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=20) as r:
        out = json.load(r)
    for x in out:
        if isinstance(x, dict) and x.get("error"):
            sys.exit(f"The store refused a command: {x['error']}")
    return [x["result"] for x in out]


def data(path):
    s = path.read_text(encoding="utf-8")
    return json.loads(re.search(r'id="board-data">(.*?)</script>', s, re.S).group(1))


def live():
    rev, ids = call("/pipeline", [["GET", P + "rev"], ["ZRANGE", P + "tids", 0, -1]])
    rows = call("/pipeline", [["HGETALL", P + "t:" + i] for i in ids]) if ids else []
    tasks = {}
    for i, flat in zip(ids, rows):
        tasks[i] = {flat[k]: flat[k + 1] for k in range(0, len(flat), 2)}
    return int(rev or 0), ids, tasks


def plan():
    v01 = {t["id"]: t for t in data(V01)["tasks"]}
    v02 = data(V02)["tasks"]
    rev, ids, cur = live()
    cmds, kept, written, created = [], [], 0, 0
    for t in v02:
        tid, key = t["id"], P + "t:" + t["id"]
        if tid in cur:
            base, now, fields = v01.get(tid, {}), cur[tid], []
            for k, v in t.items():
                if k in NEVER:
                    continue
                v, was, is_ = str(v), str(base.get(k, "")), str(now.get(k, ""))
                if is_ != was:
                    if v != is_:
                        kept.append(f"{tid}.{k}: team value kept ({is_[:60]!r}); v0.2 would be {v[:60]!r}")
                    continue
                if v != is_:
                    fields += [k, v]
            if fields:
                cmds.append(["HSET", key, *fields]); written += 1
        else:
            flat = []
            for k, v in t.items():
                if k not in ("id", "issue"):
                    flat += [k, str(v)]
            cmds.append(["HSET", key, *flat]); created += 1
    order = [t["id"] for t in v02] + [i for i in ids if i not in {t["id"] for t in v02}]
    zadd = ["ZADD", P + "tids"]
    for n, i in enumerate(order):
        zadd += [n, i]
    cmds += [zadd, ["INCR", P + "rev"]]
    extra = [i for i in ids if i not in {t["id"] for t in v02}]
    return rev, cmds, kept, written, created, extra, len(order)


rev, cmds, kept, written, created, extra, total = plan()
print(f"live revision {rev}: {written} existing tasks updated, {created} created, {total} in the final order")
if extra:
    print("team-added tasks kept after the plan:", ", ".join(extra))
for k in kept:
    print("KEPT", k)
if "--apply" not in sys.argv:
    print("dry run: nothing written. Re-run with --apply.")
    sys.exit()

# Re-plan right before writing, so an edit made since the dry run is respected.
rev2, cmds, kept, written, created, extra, total = plan()
if rev2 != rev:
    print(f"the board changed while planning (revision {rev} -> {rev2}); re-planned")
call("/multi-exec", cmds)

_, ids, cur = live()
want = data(V02)["tasks"]
bad = [t["id"] for t in want if t["id"] not in cur]
print(f"applied. live board now has {len(ids)} tasks; missing after write: {bad or 'none'}")
