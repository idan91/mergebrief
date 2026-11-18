import { join, resolve } from "node:path";
import { findWorkspaceRoot } from "./workspace-root";

const ENV_FILE = ".env";

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
