import { isAbsolute, resolve } from "node:path";
import { findWorkspaceRoot } from "./workspace-root";

/** The API runs from `apps/api`, so a relative dir names a checkout path. */
export function resolveLocalBriefsDir(configured: string, cwd: string): string {
  if (isAbsolute(configured)) {
    return configured;
  }
  return resolve(findWorkspaceRoot(cwd), configured);
}
