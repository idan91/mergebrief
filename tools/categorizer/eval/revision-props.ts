import {
  detectChunkOverlaps,
  splitDiffByFile,
  validateMarksNarrativeCoverage,
  validateNarrativeGroups,
  validateNarrativeMarksOverlap,
  validatePartition,
} from "brief-core";
import type { DeltaEvalProperty, NarrativeEvalProperty } from "./revision-runs";

/**
 * The revision narrative and Delta Brief predicates a pair case opts into
 * through `narrativeProperties` and `deltaProperties`. Each re-runs the
 * pipeline's own warn-only checks as a pass or fail; none judges the prose.
 */

function listSpanFiles(span: string): Set<string> {
  return new Set(splitDiffByFile(span).map((fileDiff) => fileDiff.file));
}

export const narrativeGrounded: NarrativeEvalProperty = {
  id: "narrative-grounded",
  description:
    "every narrative chunk names a group of the brief and overlaps a comparison mark",
  check: (run) => {
    const { chunks } = run.narrative;
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
    validateMarksNarrativeCoverage(run.marksFiles, run.narrative.chunks)
      .length === 0,
};

export const narrativeNoReplay: NarrativeEvalProperty = {
  id: "narrative-no-replay",
  description: "every narrative chunk sits in a file of the filtered span",
  check: (run) => {
    const spanFiles = listSpanFiles(run.filteredSpan);
    return run.narrative.chunks.every((chunk) => spanFiles.has(chunk.file));
  },
};

export const deltaGrounded: DeltaEvalProperty = {
  id: "delta-grounded",
  description:
    "the delta names no unknown group, partitions its chunks and claims no line twice",
  check: (run) => {
    const { changedGroups, chunks } = run.delta;
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
  description: "every delta chunk sits in a file of the filtered span",
  check: (run) => {
    const spanFiles = listSpanFiles(run.filteredSpan);
    return run.delta.chunks.every((chunk) => spanFiles.has(chunk.file));
  },
};

export const deltaCommentsFromInput: DeltaEvalProperty = {
  id: "delta-comments-from-input",
  description: "the delta addresses only review comments its input held",
  check: (run) => {
    const inputIds = new Set(run.reviewComments.map((comment) => comment.id));
    const namesOnlyInputIds = run.delta.chunks.every((chunk) =>
      chunk.addressesComments.every((id) => inputIds.has(id)),
    );
    const silentWithoutComments =
      inputIds.size > 0 || run.delta.commentsAddressed === "";
    return namesOnlyInputIds && silentWithoutComments;
  },
};
