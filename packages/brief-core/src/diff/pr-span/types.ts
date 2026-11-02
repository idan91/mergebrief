import type { Result, ValueOf } from "types/utils";
import type { Hop } from "../remap";

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
}

export const BetweenHeadsKinds = {
  PATCH: "patch",
  UNREADABLE: "unreadable",
} as const;

/** One changed file's diff from the previous head to the new head, or no line diff for it. */
export type BetweenHeadsFile =
  | { readonly kind: typeof BetweenHeadsKinds.PATCH; readonly patch: string }
  | { readonly kind: typeof BetweenHeadsKinds.UNREADABLE };

export interface PrSpanInput {
  readonly prevPrDiff: string;
  readonly newPrDiff: string;
  /** Keyed by the file's path at the new head; a file `readPrSpan` line-diffs with no entry is unreadable and reads changed. */
  readonly betweenHeads: ReadonlyMap<string, BetweenHeadsFile>;
  /** New-head paths of base renames confirmed by absence at the swapped paths; any other candidate reads as two changed files. */
  readonly baseRenames?: ReadonlySet<string>;
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
