// The resolve hook itself, run on Node's module loader thread.
//
// Two rules, both copied from what Next already does with these imports:
// `@/x` is `<project root>/x`, and an import with no extension means the file
// that is actually there. Anything else is passed straight through untouched.
//
// The extension search is not a guess: a path that matches nothing is left
// alone so Node reports the missing module by name, rather than this hook
// swallowing it and producing a stranger error further along.

import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, extname } from "node:path";
import { existsSync } from "node:fs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TRIES = [".ts", ".tsx", ".mjs", ".js", "/index.ts", "/index.tsx", "/index.js"];

function onDisk(path) {
  if (extname(path) && existsSync(path)) return path;
  for (const suffix of TRIES) {
    if (existsSync(path + suffix)) return path + suffix;
  }
  return null;
}

export function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const found = onDisk(join(ROOT, specifier.slice(2)));
    if (found) return nextResolve(pathToFileURL(found).href, context);
  }
  // A relative import inside a module we already redirected arrives here as a
  // file: URL with no extension, for the same reason.
  if (specifier.startsWith("file:") && !extname(specifier)) {
    const found = onDisk(fileURLToPath(specifier));
    if (found) return nextResolve(pathToFileURL(found).href, context);
  }
  return nextResolve(specifier, context);
}
