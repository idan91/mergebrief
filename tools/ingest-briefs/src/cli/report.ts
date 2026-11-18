import type { IngestSummary } from "../ingest";

/** Exit 2: one or more briefs went unmapped — inspect before the cutover. */
export const EXIT_UNMAPPED = 2;

/**
 * The operator-facing run report. Takes its sink so the shape can be asserted
 * without a process: every unmapped brief is named, because a cutover that
 * reports success while dropping one is the failure this tool exists to catch.
 */
export function writeIngestReport(
  summary: IngestSummary,
  write: (line: string) => void,
): void {
  write(
    `ingested: ${String(summary.briefs)} briefs, ${String(summary.narratives)} narratives, ${String(summary.marks)} marks, ${String(summary.deltas)} deltas; skipped ${String(summary.skipped.length)} file(s)\n`,
  );
  for (const name of summary.skipped) {
    write(`  skipped: ${name}\n`);
  }
  for (const name of summary.unmapped) {
    write(`  UNMAPPED brief (NOT ingested): ${name}\n`);
  }
}
