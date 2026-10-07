import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Logger } from "../contract/generator";

const SPAWN_CWD_NAME = "cwd";
const HARNESS_BASE_SEGMENTS = [".cache", "mergebrief", "harness"] as const;
const OWNER_ONLY_MODE = 0o700;

/** A fresh temp tree for one generation or probe, removed as a whole after. */
export interface HarnessWorkDir {
  /** Holds the files a CLI is handed by path, outside the spawn cwd. */
  root: string;
  /** The spawn cwd: a CLI reads its workspace from here, so it stays empty. */
  cwd: string;
}

/**
 * The base sits under the user's home, never the shared `/tmp`: claude reads
 * memory files from every parent of its cwd, and on Linux any local user can
 * write `/tmp/CLAUDE.md`.
 */
function resolveHarnessBase(): string {
  const base = join(homedir(), ...HARNESS_BASE_SEGMENTS);
  mkdirSync(base, { recursive: true, mode: OWNER_ONLY_MODE });
  return base;
}

export function createHarnessWorkDir(prefix: string): HarnessWorkDir {
  const root = mkdtempSync(join(resolveHarnessBase(), prefix));
  const cwd = join(root, SPAWN_CWD_NAME);
  mkdirSync(cwd);
  return { root, cwd };
}

/** Best-effort: called from `finally`, where a throw would replace the in-flight rejection. */
export function removeHarnessWorkDir(
  workDir: HarnessWorkDir,
  log?: Logger,
): void {
  try {
    rmSync(workDir.root, { recursive: true, force: true });
  } catch {
    log?.(`note: could not remove temp dir ${workDir.root}`);
  }
}
