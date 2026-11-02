import type { Result, ValueOf } from "types/utils";
import type { Hop } from "../remap";
import type { LineDiffRunner } from "./logic/line-diff";

export const PrSpanFailureKinds = {
  TRANSIENT: "transient",
  TOO_LARGE: "too-large",
  UNAVAILABLE: "unavailable",
} as const;
export type PrSpanFailureKind = ValueOf<typeof PrSpanFailureKinds>;

/** Why no span: retry it, GitHub or the bound refuses its size, or a head cannot be read. */
export interface PrSpanFailure {
  readonly kind: PrSpanFailureKind;
}

export const BlobReadKinds = {
  TEXT: "text",
  ABSENT: "absent",
  UNREADABLE: "unreadable",
} as const;

/** A file at one head: its text, no file at that path, or bytes no line diff can read. */
export type BlobRead =
  | { readonly kind: typeof BlobReadKinds.TEXT; readonly content: string }
  | { readonly kind: typeof BlobReadKinds.ABSENT }
  | { readonly kind: typeof BlobReadKinds.UNREADABLE };

/** The two heads of a revision span, each with the base its own Brief was read against. */
export interface PrSpanRefs {
  readonly prevBase: string;
  readonly prevHead: string;
  readonly newBase: string;
  readonly newHead: string;
}

export interface PrDiffRef {
  readonly base: string;
  readonly head: string;
}

export interface BlobRef {
  readonly path: string;
  readonly ref: string;
  /** A blob past this size reads as unreadable, before decode. */
  readonly maxBytes: number;
}

/**
 * What a span read needs from GitHub; each adapter maps its own errors to
 * the failure kinds. An aborted `signal` rejects with the signal's reason,
 * never a failure kind: a superseded run must not read as retryable.
 */
export interface PrSpanSource {
  fetchPrDiff(
    span: PrDiffRef,
    signal: AbortSignal,
  ): Promise<Result<string, PrSpanFailure>>;
  fetchBlob(
    blob: BlobRef,
    signal: AbortSignal,
  ): Promise<Result<BlobRead, PrSpanFailure>>;
  /** The full SHA a `base...head` diff is taken from; heads with no common history read `unavailable`. */
  fetchMergeBase(
    span: PrDiffRef,
    signal: AbortSignal,
  ): Promise<Result<string, PrSpanFailure>>;
}

export const BetweenHeadsKinds = {
  PATCH: "patch",
  UNREADABLE: "unreadable",
} as const;

/** Both heads' text of a line-diffed file; a side is absent where the file is. */
export interface HeadTexts {
  readonly prevContent?: string | undefined;
  readonly newContent?: string | undefined;
}

/**
 * One changed file's diff from the previous head to the new head, or no
 * line diff for it. `texts` lets the filter test where a run could slide;
 * without them a run is tested where the patch placed it.
 */
export type BetweenHeadsFile =
  | {
      readonly kind: typeof BetweenHeadsKinds.PATCH;
      readonly patch: string;
      readonly texts?: HeadTexts;
    }
  | { readonly kind: typeof BetweenHeadsKinds.UNREADABLE };

/** Both heads' PR diffs, each `base...head` as the compare endpoint serves it. */
export interface PrDiffPair {
  readonly prevPrDiff: string;
  readonly newPrDiff: string;
}

export interface PrSpanInput extends PrDiffPair {
  /** Keyed by the file's path at the new head; a file `readPrSpan` line-diffs with no entry is unreadable and reads changed. */
  readonly betweenHeads: ReadonlyMap<string, BetweenHeadsFile>;
  /** New-head paths of base renames confirmed by absence at the swapped paths; any other candidate reads as two changed files. */
  readonly baseRenames?: ReadonlySet<string>;
}

export interface FastForwardSpanInput {
  /** `prevHead...newHead`: on a fast-forward, every commit the push added. */
  readonly betweenHeadsDiff: string;
  readonly newPrDiff: string;
}

/**
 * The PR's own change between two heads. `filteredDiff` keeps the
 * between-heads hunks that touch either head's PR change; the hop carries
 * every file of either PR diff under its previous-head path.
 */
export interface PrSpan {
  /** Paths at the new head. */
  readonly changedFiles: readonly string[];
  readonly unchangedFiles: readonly string[];
  /** Files whose hop entry has no spans, so every range on them demotes. */
  readonly unpairableFiles: readonly string[];
  readonly filteredDiff: string;
  readonly unfilteredDiff: string;
  readonly hop: Hop;
  /**
   * The previous PR diff's removed-line positions moved onto the new one's,
   * under the same keys as `hop`: identity where the base under a file held
   * still, a span per run where it moved under the same runs, and no spans
   * for a changed file or runs that cannot pair.
   */
  readonly oldSideHop: Hop;
  readonly isUnchanged: boolean;
}

export type PrSpanResult = Result<PrSpan, PrSpanFailure>;

/**
 * One maximal block of `+`/`-` lines in a patch. `oldStart` and `newStart`
 * are the first line on each side, or, for a side the run has no lines on,
 * the line the run sits before.
 */
export interface ChangeRun {
  /** The run's raw lines, markers included: what D1 compares. */
  readonly lines: readonly string[];
  readonly hunk: number;
  readonly oldStart: number;
  readonly newStart: number;
  readonly removed: number;
  readonly added: number;
}

export const FileVerdicts = {
  /** Same post-image blob and mode at both heads, and the PR's change runs at the same lines. */
  IDENTICAL: "identical",
  /** Same post-image blob at both heads, but the base under it took part of the PR's change or gave part back: the lines stay, the change does not. */
  CHANGE_RESHAPED_BY_BASE: "change-reshaped-by-base",
  /** Same change runs and the same lines around each; only the base under them moved. */
  BASE_MOVED: "base-moved",
  /** Same change runs over a moved base, but the lines around one differ: only a line diff tells a moved run from base noise. */
  CONTEXT_MOVED: "context-moved",
  CONTENT_CHANGED: "content-changed",
  /** Binary content or mode changed: only the header can say so. */
  HEADER_CHANGED: "header-changed",
  /** Same change, blobs and mode at both heads under a path the base renamed between them, once both swapped paths read absent. */
  BASE_RENAMED: "base-renamed",
} as const;
export type FileVerdict = ValueOf<typeof FileVerdicts>;

/** One file's patch inside one head's PR diff. */
export interface PrFilePatch {
  readonly prePath: string;
  readonly postPath: string;
  readonly patch: string;
  /** The base's blob id, then the head's. */
  readonly preBlobId?: string;
  readonly blobId?: string;
  /** The head's mode; none for a file the PR deletes. */
  readonly mode?: string;
  readonly isAdded: boolean;
  readonly isDeleted: boolean;
  readonly isBinary: boolean;
  readonly runs: readonly ChangeRun[];
}

/** A file's mode at each head, when both heads hold it under different modes. */
export interface ModeChange {
  readonly prevMode: string;
  readonly newMode: string;
}

/** A file of either PR diff, paired across the two heads by its new-head path. */
export interface ComparedFile {
  /** The path at the new head; a file only the previous diff holds keeps its previous path. */
  readonly path: string;
  /** The path at the previous head: the hop's key. */
  readonly prevPath: string;
  readonly prev?: PrFilePatch;
  readonly next?: PrFilePatch;
  readonly verdict: FileVerdict;
  readonly modeChange?: ModeChange;
}

/** The context lines on each side of one change run, up to the next run or the hunk's edge. */
export interface RunContext {
  readonly before: readonly string[];
  readonly after: readonly string[];
}

export interface PatchHunks {
  readonly header: readonly string[];
  readonly hunks: readonly (readonly string[])[];
}

/** The paths and modes reading and line-diffing one file's two head blobs needs. */
export interface LineDiffFile {
  readonly path: string;
  readonly prevPath: string;
  readonly modeChange?: ModeChange | undefined;
  /** Each head's mode, shaped as a `ComparedFile` holds it. */
  readonly prev?: HeadMode;
  readonly next?: HeadMode;
}

export interface HeadMode {
  readonly mode?: string | undefined;
}

/** A file pair that may be one file the base renamed between the heads. */
export interface BaseRenameCandidate {
  readonly path: string;
  readonly prevPath: string;
  /** The files its two halves line-diff as when the swapped paths do not both read absent. */
  readonly refusedLineDiffFiles: readonly LineDiffFile[];
}

/** What a built span reads after both heads' PR diffs, decided from those diffs alone. */
export interface BuiltSpanPlan {
  /** Files that may read changed, each base-rename candidate counted as `FILES_PER_BASE_RENAME_CANDIDATE`. */
  readonly changedCount: number;
  readonly lineDiffFiles: readonly LineDiffFile[];
  readonly baseRenameCandidates: readonly BaseRenameCandidate[];
}

/**
 * The span's steps whose cost grows with the PR diffs or the blobs, each a
 * function of its input alone, run wherever the caller chooses: the worker
 * runs them in-process, the api on a thread. A step that rejects with a
 * `SpanRunnerError` is infrastructure, never a verdict on the PR.
 */
export interface PrSpanRunner {
  readonly planBuiltSpan: (
    input: PrDiffPair,
    signal: AbortSignal,
  ) => Promise<BuiltSpanPlan>;
  readonly buildPrSpan: (
    input: PrSpanInput,
    signal: AbortSignal,
  ) => Promise<PrSpan>;
  readonly buildFastForwardSpan: (
    input: FastForwardSpanInput,
    signal: AbortSignal,
  ) => Promise<PrSpan>;
  readonly runLineDiff: LineDiffRunner;
}
