"""Builds the build-board pages from each board's own HTML.

Usage:
  python plan-boards/build.py                  every board, for iHelp Ops
  python plan-boards/build.py sentinel         one board, for iHelp Ops
  python plan-boards/build.py sentinel --standalone
      the standalone copy, into that board's Vercel project folder
      (sentinel-build-board/public/index.html)

The source HTML is never modified. The Ops page (public/<board>/index.html)
syncs through /api/boards/<board>/board and can start tasks as GitHub issues
(ops.js). The standalone page syncs through its own /api/board — same store,
no sign-in — and only marks started tasks (standalone.js).
"""
import pathlib, re, subprocess, sys, tempfile

HERE = pathlib.Path(__file__).parent
OPS = HERE.parent

BOARDS = {
    "mitra": {
        "src": pathlib.Path(r"G:/AI_Decoded/MITRA/App/Documents/MITRA app build board.html"),
        # The standalone MITRA copy predates this script and is deployed from
        # elsewhere; it is not built here.
        "site": None,
    },
    "sentinel": {
        "src": OPS / "sentinel-build-board" / "SENTINEL elderly-care build board v0.2.html",
        "site": OPS / "sentinel-build-board",
        # MITRA's display face, and the layout fixes in sentinel.css. The font
        # link appears twice: in the page, and in its HTML export.
        "css": "sentinel.css",
        "own": [("family=Fraunces:opsz,wght@9..144,500;9..144,600", "family=Cormorant:wght@500;600;700", 2)],
    },
}

read = lambda name: (HERE / name).read_text(encoding="utf-8")


def replacements(board, api_js, extra_js, extra_css, status_line):
    if board.get("css"):
        extra_css += read(board["css"])
    return board.get("own", []) + [
        # edits go straight to the shared store when live
        ('function changed(){dirty=true;saveDraft();renderTop();}',
         'function changed(){if(writeMode==="live"){syncQueue();return;}dirty=true;saveDraft();renderTop();}'),
        ('  if(writeMode==="local"){sb.hidden=true;',
         '  if(writeMode==="live"){sb.hidden=true;ss.textContent=' + status_line + ';return;}\n'
         '  if(writeMode==="local"){sb.hidden=true;'),
        ("Shared saving isn't available in this view. Your edits are kept in this browser only. Open the board from claude.ai to save for the team.",
         "Can't reach the shared board right now. Your edits are kept in this browser only. Reload to try again."),
        ('$("#rsDraft").onclick=()=>{S=staleDraft.state;staleDraft=null;changed();',
         '$("#rsDraft").onclick=()=>{if(writeMode==="live"){restoreDraftLive(staleDraft.state);clearDraft();}else S=staleDraft.state;staleDraft=null;changed();'),
        ("This removes it from the board for everyone once saved.",
         "This removes it from the board for everyone."),
        ('toast(`${t.id} deleted. Save to share the change.`)',
         'toast(writeMode==="live"?`${t.id} deleted`:`${t.id} deleted. Save to share the change.`)'),
        # CSV export without the Claude downloads capability
        ('function exportCSV(){\n  if(!downloadsNS)return;',
         'function exportCSV(){\n  if(!downloadsNS)downloadsNS={save:o=>{const a=document.createElement("a");a.href=URL.createObjectURL(o.data);a.download=o.filename;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},1000);return Promise.resolve();}};'),
        ('/* ---------- boot ---------- */', api_js + read("sync.js") + extra_js + '\n/* ---------- boot ---------- */'),
        ('}else{writeMode="local";renderTop();renderNotices();}\n})();',
         '}else{goLive();}\n})();'),
        ('</style>\n</head>', extra_css + '</style>\n</head>'),
    ]


def check_scripts(key, html):
    """Refuses a page whose script does not parse.

    The page is one script: a name the added code declares twice — SENTINEL's
    own `LIVE` against ops.js's, 2026-10-12 — is a SyntaxError that stops the
    whole board, and the browser shows a blank page with nothing in the console
    unless you were watching when it loaded.
    """
    for i, js in enumerate(re.findall(r'<script(?![^>]*application/json)[^>]*>(.*?)</script>', html, re.S)):
        with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False, encoding="utf-8") as f:
            f.write(js)
        r = subprocess.run(["node", "--check", f.name], capture_output=True, text=True)
        pathlib.Path(f.name).unlink()
        if r.returncode:
            err = " | ".join(l.strip() for l in r.stderr.splitlines() if l.strip() and not l.strip().startswith("at "))
            raise SystemExit(f"{key}: script {i} of the built page does not parse, so the board would load blank. Nothing was written. {err}")


def build(key, standalone):
    board = BOARDS[key]
    if standalone:
        if not board["site"]:
            raise SystemExit(f"{key} has no standalone site built by this script.")
        out = board["site"] / "public" / "index.html"
        reps = replacements(
            board,
            '\nconst API="/api/board";\n',
            read("standalone.js"),
            read("ops.css"),
            'syncErr?"Offline. Retrying…":(queue.length||inflight)?"Saving…":"All changes saved"',
        )
    else:
        out = OPS / "public" / key / "index.html"
        reps = replacements(
            board,
            f'\nconst API="/api/boards/{key}/board", OPS_API="/api/boards/{key}";\n',
            # Tasks started in Ops as GitHub issues: live status, the Start
            # button, and typed status locked once a task is linked.
            read("ops.js"),
            read("ops.css"),
            'signedOut?"Signed out. Reload to sign in.":syncErr?"Offline. Retrying…":(queue.length||inflight)?"Saving…":"All changes saved"',
        )
    html = board["src"].read_text(encoding="utf-8")
    for old, new, *n in reps:
        want = n[0] if n else 1
        if html.count(old) != want:
            raise SystemExit(f"{key}: expected {want} match(es) for: {old[:70]!r} (found {html.count(old)})")
        html = html.replace(old, new)
    check_scripts(key, html)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(html, encoding="utf-8", newline="\n")
    print("wrote", out, len(html), "bytes")


args = [a for a in sys.argv[1:] if not a.startswith("--")]
standalone = "--standalone" in sys.argv
for key in args or ([] if standalone else list(BOARDS)):
    if key not in BOARDS:
        raise SystemExit(f'There is no "{key}" board. The boards are: {", ".join(BOARDS)}.')
    build(key, standalone)
if standalone and not args:
    raise SystemExit("Name the board: python plan-boards/build.py sentinel --standalone")
