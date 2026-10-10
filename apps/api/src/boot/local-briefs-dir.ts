import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

/** A relative `MERGEBRIEF_OUT_DIR` resolves against the checkout holding this file. */
const WORKSPACE_MARKER = "pnpm-workspace.yaml";

/** The nearest ancestor holding the workspace marker, else `start` itself. */
export function findWorkspaceRoot(start: string): string {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, WORKSPACE_MARKER))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return resolve(start);
    }
    dir = parent;
  }
}

/** The API runs from `apps/api`, so a relative dir names a checkout path. */
export function resolveLocalBriefsDir(configured: string, cwd: string): string {
  if (isAbsolute(configured)) {
    return configured;
  }
  return resolve(findWorkspaceRoot(cwd), configured);
}
