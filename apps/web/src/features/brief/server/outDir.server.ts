import "@tanstack/react-start/server-only";

import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { getServerEnv } from "../../../server/env";
import { LocalBriefErrorCodes } from "../utils/briefErrors";

// The dev file surface. A production build never serves it whatever the
// environment says: a forgotten variable must not expose `readFile`.

let cachedRoot: string | undefined;

/**
 * The checkout root. A relative `MERGEBRIEF_OUT_DIR` resolves against this,
 * not `process.cwd()`: the dev server's cwd is `apps/web`, so
 * `tools/categorizer/out` would otherwise mean `apps/web/tools/categorizer/out`.
 * Only the walk is cached; the variable is re-read per call.
 */
function workspaceRoot(): string {
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

/** `PROD`, not `!DEV`: vitest runs in mode `test`, which is neither. */
export function localBriefsDir(): string | undefined {
  if (import.meta.env.PROD) {
    return undefined;
  }
  const raw = getServerEnv()["MERGEBRIEF_OUT_DIR"];
  if (raw === undefined || raw === "") {
    return join(workspaceRoot(), "tools/categorizer/out");
  }
  return isAbsolute(raw) ? raw : resolve(workspaceRoot(), raw);
}

/** The directory, or a refusal (production build) the handlers curate. */
export function requireLocalBriefsDir(): string {
  const dir = localBriefsDir();
  if (dir === undefined) {
    throw new Error(LocalBriefErrorCodes.DISABLED);
  }
  return dir;
}
