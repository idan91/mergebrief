import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

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
