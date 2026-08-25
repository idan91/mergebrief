import "@tanstack/react-start/server-only";

import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

// Where the DEV file surface reads brief artifacts from. In-process
// generation is gone (the worker owns it), so this constant outlived the
// module it used to live in.
//
// The file surface is DEVELOPMENT ONLY: a production build never serves it,
// whatever the environment says. It is a file-reading HTTP surface, and
// "an operator forgot to unset a variable" must not be the only thing
// between a stranger and `readFile`.

/**
 * The checkout root, found by walking up to the workspace file. A RELATIVE
 * `MERGEBRIEF_OUT_DIR` resolves against THIS rather than `process.cwd()`,
 * because the dev server's cwd is `apps/web` — so `tools/categorizer/out`
 * would otherwise mean `apps/web/tools/categorizer/out`.
 */
let cachedRoot: string | undefined;

function workspaceRoot(): string {
  // Memoised: the listing path resolves the directory once per artifact
  // read, and cwd cannot change under a running process. Only the WALK is
  // cached — `MERGEBRIEF_OUT_DIR` is still read per call, so a test that
  // repoints it mid-run is still obeyed.
  if (cachedRoot !== undefined) {
    return cachedRoot;
  }
  let dir = resolve(process.cwd());
  for (;;) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) {
      cachedRoot = dir;
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      // No checkout anchor (a packaged distribution): cwd is the best left.
      cachedRoot = resolve(process.cwd());
      return cachedRoot;
    }
    dir = parent;
  }
}

/**
 * Unset, or a production build, means the whole file surface is off. The
 * check is `PROD`, not `!DEV`: vitest runs in mode `test`, which is neither,
 * and the readers must work under test exactly as they do in dev.
 */
export function localBriefsDir(): string | undefined {
  if (import.meta.env.PROD) {
    return undefined;
  }
  const raw = process.env["MERGEBRIEF_OUT_DIR"];
  if (raw === undefined || raw === "") {
    // The CLI's own output directory: a developer who just runs the dev
    // server sees what they generated, with nothing to configure.
    return join(workspaceRoot(), "tools/categorizer/out");
  }
  return isAbsolute(raw) ? raw : resolve(workspaceRoot(), raw);
}

/** The directory, or a refusal (production build) the handlers curate. */
export function requireLocalBriefsDir(): string {
  const dir = localBriefsDir();
  if (dir === undefined) {
    throw new Error("local-briefs-disabled");
  }
  return dir;
}
