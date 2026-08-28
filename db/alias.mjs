// Teach plain Node the `@/` path alias.
//
// The checks import the platform's own modules and run them for real — that is
// the whole point of them. But `tsconfig.json` maps `@/*` to the project root
// and only Next understands that, so the moment an imported module grows a
// `@/`-prefixed import of its own, the check stops starting.
//
// That happened: `app/lib/repos.ts` began importing `@/app/lib/github`, and
// `npm run test:assign` has not run since. It did not fail — it never got as
// far as an assertion, and a suite that cannot start prints nothing that looks
// like a failure. This hook exists so that cannot happen quietly again.
//
// Registered with `node --import ./db/alias.mjs`, which every test script does.

import { register } from "node:module";
import { pathToFileURL } from "node:url";

register("./alias-hook.mjs", pathToFileURL("./db/"));
