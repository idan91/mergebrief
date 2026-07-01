import "@tanstack/react-start/server-only";

import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import type {
  AddressedReviewComment,
  Brief,
  BriefChunk,
  ComparisonAvailability,
  ComparisonMarksSummary,
  DiffLine,
  LineRange,
  LocalBriefSummary,
  RevisionChanges,
} from "./types";
import {
  parseAddressedReviewComments,
  parseBrief,
  parseComparisonMarksSummary,
  parseDeltaBrief,
  parseRevisionChanges,
} from "./validation";

interface FileDiffSidecar {
  file: string;
  patch: string;
}

interface ParsedFileDiff {
  file: string;
  rows: DiffLine[];
}

const OUT_DIR = resolve(process.cwd(), "../../tools/categorizer/out");
const BRIEF_ID_PATTERN = /^[A-Za-z0-9._-]+$/;
let localBriefSummaries: Promise<LocalBriefSummary[]> | undefined;

export async function listLocalBriefs(): Promise<LocalBriefSummary[]> {
  localBriefSummaries ??= readLocalBriefSummaries();
  return localBriefSummaries;
}

const COMPARISON_MARKS_SUFFIX = ".comparison.json";
const REVISION_NARRATIVE_SUFFIX = ".revision-narrative.json";

interface LocalComparisonMarksEntry extends ComparisonMarksSummary {
  /** Sidecar filename minus `.comparison.json` — the marks artifact id. */
  id: string;
}

async function readLocalBriefSummaries(): Promise<LocalBriefSummary[]> {
  const entries = await readdir(OUT_DIR);
  const briefIds = entries
    .flatMap((entry) => {
      if (entry.endsWith(".brief.json"))
        return [entry.slice(0, -".brief.json".length)];
      if (entry.endsWith(".delta.json"))
        return [entry.slice(0, -".delta.json".length)];
      return [];
    })
    .filter(isValidBriefId)
    .sort();

  const summaries = await Promise.all(
    briefIds.map(async (briefId) => {
      const brief = await readBriefFile(briefId);
      return {
        id: briefId,
        artifactKind: brief.artifactKind,
        repo: brief.pr.repo,
        number: brief.pr.number,
        title: brief.pr.title,
        sha: brief.pr.sha,
        ...(brief.index != null ? { index: brief.index } : {}),
        ...(brief.baselineSha ? { baselineSha: brief.baselineSha } : {}),
        ...(brief.headSha ? { headSha: brief.headSha } : {}),
        ...(brief.baselineIndex != null
          ? { baselineIndex: brief.baselineIndex }
          : {}),
        ...(brief.headIndex != null ? { headIndex: brief.headIndex } : {}),
      } satisfies LocalBriefSummary;
    }),
  );

  const marks = await readLocalComparisonMarksEntries(entries);
  const narrativeIds = new Set(
    entries
      .filter((entry) => entry.endsWith(REVISION_NARRATIVE_SUFFIX))
      .map((entry) => entry.slice(0, -REVISION_NARRATIVE_SUFFIX.length)),
  );

  return summaries.map((summary) => {
    if (summary.artifactKind !== "brief") return summary;
    const comparisons = buildComparisonAvailability(
      summary,
      summaries,
      marks,
      narrativeIds,
    );
    return comparisons ? { ...summary, comparisons } : summary;
  });
}

/**
 * Read and validate every `.comparison.json` sidecar's header fields (ADR
 * 0024). A malformed sidecar is skipped, not fatal — same fail-closed
 * discipline as `readRevisionChanges`: a marks-scanning glitch degrades
 * comparison availability rather than the whole listing.
 */
async function readLocalComparisonMarksEntries(
  entries: string[],
): Promise<LocalComparisonMarksEntry[]> {
  const marksFiles = entries.filter((entry) =>
    entry.endsWith(COMPARISON_MARKS_SUFFIX),
  );
  const parsed = await Promise.all(
    marksFiles.map(async (entry) => {
      const id = entry.slice(0, -COMPARISON_MARKS_SUFFIX.length);
      let parsedJson: unknown;
      try {
        const raw = await readFile(resolve(OUT_DIR, entry), "utf8");
        parsedJson = JSON.parse(raw);
      } catch (error) {
        console.warn(
          `Ignoring unreadable comparison marks ${entry}: ${String(error)}`,
        );
        return null;
      }
      const result = parseComparisonMarksSummary(parsedJson);
      if (!result.ok) {
        console.warn(
          `Ignoring invalid comparison marks ${entry}: ${result.error}`,
        );
        return null;
      }
      return { id, ...result.value } satisfies LocalComparisonMarksEntry;
    }),
  );
  return parsed.filter(
    (entry): entry is LocalComparisonMarksEntry => entry !== null,
  );
}

/**
 * Derive the PR-stem prefix (`<owner>-<repo>-<number>`) a brief's marks/
 * narrative sidecars are named under, from its own id — `briefId(stem, index,
 * head)` in the categorizer is `${stem}_${index}_${head8}`, so stripping that
 * known suffix recovers `stem` without re-deriving it from `repo`/`number`
 * (repo names can themselves contain hyphens, which would make that
 * reconstruction ambiguous).
 */
function briefStemFromSummary(summary: LocalBriefSummary): string | undefined {
  if (summary.index == null) return undefined;
  const suffix = `_${summary.index}_${summary.sha.slice(0, 8)}`;
  return summary.id.endsWith(suffix)
    ? summary.id.slice(0, -suffix.length)
    : undefined;
}

/**
 * Comparison availability for one full-Brief summary (plan step 5): the
 * mechanical marks are the source of truth for availability; a narrative or
 * Delta artifact is optional extra context. `stem_` prefix matching (not just
 * a headSha match) guards against a same-headSha collision across PRs.
 */
function buildComparisonAvailability(
  summary: LocalBriefSummary,
  allSummaries: LocalBriefSummary[],
  marks: LocalComparisonMarksEntry[],
  narrativeIds: Set<string>,
): ComparisonAvailability | undefined {
  const stem = briefStemFromSummary(summary);
  if (!stem) return undefined;
  const prefix = `${stem}_`;
  const marksForHead = marks.filter(
    (mark) => mark.headSha === summary.sha && mark.id.startsWith(prefix),
  );

  const comparisons: ComparisonAvailability = {};

  const previousBriefMarks = marksForHead.find(
    (mark) => mark.baselineLabel === "previous-brief",
  );
  if (previousBriefMarks && previousBriefMarks.baselineIndex != null) {
    comparisons.previousBrief = {
      marksId: previousBriefMarks.id,
      ...(narrativeIds.has(summary.id) ? { narrativeId: summary.id } : {}),
      baselineSha: previousBriefMarks.baselineSha,
      baselineIndex: previousBriefMarks.baselineIndex,
    };
  }

  const checkpointMarks = marksForHead.find(
    (mark) => mark.baselineLabel === "checkpoint",
  );
  if (checkpointMarks) {
    const matchingDelta = allSummaries.find(
      (artifact) =>
        artifact.artifactKind === "delta" &&
        artifact.headSha === summary.sha &&
        artifact.baselineSha === checkpointMarks.baselineSha,
    );
    comparisons.lastReview = {
      marksId: checkpointMarks.id,
      ...(matchingDelta ? { deltaId: matchingDelta.id } : {}),
      baselineSha: checkpointMarks.baselineSha,
      baselineIndex: checkpointMarks.baselineIndex,
    };
  }

  return comparisons.previousBrief || comparisons.lastReview
    ? comparisons
    : undefined;
}

export async function readLocalBrief(briefId: string): Promise<Brief> {
  const brief = await readBriefFile(briefId);
  const withComments = await attachReviewComments(brief, briefId);
  return attachChunkDiffs(withComments, briefId);
}

/**
 * Read the revision-changes sidecar (ADR 0021) for a brief, or `null` when it is
 * absent (first brief) — never an error: the overlay must never block the brief.
 * A malformed sidecar fails closed (logged, treated as absent), so a generation
 * glitch degrades the overlay rather than the whole review.
 */
export async function readRevisionChanges(
  briefId: string,
): Promise<RevisionChanges | null> {
  assertValidBriefId(briefId);
  let raw: string;
  try {
    raw = await readFile(
      resolve(OUT_DIR, `${briefId}.revchanges.json`),
      "utf8",
    );
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return null;
    throw error;
  }
  try {
    const parsed = parseRevisionChanges(JSON.parse(raw));
    if (!parsed.ok) {
      console.warn(
        `Ignoring invalid revision-changes sidecar for ${briefId}: ${parsed.error}`,
      );
      return null;
    }
    return parsed.value;
  } catch (error) {
    console.warn(
      `Ignoring unreadable revision-changes sidecar for ${briefId}: ${String(error)}`,
    );
    return null;
  }
}

async function readBriefFile(briefId: string): Promise<Brief> {
  assertValidBriefId(briefId);
  try {
    const raw = await readFile(
      resolve(OUT_DIR, `${briefId}.brief.json`),
      "utf8",
    );
    const parsedJson: unknown = JSON.parse(raw);
    const parsedBrief = parseBrief(parsedJson);
    if (!parsedBrief.ok) {
      throw new Error(`Invalid local brief: ${parsedBrief.error}`);
    }
    return parsedBrief.value;
  } catch (error) {
    if (!isNodeError(error) || error.code !== "ENOENT") throw error;
  }

  const raw = await readFile(resolve(OUT_DIR, `${briefId}.delta.json`), "utf8");
  const parsedJson: unknown = JSON.parse(raw);
  const parsedDelta = parseDeltaBrief(parsedJson);
  if (!parsedDelta.ok) {
    throw new Error(`Invalid local delta: ${parsedDelta.error}`);
  }
  return parsedDelta.value;
}

function assertValidBriefId(briefId: string): void {
  if (!isValidBriefId(briefId)) {
    throw new Error(`Invalid brief id: ${briefId}`);
  }
}

function isValidBriefId(briefId: string): boolean {
  return BRIEF_ID_PATTERN.test(briefId);
}

async function attachChunkDiffs(brief: Brief, briefId: string): Promise<Brief> {
  const fileDiffs = await readFileDiffs(briefId, brief.artifactKind);
  if (fileDiffs.size === 0) return brief;

  return {
    ...brief,
    chunks: brief.chunks.map((chunk) => {
      const fileDiff = fileDiffs.get(chunk.file);
      if (!fileDiff) return chunk;
      return {
        ...chunk,
        diff: sliceChunkDiff(fileDiff.rows, chunk),
      } satisfies BriefChunk;
    }),
  };
}

async function attachReviewComments(
  brief: Brief,
  briefId: string,
): Promise<Brief> {
  const reviewComments = await readReviewComments(briefId, brief.artifactKind);
  if (reviewComments === undefined) return brief;
  return {
    ...brief,
    reviewComments,
  };
}

async function readReviewComments(
  briefId: string,
  artifactKind: Brief["artifactKind"],
): Promise<AddressedReviewComment[] | undefined> {
  const suffix =
    artifactKind === "delta" ? ".delta.comments.json" : ".comments.json";
  let raw: string;
  try {
    raw = await readFile(resolve(OUT_DIR, `${briefId}${suffix}`), "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return undefined;
    throw error;
  }
  const parsedJson: unknown = JSON.parse(raw);
  const parsedComments = parseAddressedReviewComments(parsedJson);
  if (!parsedComments.ok) {
    throw new Error(`Invalid comments sidecar: ${parsedComments.error}`);
  }
  return parsedComments.value;
}

async function readFileDiffs(
  briefId: string,
  artifactKind: Brief["artifactKind"],
): Promise<Map<string, ParsedFileDiff>> {
  const suffix = artifactKind === "delta" ? ".delta.diffs.json" : ".diffs.json";
  const raw = await readFile(resolve(OUT_DIR, `${briefId}${suffix}`), "utf8");
  const parsedJson: unknown = JSON.parse(raw);
  if (!Array.isArray(parsedJson)) {
    throw new Error("Invalid diffs sidecar: expected an array");
  }

  const diffs = new Map<string, ParsedFileDiff>();
  for (const item of parsedJson) {
    if (!isFileDiffSidecar(item)) {
      throw new Error("Invalid diffs sidecar: expected file and patch strings");
    }
    diffs.set(item.file, {
      file: item.file,
      rows: parseUnifiedDiffPatch(item.patch),
    });
  }
  return diffs;
}

function isFileDiffSidecar(value: unknown): value is FileDiffSidecar {
  return (
    typeof value === "object" &&
    value !== null &&
    "file" in value &&
    "patch" in value &&
    typeof value.file === "string" &&
    typeof value.patch === "string"
  );
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function sliceChunkDiff(rows: DiffLine[], chunk: BriefChunk): DiffLine[] {
  const changedRows = rows.filter((row) => {
    if (row.kind === "add") return lineInRanges(row.newLine, chunk.addedRanges);
    if (row.kind === "del")
      return lineInRanges(row.oldLine, chunk.removedRanges);
    return false;
  });
  if (changedRows.length === 0) return [];

  const selected = new Set<DiffLine>();
  for (const changedRow of changedRows) {
    const index = rows.indexOf(changedRow);
    let hunkIndex = index;
    while (hunkIndex >= 0 && rows[hunkIndex]?.kind !== "hunk") {
      hunkIndex -= 1;
    }
    if (hunkIndex >= 0) {
      const hunk = rows[hunkIndex];
      if (hunk) selected.add(hunk);
    }
    for (let offset = -2; offset <= 2; offset += 1) {
      const row = rows[index + offset];
      if (
        row &&
        (row.kind === "ctx" ||
          row.kind === "add" ||
          row.kind === "del" ||
          row.kind === "note")
      ) {
        selected.add(row);
      }
    }
  }

  return rows.filter((row) => selected.has(row));
}

function lineInRanges(line: number | undefined, ranges: LineRange[]): boolean {
  return (
    typeof line === "number" &&
    ranges.some((range) => line >= range.start && line <= range.end)
  );
}

function parseUnifiedDiffPatch(patch: string): DiffLine[] {
  const rows: DiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;

  for (const line of patch.split("\n")) {
    if (
      line.startsWith("diff --git ") ||
      line.startsWith("--- ") ||
      line.startsWith("+++ ") ||
      line.startsWith("index ") ||
      line.startsWith("new file mode ") ||
      line.startsWith("deleted file mode ")
    ) {
      continue;
    }
    if (line.startsWith("@@")) {
      const parsedHunk = parseHunkLine(line);
      oldLine = parsedHunk.oldStart;
      newLine = parsedHunk.newStart;
      rows.push({ kind: "hunk", content: line });
      continue;
    }
    if (line.startsWith("\\ No newline")) {
      rows.push({ kind: "note", content: line });
      continue;
    }
    if (line.startsWith("+")) {
      rows.push({ kind: "add", content: line.slice(1), newLine });
      newLine += 1;
      continue;
    }
    if (line.startsWith("-")) {
      rows.push({ kind: "del", content: line.slice(1), oldLine });
      oldLine += 1;
      continue;
    }
    rows.push({
      kind: "ctx",
      content: line.startsWith(" ") ? line.slice(1) : line,
      oldLine,
      newLine,
    });
    oldLine += 1;
    newLine += 1;
  }

  return rows;
}

function parseHunkLine(line: string): { oldStart: number; newStart: number } {
  const match =
    /^@@ -(?<oldStart>\d+)(?:,\d+)? \+(?<newStart>\d+)(?:,\d+)? @@/.exec(line);
  return {
    oldStart: Number(match?.groups?.["oldStart"] ?? 0),
    newStart: Number(match?.groups?.["newStart"] ?? 0),
  };
}
