#!/usr/bin/env node
// Deploy to production.
//
//   node ops/deploy.mjs
//
// Three steps, one of which is a workaround for a real bug, so this is a script
// rather than a line in a README that somebody half-remembers.
//
//   1. vercel build --prod          — build here, not on Vercel
//   2. flatten the symlinks         — see below
//   3. vercel deploy --prebuilt     — upload the finished output
//
// WHY NOT JUST `git push`
//
// The ihelp-ops Vercel project cannot deploy at all: it is a private repository
// owned by a GitHub organisation, and the team is on the Hobby plan, which
// refuses that combination. Pushing produces a commit status of "Cannot deploy
// from a private GitHub organization repository on the Hobby plan"; deploying
// to that project from the CLI produces a deployment that sits at UNKNOWN and
// never downloads its own files. Source upload, prebuilt upload and
// git-disconnect all end the same way. It is a billing check, and there is no
// flag that argues with it.
//
// So deployments go to a second project with no repository attached, which
// builds and serves normally. When the plan changes, delete this script and go
// back to pushing — that is the better arrangement, because a deployment linked
// to a commit is traceable and this one is not.
//
// WHY THE SYMLINKS
//
// `vercel build` dedupes identical serverless functions by symlinking them —
// thirty of them here, all the pages that compile to the same handler. Built on
// Windows and uploaded, those arrive dangling, and the remote build dies with
//
//   ENOENT: no such file or directory, stat
//   '/vercel/path0/.vercel/output/functions/api/agents/local.func'
//
// naming whichever one it reached first. Replacing each with a real copy costs
// a few megabytes of upload and makes the deploy work.

import { spawnSync } from "node:child_process";
import { readdirSync, lstatSync, readlinkSync, rmSync, cpSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";

const FUNCTIONS = ".vercel/output/functions";

const run = (cmd, args) => {
  console.log(`\n$ ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: process.platform === "win32" });
  if (r.status !== 0) {
    console.error(`\n${cmd} exited ${r.status}. Stopping.`);
    process.exit(r.status ?? 1);
  }
};

/** Replace every symlink under the built output with a real copy. */
function flatten(dir) {
  let n = 0;
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = lstatSync(p);
    if (st.isSymbolicLink()) {
      const target = resolve(dirname(p), readlinkSync(p));
      if (!existsSync(target)) {
        console.error(`  ${p} points at ${target}, which does not exist. Stopping rather than uploading a broken tree.`);
        process.exit(1);
      }
      rmSync(p, { recursive: true, force: true });
      cpSync(target, p, { recursive: true });
      n++;
    } else if (st.isDirectory()) {
      n += flatten(p);
    }
  }
  return n;
}

run("vercel", ["pull", "--yes", "--environment=production"]);
run("vercel", ["build", "--prod", "--yes"]);

if (!existsSync(FUNCTIONS)) {
  console.error(`\nNo build output at ${FUNCTIONS}. Nothing to deploy.`);
  process.exit(1);
}

console.log(`\n$ flatten ${FUNCTIONS}`);
const n = flatten(FUNCTIONS);
console.log(`  ${n} symlink${n === 1 ? "" : "s"} replaced with real copies`);

run("vercel", ["deploy", "--prebuilt", "--prod", "--yes"]);

console.log(`
Deployed. Two things this script cannot do, both one-off:

  Vercel Authentication is on by default for a new project and puts the whole
  site behind an SSO redirect. Turn it off under Settings -> Deployment
  Protection, or nobody outside the Vercel team can sign in.

  Google needs the deployment's callback URL in its authorised redirect URIs,
  or sign-in fails with redirect_uri_mismatch:
    <PLATFORM_URL>/api/auth/callback/google

Then check it end to end:
  PAGE_URL=<url> npm run test:pages
  PAGE_URL=<url> npm run test:chat
`);
