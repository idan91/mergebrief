import {
  detectChunkOverlaps,
  parseChangedRanges,
  splitDiffByFile,
  validateMarksNarrativeCoverage,
  validateNarrativeGroups,
  validateNarrativeMarksOverlap,
  validatePartition,
} from "brief-core";
import {
  isSpanUnchanged,
  readChangeRuns,
  type ChangeRun,
} from "brief-core/pr-span";
import type { LineRange } from "brief-core/types";
import type {
  DeltaEvalProperty,
  DeltaRun,
  NarrativeEvalProperty,
  NarrativeRun,
} from "./revision-runs";

/**
 * The revision narrative and Delta Brief predicates a pair case opts into
 * through `narrativeProperties` and `deltaProperties`. Each re-runs the
 * pipeline's own warn-only checks as a pass or fail; none judges the prose.
 */

function listSpanFiles(span: string): Set<string> {
  return new Set(splitDiffByFile(span).map((fileDiff) => fileDiff.file));
}

function formatRunKey(run: ChangeRun): string {
  return `${run.oldStart}:${run.newStart}:${run.lines.join("\n")}`;
}

/** Per file, the between-heads runs the filter dropped: base noise, not the PR's change. */
function readBaseNoise(
  filteredSpan: string,
  unfilteredSpan: string,
): Map<string, ChangeRun[]> {
  const kept = new Map<string, Set<string>>();
  for (const { file, patch } of splitDiffByFile(filteredSpan)) {
    const keys = readChangeRuns(patch).map(formatRunKey);
    kept.set(file, new Set(keys));
  }

  const noise = new Map<string, ChangeRun[]>();
  for (const { file, patch } of splitDiffByFile(unfilteredSpan)) {
    const keptKeys = kept.get(file) ?? new Set<string>();
    const dropped = readChangeRuns(patch).filter(
      (run) => !keptKeys.has(formatRunKey(run)),
    );
    noise.set(file, dropped);
  }
  return noise;
}

/**
 * A new-side range replays a run when it holds one of the run's added
 * lines or, for a pure deletion, both lines around the point it sits
 * before; a range ending on either neighbour alone is the PR's own line.
 */
function replaysRun(range: LineRange, run: ChangeRun): boolean {
  if (run.added > 0) {
    const lastAdded = run.newStart + run.added - 1;
    return range.start <= lastAdded && range.end >= run.newStart;
  }
  return range.start < run.newStart && run.newStart <= range.end;
}

/** An old-side range replays a run when it holds one of the lines the run removed. */
function replaysRemovedLines(range: LineRange, run: ChangeRun): boolean {
  if (run.removed === 0) {
    return false;
  }
  const lastRemoved = run.oldStart + run.removed - 1;
  return range.start <= lastRemoved && range.end >= run.oldStart;
}

interface SpanChunk {
  file: string;
  addedRanges: readonly LineRange[];
  /** Previous-head coordinates. */
  removedRanges: readonly LineRange[];
}

/** Every chunk sits in a file of the filtered span and holds no base-noise line, added or removed. */
function isReplayFree(
  chunks: readonly SpanChunk[],
  run: { filteredSpan: string; unfilteredSpan: string },
): boolean {
  const spanFiles = listSpanFiles(run.filteredSpan);
  const noise = readBaseNoise(run.filteredSpan, run.unfilteredSpan);
  return chunks.every((chunk) => {
    const fileNoise = noise.get(chunk.file) ?? [];
    const replaysAdded = chunk.addedRanges.some((range) =>
      fileNoise.some((noiseRun) => replaysRun(range, noiseRun)),
    );
    const replaysRemoved = chunk.removedRanges.some((range) =>
      fileNoise.some((noiseRun) => replaysRemovedLines(range, noiseRun)),
    );
    return spanFiles.has(chunk.file) && !replaysAdded && !replaysRemoved;
  });
}

/** A no-change record holds no chunks, so every chunk predicate reads it as none. */
function listNarrativeChunks(run: NarrativeRun) {
  if (run.narrative.artifactKind === "revisionNarrativeUnchanged") {
    return [];
  }
  return run.narrative.chunks;
}

function readDeltaContent(run: DeltaRun) {
  if ("artifactKind" in run.delta) {
    return { changedGroups: [], chunks: [], commentsAddressed: "" };
  }
  return run.delta;
}

export const narrativeNoChange: NarrativeEvalProperty = {
  id: "narrative-no-change",
  description:
    "an empty span writes the no-change record with no model call, any other span a narrative",
  check: (run) => {
    const isRecord =
      run.narrative.artifactKind === "revisionNarrativeUnchanged";
    if (!isSpanUnchanged(run.filteredSpan)) {
      return !isRecord;
    }
    return isRecord && run.modelCalls === 0;
  },
};

export const deltaNoChange: DeltaEvalProperty = {
  id: "delta-no-change",
  description:
    "an empty span writes the no-change record with no model call, any other span a delta",
  check: (run) => {
    const isRecord = "artifactKind" in run.delta;
    if (!isSpanUnchanged(run.filteredSpan)) {
      return !isRecord;
    }
    return isRecord && run.modelCalls === 0;
  },
};

export const narrativeGrounded: NarrativeEvalProperty = {
  id: "narrative-grounded",
  description:
    "every narrative chunk names a group of the brief and overlaps a comparison mark",
  check: (run) => {
    const chunks = listNarrativeChunks(run);
    const groupIssues = validateNarrativeGroups(chunks, run.brief.changeGroups);
    const markIssues = validateNarrativeMarksOverlap(chunks, run.marksFiles);
    return groupIssues.length === 0 && markIssues.length === 0;
  },
};

export const narrativeCoversSpan: NarrativeEvalProperty = {
  id: "narrative-covers-span",
  description:
    "every comparison mark of the filtered span has a narrative chunk",
  check: (run) =>
    validateMarksNarrativeCoverage(run.marksFiles, listNarrativeChunks(run))
      .length === 0,
};

export const narrativeNoReplay: NarrativeEvalProperty = {
  id: "narrative-no-replay",
  description:
    "every narrative chunk, as the model wrote it, sits in a file of the filtered span and on no base-noise line",
  check: (run) => isReplayFree(run.modelChunks, run),
};

export const deltaGrounded: DeltaEvalProperty = {
  id: "delta-grounded",
  description:
    "the delta names no unknown group, partitions its chunks and claims no line twice",
  check: (run) => {
    const { changedGroups, chunks } = readDeltaContent(run);
    const partitionIssues = validatePartition(changedGroups, chunks);
    const overlapIssues = detectChunkOverlaps(chunks);
    return (
      run.unknownGroupChunkIds.length === 0 &&
      partitionIssues.length === 0 &&
      overlapIssues.length === 0
    );
  },
};

export const deltaNoReplay: DeltaEvalProperty = {
  id: "delta-no-replay",
  description:
    "every delta chunk, as the model wrote it, sits in a file of the filtered span and on no base-noise line",
  check: (run) => isReplayFree(run.modelChunks, run),
};

export const deltaCoversSpan: DeltaEvalProperty = {
  id: "delta-covers-span",
  description: "every comparison mark of the filtered span has a delta chunk",
  check: (run) => {
    const marksFiles = parseChangedRanges(run.filteredSpan);
    const { chunks } = readDeltaContent(run);
    return validateMarksNarrativeCoverage(marksFiles, chunks).length === 0;
  },
};

export const deltaCommentsFromInput: DeltaEvalProperty = {
  id: "delta-comments-from-input",
  description: "the delta addresses only review comments its input held",
  check: (run) => {
    const delta = readDeltaContent(run);
    const inputIds = new Set(run.reviewComments.map((comment) => comment.id));
    const namesOnlyInputIds = delta.chunks.every((chunk) =>
      chunk.addressesComments.every((id) => inputIds.has(id)),
    );
    const silentWithoutComments =
      inputIds.size > 0 || delta.commentsAddressed === "";
    return namesOnlyInputIds && silentWithoutComments;
  },
};

/** The narrative predicates a span case opts into whole. */
export const SPAN_NARRATIVE_PROPERTIES: readonly NarrativeEvalProperty[] = [
  narrativeNoChange,
  narrativeGrounded,
  narrativeCoversSpan,
  narrativeNoReplay,
];

/** The delta predicates a span case opts into whole. */
export const SPAN_DELTA_PROPERTIES: readonly DeltaEvalProperty[] = [
  deltaNoChange,
  deltaGrounded,
  deltaCoversSpan,
  deltaNoReplay,
  deltaCommentsFromInput,
];
