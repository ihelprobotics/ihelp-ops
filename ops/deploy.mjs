#!/usr/bin/env node
// Deploy to production.
//
//   node ops/deploy.mjs
//
// One step, and one check that has to happen before it.
//
// THE COMMIT AUTHOR IS THE WHOLE GAME
//
// Vercel refuses a deployment whose commit author does not have contributing
// access to the project, and says so:
//
//   Deployment Blocked — the commit author did not have contributing access to
//   the project on Vercel. The Hobby Plan does not support collaboration for
//   private repositories.
//
// On Hobby that means exactly one author can deploy: the account that owns the
// project. Here that is aidecoded23@gmail.com, GitHub user AI-Decoded, Vercel
// user ai-decoded. A commit authored by anyone else is refused with
// `readyState: BLOCKED` — and `vercel ls` prints BLOCKED as UNKNOWN, so it
// reads as a hung upload rather than a refusal. That misreading cost a day.
//
// This is not an argument for Pro. Pro is only needed to let a *second* person
// deploy. One author needs no plan change, so the check below refuses early and
// says which address to use, rather than spending a build to be told no.
//
//   git config --local user.email aidecoded23@gmail.com
//
// WHY NOT --prebuilt
//
// It used to build here and upload the output, to dodge a git-deploy refusal
// that was really the author check above. That path is now actively worse: a
// locally built .vercel/output/config.json carries `transforms` route entries
// the platform rejects, and the deployment dies with
//
//   errorCode: invalid_routes, errorStep: process-and-upload-routes
//
// after a clean local build, which points at the routes rather than at the
// version skew that produced them. Letting Vercel run the build means its own
// builder writes routes its own router accepts. It also retires the symlink
// flattening this script used to do — that only mattered for a Windows-built
// prebuilt upload.
//
// WHY NOT JUST `git push`
//
// The ihelp-ops project is a private repository owned by a GitHub organisation
// on the Hobby plan, which Vercel will not build from. So deployments go to
// ihelp-ops-live, a second project with no repository attached. When the plan
// changes, delete this script and go back to pushing — a deployment linked to a
// commit is traceable and this one is not.

import { spawnSync } from "node:child_process";

// The account that owns the Vercel project. Anything else is refused by Vercel
// after a full build, so it is refused here first.
const DEPLOY_AUTHOR = process.env.DEPLOY_AUTHOR || "aidecoded23@gmail.com";

const run = (cmd, args) => {
  console.log(`\n$ ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: process.platform === "win32" });
  if (r.status !== 0) {
    console.error(`\n${cmd} exited ${r.status}. Stopping.`);
    process.exit(r.status ?? 1);
  }
};

const author = spawnSync("git", ["log", "-1", "--format=%ae"], { encoding: "utf8" })
  .stdout.trim();

if (author !== DEPLOY_AUTHOR) {
  console.error(`
The commit about to be deployed is authored by

    ${author || "(no commit found)"}

and Vercel will refuse it. On the Hobby plan only the account that owns the
project may deploy, which here is ${DEPLOY_AUTHOR}. The refusal arrives as a
deployment stuck in BLOCKED, which \`vercel ls\` displays as UNKNOWN, so it
looks like a failed upload rather than a rejection.

Fix the author and commit again:

    git config --local user.email ${DEPLOY_AUTHOR}

Nothing has been built or uploaded.
`);
  process.exit(1);
}

console.log(`Deploying as ${author}, which owns the Vercel project.`);

run("vercel", ["pull", "--yes", "--environment=production"]);
run("vercel", ["deploy", "--prod", "--yes"]);

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
