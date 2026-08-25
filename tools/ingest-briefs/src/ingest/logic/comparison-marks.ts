// Phase 5: comparison marks, from both the current `.comparison.json` and the
// legacy `.revchanges.json` alias. Both project to the store's
// coordinates-only body — the CLI's read-time context keys must not reach the
// strict write boundary. Content-addressed on the span, so overlap between the
// two shapes for one span rewrites a single row harmlessly.
import type { PullRequestRow } from "persistence";
import { COMPARISON_FILE, REVCHANGES_FILE } from "../consts";
import { ComparisonFileSchema, RevchangesSchema } from "../schemas";
import type { IngestRun } from "../types";
import { readJsonFile, resolveStemRow, throwFileError } from "../utils";

interface MarkedRange {
  readonly start: number;
  readonly end: number;
}

interface MarkedFile {
  readonly file: string;
  readonly addedRanges: readonly MarkedRange[];
  readonly removedRanges: readonly MarkedRange[];
}

/** Coordinates only: whatever else the read-time file carries is dropped. */
function projectMarkedFiles(
  files: readonly MarkedFile[],
): {
  file: string;
  addedRanges: MarkedRange[];
  removedRanges: MarkedRange[];
}[] {
  return files.map((file) => ({
    file: file.file,
    addedRanges: file.addedRanges.map((range) => ({
      start: range.start,
      end: range.end,
    })),
    removedRanges: file.removedRanges.map((range) => ({
      start: range.start,
      end: range.end,
    })),
  }));
}

async function writeMarksRow(
  run: IngestRun,
  name: string,
  prRow: PullRequestRow,
  marks: {
    baselineSha: string;
    headSha: string;
    files: readonly MarkedFile[];
  },
): Promise<void> {
  const written = await run.store.comparisonMarks.write({
    pullRequestId: prRow.id,
    marks: {
      baselineSha: marks.baselineSha,
      headSha: marks.headSha,
      files: projectMarkedFiles(marks.files),
    },
  });
  if (!written.ok) {
    return throwFileError(name, written.error.message);
  }
  run.log(`marks ${name}`);
}

export async function writeComparisonMarks(
  run: IngestRun,
  comparisonNames: readonly string[],
  revchangesNames: readonly string[],
  stemIndex: ReadonlyMap<string, PullRequestRow | null>,
): Promise<number> {
  let marksCount = 0;

  for (const name of comparisonNames) {
    const parsed = ComparisonFileSchema.safeParse(
      await readJsonFile(run.dir, name),
    );
    if (!parsed.success) {
      return throwFileError(name, "comparison body unreadable");
    }

    const resolved = resolveStemRow(
      stemIndex,
      COMPARISON_FILE.exec(name)?.groups?.["stem"],
    );
    if (!resolved.ok) {
      run.skipped.push(name);
      run.log(`skip ${name}: ${resolved.reason}`);
      continue;
    }

    await writeMarksRow(run, name, resolved.row, {
      baselineSha: parsed.data.baselineSha,
      headSha: parsed.data.headSha,
      files: parsed.data.files,
    });
    marksCount += 1;
  }

  for (const name of revchangesNames) {
    const parsed = RevchangesSchema.safeParse(
      await readJsonFile(run.dir, name),
    );
    if (!parsed.success) {
      return throwFileError(name, "revchanges body unreadable");
    }

    const resolved = resolveStemRow(
      stemIndex,
      REVCHANGES_FILE.exec(name)?.groups?.["stem"],
    );
    if (!resolved.ok) {
      run.skipped.push(name);
      run.log(`skip ${name}: ${resolved.reason}`);
      continue;
    }

    await writeMarksRow(run, name, resolved.row, {
      baselineSha: parsed.data.prevHeadSha,
      headSha: parsed.data.headSha,
      files: parsed.data.files,
    });
    marksCount += 1;
  }

  return marksCount;
}
