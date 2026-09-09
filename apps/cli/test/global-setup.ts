// Builds the migrated-PGlite snapshot before any worker forks. Without it a
// cold cache has every worker run the migrations at once under coverage
// instrumentation, and the contention times the suite out.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { warmPgliteSnapshot } from "persistence/testing";
import { setPidFile, sweepLeakedApiProcesses } from "./harness/pid-registry";

let pidDir: string | undefined;

export async function setup(): Promise<void> {
  pidDir = mkdtempSync(join(tmpdir(), "mergebrief-cli-"));
  setPidFile(join(pidDir, "api.pids"));
  await warmPgliteSnapshot();
}

export function teardown(): void {
  const swept = sweepLeakedApiProcesses();

  if (pidDir !== undefined) {
    rmSync(pidDir, { recursive: true, force: true });
  }

  if (swept > 0) {
    // Loud on purpose: a nonzero sweep means a worker died mid-test, so some
    // suite hit a timeout even if the run reported green.
    console.warn(`global teardown swept ${String(swept)} leaked api processes`);
  }
}
