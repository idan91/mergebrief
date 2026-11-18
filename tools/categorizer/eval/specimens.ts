import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** The slice of a case run the specimen store needs — structural so tests
 * don't have to build full `Brief`s. */
export interface PersistableRuns {
  briefs: readonly unknown[];
  /** 1-based run number that produced `briefs[i]` (see run.ts). */
  runNumbers: readonly number[];
  failureMessages: readonly string[];
}

/**
 * Persist every scored run's brief — flaky-property diagnosis needs
 * specimens, not just pass counts. Wiped per CASE per invocation, so a
 * `--case` run leaves other cases' older specimens in place; check mtimes
 * when reading across cases.
 *
 * An invocation that scored NOTHING keeps the previous specimens and records
 * its failure messages instead — an all-failure run must never destroy the
 * evidence it failed to replace.
 */
export function persistRunBriefs(
  runsDir: string,
  result: PersistableRuns,
): void {
  if (result.briefs.length === 0) {
    mkdirSync(runsDir, { recursive: true });
    writeFileSync(
      join(runsDir, "failure-messages.json"),
      `${JSON.stringify(result.failureMessages, null, 2)}\n`,
    );
    return;
  }
  rmSync(runsDir, { recursive: true, force: true });
  mkdirSync(runsDir, { recursive: true });
  result.briefs.forEach((brief, index) => {
    writeFileSync(
      join(runsDir, `run-${result.runNumbers[index]}.brief.json`),
      `${JSON.stringify(brief, null, 2)}\n`,
    );
  });
}
