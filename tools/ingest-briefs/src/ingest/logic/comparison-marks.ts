// Phase 5: comparison marks, from both the current `.comparison.json` and the
// legacy `.revchanges.json` alias. Both project to the store's
// coordinates-only body: the CLI's read-time context keys must not reach the
// strict write boundary. Content-addressed on the span, so overlap between the
// two shapes for one span rewrites a single row harmlessly.
import {
  InvalidArtifactBodyError,
  type BriefSpanRow,
  type PullRequestRow,
  type SpanBaseRefs,
} from "persistence";
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
function projectMarkedFiles(files: readonly MarkedFile[]): {
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

/** Each PR's Brief list, read once per ingest run however many marks files name the PR. */
type BriefListCache = Map<PullRequestRow["id"], Promise<BriefSpanRow[]>>;

/** The base of the newest Brief at `sha`, else the PR's current base, as the worker reads a span's sides. */
function resolveSideBase(
  briefs: readonly BriefSpanRow[],
  sha: string,
  prBase: string,
): string {
  const brief = briefs.findLast((row) => row.headSha === sha);
  return brief?.baseSha ?? prBase;
}

/** Every PR row this run resolves was upserted with a base, so each side always has one. */
async function resolveSpanRefs(
  run: IngestRun,
  briefLists: BriefListCache,
  prRow: PullRequestRow,
  marks: { baselineSha: string; headSha: string },
): Promise<SpanBaseRefs> {
  const prBase = prRow.baseSha;
  if (prBase === null) {
    throw new Error("ingest: a pull request row this run wrote has no base");
  }
  let briefs = briefLists.get(prRow.id);
  if (briefs === undefined) {
    briefs = run.store.briefs.listForPullRequest(prRow.id);
    briefLists.set(prRow.id, briefs);
  }
  const rows = await briefs;
  return {
    prevBase: resolveSideBase(rows, marks.baselineSha, prBase),
    newBase: resolveSideBase(rows, marks.headSha, prBase),
  };
}

async function writeMarksRow(
  run: IngestRun,
  name: string,
  briefLists: BriefListCache,
  prRow: PullRequestRow,
  marks: {
    baselineSha: string;
    headSha: string;
    files: readonly MarkedFile[];
  },
): Promise<void> {
  const refs = await resolveSpanRefs(run, briefLists, prRow, marks);
  await run.store.comparisonMarks
    .write({
      pullRequestId: prRow.id,
      marks: {
        baselineSha: marks.baselineSha,
        headSha: marks.headSha,
        files: projectMarkedFiles(marks.files),
      },
      refs,
    })
    .catch((error: unknown) => {
      if (error instanceof InvalidArtifactBodyError) {
        return throwFileError(name, error.message);
      }
      throw error;
    });
  run.log(`marks ${name}`);
}

export async function writeComparisonMarks(
  run: IngestRun,
  comparisonNames: readonly string[],
  revchangesNames: readonly string[],
  stemIndex: ReadonlyMap<string, PullRequestRow | null>,
): Promise<number> {
  let marksCount = 0;
  const briefLists: BriefListCache = new Map();

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

    await writeMarksRow(run, name, briefLists, resolved.row, {
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

    await writeMarksRow(run, name, briefLists, resolved.row, {
      baselineSha: parsed.data.prevHeadSha,
      headSha: parsed.data.headSha,
      files: parsed.data.files,
    });
    marksCount += 1;
  }

  return marksCount;
}
