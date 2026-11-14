// Deletes the raw model output a failed generation left in the dump folder
// once it is a week old. The folder is this process's own disk, which no
// other worker replica mounts, so each process sweeps its own on a timer: a
// queue job would run in one replica and leave the others' dumps in place.
import { readdir, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { FAILURE_DUMP_SUFFIX } from "generators";
import type { Logger } from "logging";

const DUMP_RETENTION_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface FailureDumpSweepDeps {
  /** The folder the generator dumps into; absent until a generation fails. */
  readonly dir: string;
  readonly log: Logger;
  readonly now: () => Date;
}

async function listDumpNames(dir: string): Promise<string[]> {
  try {
    const names = await readdir(dir);
    return names.filter((name) => name.endsWith(FAILURE_DUMP_SUFFIX));
  } catch {
    return [];
  }
}

/** Whether `path` was a dump past the cutoff and is now gone; false when it cannot be read or removed. */
async function deleteStaleDump(path: string, cutoff: number): Promise<boolean> {
  try {
    const { mtimeMs } = await stat(path);
    if (mtimeMs >= cutoff) {
      return false;
    }
    await unlink(path);
    return true;
  } catch {
    return false;
  }
}

/** One dump that cannot be read or removed never keeps the sweep from the rest. */
export async function sweepFailureDumps(
  deps: FailureDumpSweepDeps,
): Promise<void> {
  const cutoff = deps.now().getTime() - DUMP_RETENTION_DAYS * DAY_MS;
  let deleted = 0;

  for (const name of await listDumpNames(deps.dir)) {
    if (await deleteStaleDump(join(deps.dir, name), cutoff)) {
      deleted += 1;
    }
  }

  if (deleted > 0) {
    deps.log.info(
      `failure dump sweep: deleted ${deleted} failure dumps older than ${DUMP_RETENTION_DAYS} days`,
    );
  }
}

/**
 * Sweeps now and once a day for as long as the process lives. The timer
 * never holds the process open, and a failed sweep only warns: the next one
 * tries again.
 */
export function scheduleFailureDumpSweep(deps: FailureDumpSweepDeps): void {
  const sweep = (): void => {
    sweepFailureDumps(deps).catch((error: unknown) => {
      deps.log.warn("failure dump sweep: failed", { err: error });
    });
  };

  sweep();
  setInterval(sweep, DAY_MS).unref();
}
