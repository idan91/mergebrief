import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { Logger } from "../contract/generator";

const SPAWN_CWD_NAME = "cwd";
const HARNESS_BASE_SEGMENTS = [".cache", "mergebrief", "harness"] as const;
const OWNER_ONLY_MODE = 0o700;
const OWNER_ONLY_FILE_MODE = 0o600;

/** A fresh temp tree for one generation or probe, removed as a whole after. */
export interface HarnessWorkDir {
  /** Holds the files a CLI is handed by path, outside the spawn cwd. */
  root: string;
  /** The spawn cwd: a CLI reads its workspace from here, so it holds only its cwd files. */
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

/** A file a CLI reads from its spawn cwd: the one exception to the empty folder. */
export interface HarnessCwdFile {
  /** Relative to the spawn cwd. */
  readonly path: string;
  readonly content: string;
}

const NO_CWD_FILES: readonly HarnessCwdFile[] = [];

export function createHarnessWorkDir(
  prefix: string,
  cwdFiles: readonly HarnessCwdFile[] = NO_CWD_FILES,
): HarnessWorkDir {
  const root = mkdtempSync(join(resolveHarnessBase(), prefix));
  const cwd = join(root, SPAWN_CWD_NAME);
  try {
    mkdirSync(cwd);
    for (const file of cwdFiles) {
      const target = join(cwd, file.path);
      mkdirSync(dirname(target), { recursive: true, mode: OWNER_ONLY_MODE });
      writeFileSync(target, file.content, { mode: OWNER_ONLY_FILE_MODE });
    }
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
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
