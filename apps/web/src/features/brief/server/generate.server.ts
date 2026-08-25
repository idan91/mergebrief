import "@tanstack/react-start/server-only";

import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/**
 * Anchor at the WORKSPACE ROOT, never bare cwd: web and worker run with
 * different working directories, and in the docker image cwd is `/app`, so a
 * relative climb escapes the image and artifacts land on the container's
 * root FS.
 */
function workspaceRoot(): string {
  let dir = resolve(process.cwd());
  for (;;) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      // No checkout anchor (packaged distribution) — cwd is the best left.
      return resolve(process.cwd());
    }
    dir = parent;
  }
}

/** Load apps/web/.env if present; otherwise rely on the ambient env (mirrors the CLI's loadEnv). */
function loadEnv(): void {
  try {
    process.loadEnvFile();
  } catch {
    // no .env file — ANTHROPIC_API_KEY may still be set in the environment
  }
}
loadEnv();

/**
 * Shared with `brief.server` — ONE store.
 * `MERGEBRIEF_OUT_DIR` repoints it at another directory: the browser suite
 * boots the server over its committed fixture set so the local path serves
 * exactly those artifacts and nothing a developer happens to have generated.
 * Read AFTER `loadEnv` so `.env` can set it too.
 */
export const OUT_DIR = process.env["MERGEBRIEF_OUT_DIR"]
  ? resolve(process.env["MERGEBRIEF_OUT_DIR"])
  : join(workspaceRoot(), "tools/categorizer/out");
