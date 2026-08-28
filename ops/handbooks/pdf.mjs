// The handbooks, printed.
//
//   node ops/handbooks/build.mjs      # first — the HTML
//   node ops/handbooks/pdf.mjs        # then  — docs/handbooks/*.pdf
//
// Five documents: the full handbook and one per role. Rendered from the same
// HTML everybody reads on screen rather than written separately, so the paper
// and the page cannot say different things — and the access table in each still
// traces back to app/lib/roles.ts, through the generator, through the browser,
// to the paper.
//
// Two details that would otherwise go wrong, and did:
//
//   The stylesheet carries a dark theme for readers whose system asks for one.
//   Printing that produces a black page and a toner bill, so the render forces
//   the light palette regardless of the machine it runs on.
//
//   The fonts come from Google. Without waiting on document.fonts.ready the PDF
//   sets in a fallback face and breaks its lines in different places from the
//   version on screen — the same words, a different document.
//
// It borrows whichever Chromium is already on the machine rather than adding a
// dependency this project does not otherwise need. If it cannot find one, it
// says exactly where it looked and how to print the pages by hand.

import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const OUT = join(ROOT, "docs", "handbooks");

// ---------------------------------------------------------------------------
// The browser
// ---------------------------------------------------------------------------
// Whichever Chromium is already on this machine: the project's own
// node_modules first, then the browser-automation skill's, then the copy that
// ships inside the CodeGPT VS Code extension. The extension's directory carries
// its version number and is rewritten on every update, so it is globbed rather
// than named — a pinned version breaks silently the next time it updates.
const looked = [];

function resolveChromium() {
  const req = createRequire(join(ROOT, "package.json"));
  const roots = [ROOT + "/", join(homedir(), ".claude", "skills", "browser-automation") + "/"];

  for (const base of [join(homedir(), ".vscode-server", "extensions"), join(homedir(), ".vscode", "extensions")]) {
    if (!existsSync(base)) continue;
    const newest = readdirSync(base)
      .filter((d) => d.startsWith("danielsanmedium.dscodegpt-"))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }))
      .pop();
    if (newest) roots.push(join(base, newest, "standalone") + "/");
  }

  for (const root of roots) {
    for (const pkg of ["patchright", "playwright", "playwright-core"]) {
      looked.push(root + pkg);
      try {
        const mod = createRequire(root)(pkg);
        const chromium = mod?.chromium ?? mod?.default?.chromium;
        if (chromium) return chromium;
      } catch { /* try the next one */ }
    }
  }

  throw new Error(
    "No Chromium available to print with. Looked for:\n  " + looked.join("\n  ") +
    "\n\nInstall patchright or playwright, or print the files in ops/handbooks/ " +
    "from any browser: A4, background graphics on, margins 16/18/15/15mm."
  );
}

// ---------------------------------------------------------------------------
// The full handbook: docs/10, as a page
//
// A small Markdown subset, because docs/10 uses a small Markdown subset and a
// renderer for the whole language would be a dependency to carry for one file.
// Anything it does not understand is emitted as a paragraph rather than
// silently dropped — a missing section in a printed handbook is the failure
// nobody notices until somebody is holding it.
// ---------------------------------------------------------------------------
const esc = (s) => s.replace(/&(?![a-z#]+;)/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const inline = (s) =>
  esc(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[\s(])\*([^*]+)\*/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

function markdown(src) {
  const lines = src.split(/\r?\n/);
  const out = [];
  let i = 0;

  const para = [];
  const flush = () => {
    if (para.length) { out.push(`<p>${inline(para.join(" "))}</p>`); para.length = 0; }
  };

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) { flush(); i++; continue; }

    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) { flush(); out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); i++; continue; }

    if (/^---+$/.test(line.trim())) { flush(); out.push("<hr>"); i++; continue; }

    if (line.startsWith("```")) {
      flush();
      const body = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) body.push(lines[i++]);
      i++;
      out.push(`<pre><code>${esc(body.join("\n"))}</code></pre>`);
      continue;
    }

    // A table: a header row, a separator, then rows.
    if (line.startsWith("|") && /^\|[\s:|-]+\|$/.test(lines[i + 1] ?? "")) {
      flush();
      const cells = (r) => r.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      const head = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].startsWith("|")) rows.push(cells(lines[i++]));
      out.push(
        "<table><thead><tr>" + head.map((c) => `<th>${inline(c)}</th>`).join("") + "</tr></thead><tbody>" +
        rows.map((r) => "<tr>" + r.map((c) => `<td>${inline(c)}</td>`).join("") + "</tr>").join("") +
        "</tbody></table>"
      );
      continue;
    }

    const li = /^(\s*)([-*]|\d+\.)\s+(.*)$/.exec(line);
    if (li) {
      flush();
      const ordered = /\d/.test(li[2]);
      const items = [];
      while (i < lines.length) {
        const m = /^(\s*)([-*]|\d+\.)\s+(.*)$/.exec(lines[i]);
        if (m) { items.push(m[3]); i++; continue; }
        // A wrapped continuation line belongs to the item above it.
        if (items.length && /^\s{2,}\S/.test(lines[i])) { items[items.length - 1] += " " + lines[i].trim(); i++; continue; }
        break;
      }
      const tag = ordered ? "ol" : "ul";
      out.push(`<${tag}>` + items.map((t) => `<li>${inline(t)}</li>`).join("") + `</${tag}>`);
      continue;
    }

    para.push(line.trim());
    i++;
  }
  flush();
  return out.join("\n");
}

function fullHandbook() {
  const src = readFileSync(join(ROOT, "docs", "10-using-the-platform.md"), "utf8");
  const style = readFileSync(join(HERE, "handbook.css"), "utf8");
  const body = markdown(src);
  return `<!doctype html><meta charset="utf-8">
<title>The iHelp Ops handbook</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700&family=IBM+Plex+Mono:wght@400;500&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&display=swap">
<style>${style}</style>
<div class="page"><div class="prose">
${body}
</div></div>`;
}

// ---------------------------------------------------------------------------
const DOCS = [
  ["ihelp-ops-handbook", null],       // built from docs/10 below
  ["member", join(HERE, "member.html")],
  ["lead", join(HERE, "lead.html")],
  ["cto", join(HERE, "cto.html")],
  ["founder", join(HERE, "founder.html")],
];

const FOOTER = `
  <div style="width:100%;font:9px 'Archivo',system-ui,sans-serif;color:#8A8A8E;
              padding:0 15mm;display:flex;justify-content:space-between;">
    <span>iHelp Robotics · internal</span>
    <span class="pageNumber"></span>
  </div>`;

const missing = DOCS.filter(([, p]) => p && !existsSync(p)).map(([n]) => n);
if (missing.length) {
  console.error(`No HTML for: ${missing.join(", ")}. Run \`node ops/handbooks/build.mjs\` first.`);
  process.exit(1);
}

mkdirSync(OUT, { recursive: true });

// channel: 'chromium' uses the build the resolved package already downloaded,
// rather than the bundled revision it would otherwise ask you to install.
const browser = await resolveChromium().launch({ channel: 'chromium' });
// colorScheme light is the whole point: the stylesheet has a dark theme, and a
// dark theme printed is a black page.
const ctx = await browser.newContext({ colorScheme: "light" });
const page = await ctx.newPage();

const temp = join(HERE, "_full.html");
writeFileSync(temp, fullHandbook());

try {
  for (const [name, htmlPath] of DOCS) {
    const file = htmlPath ?? temp;
    await page.goto(pathToFileURL(file).href, { waitUntil: "load" });
    // Without this the PDF sets in a fallback face and breaks its lines
    // somewhere other than the version on screen.
    await page.evaluate(() => document.fonts.ready);
    await page.emulateMedia({ media: "print", colorScheme: "light" });
    await page.pdf({
      path: join(OUT, `${name}.pdf`),
      format: "A4",
      printBackground: true,
      margin: { top: "16mm", right: "18mm", bottom: "15mm", left: "15mm" },
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate: FOOTER,
    });
    console.log(`  ${name.padEnd(22)} -> docs/handbooks/${name}.pdf`);
  }
} finally {
  // KEEP_HTML=1 leaves the assembled page behind, which is how you check what
  // the Markdown converter actually produced when a section looks wrong.
  if (!process.env.KEEP_HTML) unlinkSync(temp);
  await browser.close();
}

console.log(`\n${DOCS.length} PDFs printed from the same HTML the screen shows.`);
