import { GeneratorWarningKinds, type GeneratorWarning } from "generators";
import type { ValueOf } from "types/utils";
import type { FileId, HunkId } from "../../diff/hunk-index/types";
import type { PartKey } from "../multi-call/types";

export const GenerationWarningKinds = {
  ...GeneratorWarningKinds,
  VALIDATION: "validation",
  REPO_INSTRUCTIONS_OMITTED: "repo-instructions-omitted",
  /** A hunk map item the resolver could not read: unknown file or group, a run past the file's last hunk. */
  HUNK_MAP_REJECTED: "hunk-map-rejected",
  /** A hunk or shortened file two groups claimed; the earlier group in reading order keeps it. */
  HUNK_MAP_LISTED_TWICE: "hunk-map-listed-twice",
  /** A hunk or shortened file no group claimed; its lines fall to the unattributed remainder. */
  HUNK_MAP_UNLISTED: "hunk-map-unlisted",
  /** A detail call's answer reached the output cap; the batch was split once into two halves. */
  DETAIL_CALL_CUT: "detail-call-cut",
  /** The single call's answer reached the output cap; the brief was re-run once as a multi-call run. */
  SINGLE_CALL_CUT: "single-call-cut",
} as const;
/** @public */
export type GenerationWarningKind = ValueOf<typeof GenerationWarningKinds>;

/** A warn-only check over the generated output that found issues. */
export interface ValidationWarning {
  kind: typeof GenerationWarningKinds.VALIDATION;
  check: string;
  issues: readonly string[];
}

export interface RepoInstructionsOmittedWarning {
  kind: typeof GenerationWarningKinds.REPO_INSTRUCTIONS_OMITTED;
  message: string;
}

export interface HunkMapRejectedWarning {
  kind: typeof GenerationWarningKinds.HUNK_MAP_REJECTED;
  message: string;
  /** The items as the model wrote them, each cut to a short span. */
  items: readonly string[];
}

export interface HunkMapListedTwiceWarning {
  kind: typeof GenerationWarningKinds.HUNK_MAP_LISTED_TWICE;
  message: string;
  hunkIds: readonly HunkId[];
  /** Shortened files, which the outline showed as one line and a group claims whole. */
  fileIds: readonly FileId[];
}

export interface HunkMapUnlistedWarning {
  kind: typeof GenerationWarningKinds.HUNK_MAP_UNLISTED;
  message: string;
  hunkIds: readonly HunkId[];
  fileIds: readonly FileId[];
}

export type HunkMapWarning =
  | HunkMapRejectedWarning
  | HunkMapListedTwiceWarning
  | HunkMapUnlistedWarning;

export interface DetailCallCutWarning {
  kind: typeof GenerationWarningKinds.DETAIL_CALL_CUT;
  message: string;
  partKey: PartKey;
}

export interface SingleCallCutWarning {
  kind: typeof GenerationWarningKinds.SINGLE_CALL_CUT;
  message: string;
}

export type OutputCutWarning = DetailCallCutWarning | SingleCallCutWarning;

export type GenerationWarning =
  | GeneratorWarning
  | ValidationWarning
  | RepoInstructionsOmittedWarning
  | HunkMapWarning
  | OutputCutWarning;

export interface WarningCollector {
  /** Records a warning the generator already logged. */
  recordGeneratorWarning: (warning: GeneratorWarning) => void;
  report: (
    warning: RepoInstructionsOmittedWarning | HunkMapWarning | OutputCutWarning,
  ) => void;
  /** Reports nothing for an empty issue list. */
  reportIssues: (check: string, issues: readonly string[]) => void;
  listWarnings: () => GenerationWarning[];
}
