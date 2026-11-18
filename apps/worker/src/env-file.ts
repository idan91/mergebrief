import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const ENV_FILE = ".env";
const WORKSPACE_MARKER = "pnpm-workspace.yaml";

/** The nearest ancestor holding the workspace marker, else `start` itself. */
function findWorkspaceRoot(start: string): string {
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

/**
 * Loads the working directory's `.env`, then the workspace root's. Node keeps
 * a variable that is already set, so the shell wins, then the nearer file.
 */
export function loadEnvFiles(cwd: string): void {
  const files = new Set([
    join(resolve(cwd), ENV_FILE),
    join(findWorkspaceRoot(cwd), ENV_FILE),
  ]);

  for (const file of files) {
    try {
      process.loadEnvFile(file);
    } catch {
      // No such file; the variables may still be set in the environment.
    }
  }
}
