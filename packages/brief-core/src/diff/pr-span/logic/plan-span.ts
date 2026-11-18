import { FILES_PER_BASE_RENAME_CANDIDATE } from "../consts";
import {
  FileVerdicts,
  type BaseRenameCandidate,
  type BuiltSpanPlan,
  type ComparedFile,
  type LineDiffFile,
  type PrDiffPair,
} from "../types";
import { comparePrDiffs, settleBaseRenames } from "./compare-patches";

/** A file only both heads' blobs can settle: its content changed, or its context moved. */
function needsLineDiff(file: ComparedFile): boolean {
  return (
    file.verdict === FileVerdicts.CONTENT_CHANGED ||
    file.verdict === FileVerdicts.CONTEXT_MOVED
  );
}

/** A file that may read changed, so it counts against the file bound. */
function mayBeChanged(file: ComparedFile): boolean {
  return (
    needsLineDiff(file) ||
    file.verdict === FileVerdicts.HEADER_CHANGED ||
    file.verdict === FileVerdicts.CHANGE_RESHAPED_BY_BASE
  );
}

function hasBaseRenameVerdict(file: ComparedFile): boolean {
  return file.verdict === FileVerdicts.BASE_RENAMED;
}

/** Built field by field, so no patch text rides along to wherever the plan is read. */
function readLineDiffFile(file: ComparedFile): LineDiffFile {
  return {
    path: file.path,
    prevPath: file.prevPath,
    modeChange: file.modeChange,
    prev: { mode: file.prev?.mode },
    next: { mode: file.next?.mode },
  };
}

function readBaseRenameCandidate(file: ComparedFile): BaseRenameCandidate {
  const halves = settleBaseRenames([file], new Set<string>());
  return {
    path: file.path,
    prevPath: file.prevPath,
    refusedLineDiffFiles: halves.filter(needsLineDiff).map(readLineDiffFile),
  };
}

/**
 * The files a built span counts against its file bound, probes for a base
 * rename and line-diffs, from both heads' PR diffs alone.
 */
export function planBuiltSpan(input: PrDiffPair): BuiltSpanPlan {
  const compared = comparePrDiffs(input.prevPrDiff, input.newPrDiff);
  const candidates = compared.filter(hasBaseRenameVerdict);
  return {
    changedCount:
      compared.filter(mayBeChanged).length +
      candidates.length * FILES_PER_BASE_RENAME_CANDIDATE,
    lineDiffFiles: compared.filter(needsLineDiff).map(readLineDiffFile),
    baseRenameCandidates: candidates.map(readBaseRenameCandidate),
  };
}
