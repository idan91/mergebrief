import "@tanstack/react-start/server-only";

import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

// ONE artifact store: the workspace-root-anchored dir generation writes to.
import { localBriefsDir, requireLocalBriefsDir } from "./outDir.server";
import type {
  AddressedReviewComment,
  Brief,
  ComparisonAvailability,
  ComparisonMarks,
  ComparisonMarksSummary,
  FileDiffPatch,
  LastReviewComparisonAvailability,
  LocalBriefSummary,
  PreviousBriefComparisonAvailability,
  RevisionChanges,
  RevisionNarrativeArtifact,
} from "../types";
import {
  parseAddressedReviewComments,
  parseBrief,
  parseComparisonMarks,
  parseComparisonMarksSummary,
  parseDeltaBrief,
  parseRevisionChanges,
  parseRevisionNarrativeArtifact,
} from "../utils/validation";
import { getServerLogger } from "../../../server/logger";
import {
  LocalBriefErrorCodes,
  type LocalBriefErrorCode,
} from "../utils/briefErrors";

const logger = getServerLogger();

/**
 * Log raw read failures and throw only curated browser-safe messages.
 * Never attach cause: TanStack serializes non-enumerable own properties too.
 */
class BriefReadError extends Error {}

/**
 * Routine outcomes, a link to a brief this instance doesn't have, or an id
 * that fails the charset guard. Both are what an id-guessing crawler
 * produces at whatever rate it likes, so they must not sustain an alertable
 * warn rate. A broken or unparsable artifact is different, that IS degraded.
 */
const ROUTINE_REASONS: ReadonlySet<string> = new Set<string>([
  LocalBriefErrorCodes.NOT_FOUND,
  LocalBriefErrorCodes.INVALID_ID,
]);

/**
 * Log the raw reason (server-side only) and throw the curated one. The raw
 * value rides as a structured FIELD, never interpolated into `msg`, the
 * logging boundary redacts and serializes fields, and `msg` bypasses that.
 */
function failRead(
  reason: LocalBriefErrorCode,
  context: string,
  raw: unknown,
): never {
  const fields = raw instanceof Error ? { err: raw } : { reason: String(raw) };
  if (ROUTINE_REASONS.has(reason)) {
    logger.info(context, fields);
  } else {
    logger.warn(context, fields);
  }
  throw new BriefReadError(reason);
}

const BRIEF_ID_PATTERN = /^[A-Za-z0-9._-]+$/;
let localBriefSummaries: Promise<LocalBriefSummary[]> | undefined;

export async function listLocalBriefs(): Promise<LocalBriefSummary[]> {
  localBriefSummaries ??= readLocalBriefSummaries();
  return localBriefSummaries;
}

const COMPARISON_MARKS_SUFFIX = ".comparison.json";
const REVISION_NARRATIVE_SUFFIX = ".revision-narrative.json";
const REVISION_CHANGES_SUFFIX = ".revchanges.json";

interface LocalComparisonMarksEntry extends ComparisonMarksSummary {
  /** Sidecar filename minus `.comparison.json`, the marks artifact id. */
  id: string;
}

async function readLocalBriefSummaries(): Promise<LocalBriefSummary[]> {
  // The surface off is zero local briefs, not a refusal to curate.
  const dir = localBriefsDir();
  if (dir === undefined) return [];
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (error) {
    // No out dir yet, a fresh checkout/container that never ran the local
    // generator. Zero local briefs, not a 500.
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return [];
    }
    return failRead(
      LocalBriefErrorCodes.UNREADABLE,
      "local brief directory not readable",
      error,
    );
  }
  const briefIds = entries
    .flatMap((entry) => {
      if (entry.endsWith(".brief.json"))
        return [entry.slice(0, -".brief.json".length)];
      if (entry.endsWith(".delta.json"))
        return [entry.slice(0, -".delta.json".length)];
      return [];
    })
    .filter(isValidBriefId)
    .toSorted();

  const parsedSummaries = await Promise.all(
    briefIds.map(async (briefId): Promise<LocalBriefSummary | null> => {
      // Fail-closed like every other reader in this file: one artifact that's
      // transiently unreadable or malformed degrades the listing (that brief
      // drops out), never crashes it for every other Brief in the demo dir.
      let brief: Brief;
      try {
        brief = await readBriefFile(briefId);
      } catch (error) {
        logger.warn(`Ignoring unreadable brief ${briefId}: ${String(error)}`);
        return null;
      }
      const summary: LocalBriefSummary = {
        id: briefId,
        artifactKind: brief.artifactKind,
        repo: brief.pr.repo,
        number: brief.pr.number,
        title: brief.pr.title,
        sha: brief.pr.sha,
      };

      if (brief.index !== undefined) summary.index = brief.index;
      if (brief.baselineSha) summary.baselineSha = brief.baselineSha;
      if (brief.headSha) summary.headSha = brief.headSha;
      if (brief.baselineIndex !== null && brief.baselineIndex !== undefined) {
        summary.baselineIndex = brief.baselineIndex;
      }
      if (brief.headIndex !== null && brief.headIndex !== undefined) {
        summary.headIndex = brief.headIndex;
      }

      return summary;
    }),
  );
  const summaries = parsedSummaries.filter(
    (summary): summary is LocalBriefSummary => summary !== null,
  );

  const marks = await readLocalComparisonMarksEntries(entries);
  const legacyRevisionChanges = await readLocalRevisionChangesEntries(entries);
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
      legacyRevisionChanges,
    );
    return comparisons ? { ...summary, comparisons } : summary;
  });
}

interface LegacyRevisionChangesEntry {
  /** Sidecar filename minus `.revchanges.json`, the owning brief's own id. */
  id: string;
  headSha: string;
  prevHeadSha: string;
  prevIndex: number;
}

/**
 * Legacy .revchanges.json headers still provide Previous Brief availability.
 * Their files shape matches ComparisonMarks; map headers on read without migration.
 * Skip malformed sidecars so a generation glitch cannot fail the review.
 */
async function readLocalRevisionChangesEntries(
  entries: string[],
): Promise<LegacyRevisionChangesEntry[]> {
  const revchangesFiles = entries.filter((entry) =>
    entry.endsWith(REVISION_CHANGES_SUFFIX),
  );
  const parsed = await Promise.all(
    revchangesFiles.map(async (entry) => {
      const id = entry.slice(0, -REVISION_CHANGES_SUFFIX.length);
      let parsedJson: unknown;
      try {
        const raw = await readFile(
          resolve(requireLocalBriefsDir(), entry),
          "utf8",
        );
        parsedJson = JSON.parse(raw);
      } catch (error) {
        logger.warn(
          `Ignoring unreadable revision-changes sidecar ${entry}: ${String(error)}`,
        );
        return null;
      }
      const result = parseRevisionChanges(parsedJson);
      if (!result.ok) {
        logger.warn(
          `Ignoring invalid revision-changes sidecar ${entry}: ${result.error}`,
        );
        return null;
      }
      return {
        id,
        headSha: result.value.headSha,
        prevHeadSha: result.value.prevHeadSha,
        prevIndex: result.value.prevIndex,
      } satisfies LegacyRevisionChangesEntry;
    }),
  );
  return parsed.filter(
    (entry): entry is LegacyRevisionChangesEntry => entry !== null,
  );
}

/**
 * Read and validate every `.comparison.json` sidecar's header fields. A
 * malformed sidecar is skipped, not fatal, same fail-closed
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
        const raw = await readFile(
          resolve(requireLocalBriefsDir(), entry),
          "utf8",
        );
        parsedJson = JSON.parse(raw);
      } catch (error) {
        logger.warn(
          `Ignoring unreadable comparison marks ${entry}: ${String(error)}`,
        );
        return null;
      }
      const result = parseComparisonMarksSummary(parsedJson);
      if (!result.ok) {
        logger.warn(
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
 * Strip the categorizer's known index/head suffix to recover the sidecar stem.
 * Reconstructing from repo and number is ambiguous when repo names contain hyphens.
 */
function briefStemFromSummary(summary: LocalBriefSummary): string | undefined {
  if (summary.index === undefined) return undefined;
  const suffix = `_${summary.index}_${summary.sha.slice(0, 8)}`;
  return summary.id.endsWith(suffix)
    ? summary.id.slice(0, -suffix.length)
    : undefined;
}

/**
 * Comparison availability for one full-Brief summary: the
 * mechanical marks are the source of truth for availability; a narrative or
 * Delta artifact is optional extra context. `stem_` prefix matching (not just
 * a headSha match) guards against a same-headSha collision across PRs.
 */
function buildComparisonAvailability(
  summary: LocalBriefSummary,
  allSummaries: LocalBriefSummary[],
  marks: LocalComparisonMarksEntry[],
  narrativeIds: Set<string>,
  legacyRevisionChanges: LegacyRevisionChangesEntry[],
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
  if (previousBriefMarks && previousBriefMarks.baselineIndex !== null) {
    const previousBrief: PreviousBriefComparisonAvailability = {
      marksId: previousBriefMarks.id,
      baselineSha: previousBriefMarks.baselineSha,
      baselineIndex: previousBriefMarks.baselineIndex,
    };

    if (narrativeIds.has(summary.id)) previousBrief.narrativeId = summary.id;

    comparisons.previousBrief = previousBrief;
  } else {
    // Legacy sidecars use the brief's own id rather than a label-keyed marks id.
    // readComparisonMarks maps their shared files shape; no legacy narrative exists.
    const legacy = legacyRevisionChanges.find(
      (entry) => entry.id === summary.id && entry.headSha === summary.sha,
    );
    if (legacy) {
      comparisons.previousBrief = {
        marksId: summary.id,
        baselineSha: legacy.prevHeadSha,
        baselineIndex: legacy.prevIndex,
      };
    }
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
    const lastReview: LastReviewComparisonAvailability = {
      marksId: checkpointMarks.id,
      baselineSha: checkpointMarks.baselineSha,
      baselineIndex: checkpointMarks.baselineIndex,
    };

    if (matchingDelta) lastReview.deltaId = matchingDelta.id;

    comparisons.lastReview = lastReview;
  }

  return comparisons.previousBrief || comparisons.lastReview
    ? comparisons
    : undefined;
}

/** The artifact with its comments; the diff rides separately, see `readLocalFileDiffs`. */
export async function readLocalBrief(briefId: string): Promise<Brief> {
  const brief = await readBriefFile(briefId);
  return attachReviewComments(brief, briefId);
}

/**
 * Read the revision-changes sidecar for a brief, or `null` when it is
 * absent (first brief), never an error: the overlay must never block the brief.
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
      resolve(requireLocalBriefsDir(), `${briefId}${REVISION_CHANGES_SUFFIX}`),
      "utf8",
    );
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return null;
    return failRead(
      LocalBriefErrorCodes.UNREADABLE,
      `unreadable revision-changes sidecar ${briefId}`,
      error,
    );
  }
  try {
    const parsed = parseRevisionChanges(JSON.parse(raw));
    if (!parsed.ok) {
      logger.warn(
        `Ignoring invalid revision-changes sidecar for ${briefId}: ${parsed.error}`,
      );
      return null;
    }
    return parsed.value;
  } catch (error) {
    logger.warn(
      `Ignoring unreadable revision-changes sidecar for ${briefId}: ${String(error)}`,
    );
    return null;
  }
}

/**
 * Absent or malformed sidecars degrade the overlay without failing the review.
 * Marks ids include the label so checkpoint and previous-brief files cannot collide.
 */
export async function readComparisonMarks(
  marksId: string,
): Promise<ComparisonMarks | null> {
  assertValidBriefId(marksId);
  let raw: string;
  try {
    raw = await readFile(
      resolve(requireLocalBriefsDir(), `${marksId}${COMPARISON_MARKS_SUFFIX}`),
      "utf8",
    );
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return readLegacyRevisionChangesAsMarks(marksId);
    }
    return failRead(
      LocalBriefErrorCodes.UNREADABLE,
      `unreadable comparison marks ${marksId}`,
      error,
    );
  }
  try {
    const parsed = parseComparisonMarks(JSON.parse(raw));
    if (!parsed.ok) {
      logger.warn(
        `Ignoring invalid comparison marks for ${marksId}: ${parsed.error}`,
      );
      return null;
    }
    return parsed.value;
  } catch (error) {
    logger.warn(
      `Ignoring unreadable comparison marks for ${marksId}: ${String(error)}`,
    );
    return null;
  }
}

/**
 * Availability supplies a legacy marksId only when that sidecar backs Previous Brief.
 * The files shape is shared; remap the header and supply the previous-brief label.
 */
async function readLegacyRevisionChangesAsMarks(
  marksId: string,
): Promise<ComparisonMarks | null> {
  const revisionChanges = await readRevisionChanges(marksId);
  if (!revisionChanges) return null;
  return {
    baselineSha: revisionChanges.prevHeadSha,
    headSha: revisionChanges.headSha,
    baselineLabel: "previous-brief",
    baselineIndex: revisionChanges.prevIndex,
    files: revisionChanges.files,
  } satisfies ComparisonMarks;
}

/**
 * Read a `.revision-narrative.json` artifact by its narrative id,
 * a real narrative or a skip stub, discriminated by `artifactKind`. `null` when
 * absent (generation failed: marks still render with "summary unavailable") or
 * malformed. The id is the sidecar filename minus `.revision-narrative.json`.
 */
export async function readRevisionNarrative(
  narrativeId: string,
): Promise<RevisionNarrativeArtifact | null> {
  assertValidBriefId(narrativeId);
  let raw: string;
  try {
    raw = await readFile(
      resolve(
        requireLocalBriefsDir(),
        `${narrativeId}${REVISION_NARRATIVE_SUFFIX}`,
      ),
      "utf8",
    );
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return null;
    return failRead(
      LocalBriefErrorCodes.UNREADABLE,
      `unreadable revision narrative ${narrativeId}`,
      error,
    );
  }
  try {
    const parsed = parseRevisionNarrativeArtifact(JSON.parse(raw));
    if (!parsed.ok) {
      logger.warn(
        `Ignoring invalid revision narrative for ${narrativeId}: ${parsed.error}`,
      );
      return null;
    }
    return parsed.value;
  } catch (error) {
    logger.warn(
      `Ignoring unreadable revision narrative for ${narrativeId}: ${String(error)}`,
    );
    return null;
  }
}

async function readBriefFile(briefId: string): Promise<Brief> {
  assertValidBriefId(briefId);
  try {
    const raw = await readFile(
      resolve(requireLocalBriefsDir(), `${briefId}.brief.json`),
      "utf8",
    );
    const parsedJson: unknown = JSON.parse(raw);
    const parsedBrief = parseBrief(parsedJson, logger);
    if (!parsedBrief.ok) {
      return failRead(
        LocalBriefErrorCodes.UNREADABLE,
        `invalid local brief ${briefId}`,
        parsedBrief.error,
      );
    }
    return parsedBrief.value;
  } catch (error) {
    if (error instanceof BriefReadError) throw error;
    if (!isNodeError(error) || error.code !== "ENOENT") {
      return failRead(
        LocalBriefErrorCodes.UNREADABLE,
        `unreadable local brief ${briefId}`,
        error,
      );
    }
  }

  let raw: string;
  try {
    raw = await readFile(
      resolve(requireLocalBriefsDir(), `${briefId}.delta.json`),
      "utf8",
    );
  } catch (error) {
    // Neither artifact exists: a plain not-found, NOT the raw ENOENT whose
    // message names the container's absolute out-dir path.
    return failRead(
      isNodeError(error) && error.code === "ENOENT"
        ? LocalBriefErrorCodes.NOT_FOUND
        : LocalBriefErrorCodes.UNREADABLE,
      `local brief ${briefId} not readable`,
      error,
    );
  }
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch (error) {
    return failRead(
      LocalBriefErrorCodes.UNREADABLE,
      `invalid local delta JSON ${briefId}`,
      error,
    );
  }
  const parsedDelta = parseDeltaBrief(parsedJson);
  if (!parsedDelta.ok) {
    return failRead(
      LocalBriefErrorCodes.UNREADABLE,
      `invalid local delta ${briefId}`,
      parsedDelta.error,
    );
  }
  return parsedDelta.value;
}

function assertValidBriefId(briefId: string): void {
  if (!isValidBriefId(briefId)) {
    // The id is caller-supplied: echoing it back would reflect arbitrary
    // input into the page. Logged, never returned.
    failRead(LocalBriefErrorCodes.INVALID_ID, "invalid brief id", briefId);
  }
}

function isValidBriefId(briefId: string): boolean {
  return BRIEF_ID_PATTERN.test(briefId);
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
    raw = await readFile(
      resolve(requireLocalBriefsDir(), `${briefId}${suffix}`),
      "utf8",
    );
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return undefined;
    return failRead(
      LocalBriefErrorCodes.UNREADABLE,
      `unreadable comments sidecar ${briefId}`,
      error,
    );
  }
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch (error) {
    return failRead(
      LocalBriefErrorCodes.UNREADABLE,
      `invalid comments sidecar JSON ${briefId}`,
      error,
    );
  }
  const parsedComments = parseAddressedReviewComments(parsedJson);
  if (!parsedComments.ok) {
    return failRead(
      LocalBriefErrorCodes.UNREADABLE,
      `invalid comments sidecar ${briefId}`,
      parsedComments.error,
    );
  }
  return parsedComments.value;
}

const DIFFS_SUFFIXES = [".diffs.json", ".delta.diffs.json"] as const;

/**
 * The diffs sidecar as per-file patches, unparsed: the client slices every
 * chunk and expands hunk edges from the same rows, so it parses once there.
 * An id names one artifact, so one of the two sidecar names exists at most.
 */
export async function readLocalFileDiffs(
  briefId: string,
): Promise<FileDiffPatch[]> {
  assertValidBriefId(briefId);
  const raw = await readDiffsSidecar(briefId);
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch (error) {
    return failRead(
      LocalBriefErrorCodes.UNREADABLE,
      `invalid diffs sidecar JSON ${briefId}`,
      error,
    );
  }
  if (!Array.isArray(parsedJson)) {
    return failRead(
      LocalBriefErrorCodes.UNREADABLE,
      `invalid diffs sidecar ${briefId}`,
      "expected an array",
    );
  }

  const patches: FileDiffPatch[] = [];
  for (const item of parsedJson) {
    if (!isFileDiffPatch(item)) {
      return failRead(
        LocalBriefErrorCodes.UNREADABLE,
        `invalid diffs sidecar ${briefId}`,
        "expected file and patch strings",
      );
    }
    patches.push({ file: item.file, patch: item.patch });
  }
  return patches;
}

async function readDiffsSidecar(briefId: string): Promise<string> {
  for (const suffix of DIFFS_SUFFIXES) {
    try {
      return await readFile(
        resolve(requireLocalBriefsDir(), `${briefId}${suffix}`),
        "utf8",
      );
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") continue;
      return failRead(
        LocalBriefErrorCodes.UNREADABLE,
        `unreadable diffs sidecar ${briefId}`,
        error,
      );
    }
  }

  // The diffs sidecar is written with the brief; a missing one is a broken
  // artifact set, not a missing brief, but either way the browser must not
  // learn the out-dir path.
  return failRead(
    LocalBriefErrorCodes.UNREADABLE,
    `missing diffs sidecar ${briefId}`,
    "no diffs sidecar under either name",
  );
}

function isFileDiffPatch(value: unknown): value is FileDiffPatch {
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
