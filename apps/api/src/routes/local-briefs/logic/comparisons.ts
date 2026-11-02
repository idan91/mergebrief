import {
  LocalBriefKinds,
  type LocalBriefSummary,
  type LocalComparisonAvailability,
  type LocalLastReviewAvailability,
  type LocalPreviousBriefAvailability,
} from "contract";
import { ComparisonBaselineLabels, type Mutable } from "types";
import { SHORT_SHA_LENGTH } from "../consts";
import {
  DeltaRecordKinds,
  type ComparisonMarksEntry,
  type ComparisonSources,
  type RevisionChangesEntry,
} from "../types";

/**
 * The sidecar stem: the id minus the categorizer's `_<index>_<sha8>` suffix.
 * Rebuilding it from repo and number is ambiguous for hyphenated repo names.
 */
export function deriveBriefStem(
  summary: LocalBriefSummary,
): string | undefined {
  if (summary.index === undefined) {
    return undefined;
  }
  const shortSha = summary.sha.slice(0, SHORT_SHA_LENGTH);
  const suffix = `_${summary.index}_${shortSha}`;
  const stem = summary.id.slice(0, -suffix.length);
  const hasStem = summary.id.endsWith(suffix) && stem !== "";
  return hasStem ? stem : undefined;
}

/** A legacy sidecar uses the brief's own id where marks use a label-keyed one. */
function findLegacyPreviousBrief(
  summary: LocalBriefSummary,
  legacy: readonly RevisionChangesEntry[],
): LocalPreviousBriefAvailability | undefined {
  const entry = legacy.find((candidate) => {
    const ownsLegacy =
      candidate.id === summary.id && candidate.headSha === summary.sha;
    return ownsLegacy;
  });
  if (entry === undefined) {
    return undefined;
  }
  return {
    marksId: summary.id,
    baselineSha: entry.prevHeadSha,
    baselineIndex: entry.prevIndex,
  };
}

function findPreviousBrief(
  summary: LocalBriefSummary,
  marksForHead: readonly ComparisonMarksEntry[],
  sources: ComparisonSources,
): LocalPreviousBriefAvailability | undefined {
  const marks = marksForHead.find(
    (mark) => mark.baselineLabel === ComparisonBaselineLabels.PREVIOUS_BRIEF,
  );
  if (marks === undefined || marks.baselineIndex === null) {
    return findLegacyPreviousBrief(summary, sources.legacy);
  }

  const previousBrief: Mutable<LocalPreviousBriefAvailability> = {
    marksId: marks.id,
    baselineSha: marks.baselineSha,
    baselineIndex: marks.baselineIndex,
  };
  if (sources.narrativeIds.has(summary.id)) {
    previousBrief.narrativeId = summary.id;
  }
  return previousBrief;
}

function isDeltaForSpan(
  artifact: LocalBriefSummary,
  headSha: string,
  baselineSha: string,
): boolean {
  const spansMatch =
    artifact.headSha === headSha && artifact.baselineSha === baselineSha;
  const isMatchingDelta =
    artifact.artifactKind === LocalBriefKinds.DELTA && spansMatch;
  return isMatchingDelta;
}

function findLastReview(
  summary: LocalBriefSummary,
  marksForHead: readonly ComparisonMarksEntry[],
  sources: ComparisonSources,
): LocalLastReviewAvailability | undefined {
  const marks = marksForHead.find(
    (mark) => mark.baselineLabel === ComparisonBaselineLabels.CHECKPOINT,
  );
  if (marks === undefined) {
    return undefined;
  }

  const lastReview: Mutable<LocalLastReviewAvailability> = {
    marksId: marks.id,
    baselineSha: marks.baselineSha,
    baselineIndex: marks.baselineIndex,
  };
  const delta = sources.summaries.find((artifact) =>
    isDeltaForSpan(artifact, summary.sha, marks.baselineSha),
  );
  if (delta !== undefined) {
    lastReview.deltaId = delta.id;
  }
  const record = sources.deltaRecords.find((entry) => {
    const spansMatch =
      entry.headSha === summary.sha && entry.baselineSha === marks.baselineSha;
    return spansMatch;
  });
  if (record?.kind === DeltaRecordKinds.SKIPPED) {
    lastReview.deltaSkipped = true;
  }
  if (record?.kind === DeltaRecordKinds.UNCHANGED) {
    lastReview.deltaUnchanged = true;
  }
  return lastReview;
}

/**
 * The marks are the source of truth for availability; a narrative or Delta
 * is optional context. Matching the `stem_` prefix, not the head alone,
 * keeps two PRs that share a head SHA apart.
 */
export function buildComparisonAvailability(
  summary: LocalBriefSummary,
  sources: ComparisonSources,
): LocalComparisonAvailability | undefined {
  const stem = deriveBriefStem(summary);
  if (stem === undefined) {
    return undefined;
  }

  const prefix = `${stem}_`;
  const marksForHead = sources.marks.filter((mark) => {
    const marksThisHead =
      mark.headSha === summary.sha && mark.id.startsWith(prefix);
    return marksThisHead;
  });
  const comparisons: Mutable<LocalComparisonAvailability> = {};
  const previousBrief = findPreviousBrief(summary, marksForHead, sources);
  if (previousBrief !== undefined) {
    comparisons.previousBrief = previousBrief;
  }
  const lastReview = findLastReview(summary, marksForHead, sources);
  if (lastReview !== undefined) {
    comparisons.lastReview = lastReview;
  }

  const hasComparison = previousBrief !== undefined || lastReview !== undefined;
  return hasComparison ? comparisons : undefined;
}

export function attachComparisons(
  summary: LocalBriefSummary,
  sources: ComparisonSources,
): LocalBriefSummary {
  if (summary.artifactKind !== LocalBriefKinds.BRIEF) {
    return summary;
  }
  const comparisons = buildComparisonAvailability(summary, sources);
  if (comparisons === undefined) {
    return summary;
  }
  return { ...summary, comparisons };
}
