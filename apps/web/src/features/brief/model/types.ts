import type { StoredBrief } from "brief-core/artifact";
import type {
  Chunk,
  LineRange,
  UnattributedFile as StoredUnattributedFile,
} from "brief-core/types";
import type { LocalBriefKind, PrStackMemberState } from "contract";
import type { ComparisonBaselineLabel, PrState, ValueOf } from "types";
import type { UnknownValue } from "@web/utils/open-enum/types";
import type { PostedComment } from "../../../data/postedComment";
import { WriteFailureKinds } from "../../../data/request/types";
import type { DiffLine } from "../../../utils/diffTokens/types";

/** Built-in or repo-policy risk key; the closed vocabulary is per-generation. */
export type RiskKey = string;

/** Live DB-route PR state. When present it supersedes the artifact stamp. */
export interface LivePrState {
  state: PrState | UnknownValue;
  draft: boolean;
  /** The stack read: absent is not read yet or failed, see `PullStack`. */
  stack?: PullStack;
}

/** `state` and `headRef` ride the live read only; a snapshot or record holds number and title. */
export interface PrStackMember {
  number: number;
  title: string;
  state?: PrStackMemberState | UnknownValue;
  headRef?: string;
}

export interface LinearPrStack {
  members: PrStackMember[];
  index: number;
  /** The branch the bottom member targets; the live read only. */
  baseRef?: string;
}

export interface ForkPrStack {
  parent?: PrStackMember | undefined;
  children: PrStackMember[];
  /** The branch the parent, else this PR, targets; the live read only. */
  baseRef?: string;
}

export type PrStack = LinearPrStack | ForkPrStack;

/** The stack read: no stack when the PR sits in no open stack and none was recorded. */
export interface PullStack {
  stack?: PrStack;
  /** ISO time the served stack was recorded; present only for a recorded one. */
  asOf?: string;
}

export interface UnattributedFile extends StoredUnattributedFile {
  /**
   * @description Sliced diff rows for the unattributed ranges - attached
   * where the diff is available (server sidecar / live diff), like
   * `BriefChunk.diff`; never part of the stored artifact.
   */
  diff?: DiffLine[];
}

/** One file's unified-diff patch body, as the diffs sidecar and the live diff carry it. */
export interface FileDiffPatch {
  file: string;
  patch: string;
}

/**
 * @description Mechanical prevHead→head changed lines for one file.
 */
export interface RevisionChangeFile {
  file: string;
  /**
   * @description Added/changed lines in head (new-side) coordinates.
   * Joins on a diff row's `newLine`.
   */
  addedRanges: LineRange[];
  /**
   * @description Removed lines in prevHead (old-side) coordinates.
   * Joins on a deletion row's `oldLine`.
   */
  removedRanges: LineRange[];
}

/**
 * @description The revision-changes sidecar: what's new in this revision, shared per revision.
 */
export interface RevisionChanges {
  headSha: string;
  prevHeadSha: string;
  prevIndex: number;
  files: RevisionChangeFile[];
}

/** What a file's first hunk header says about the file as a whole. */
export const FileStatuses = {
  NEW: "new",
  DELETED: "deleted",
} as const;
export type FileStatus = ValueOf<typeof FileStatuses>;

/** A full-Brief chunk, or a Delta Brief chunk with its two delta fields. */
export interface BriefChunk extends Chunk {
  summary?: string;
  addressesComments?: string[];
  diff?: DiffLine[];
}

/**
 * The host id prefix of every guest table a Changes surface renders; no
 * brief chunk id starts with one, so a composer host names its pane.
 */
export const GuestHostPrefixes = {
  RAW: "raw:",
  NARRATIVE: "narrative:",
  DELTA: "delta:",
} as const;

/** Why a guest row takes no comment: GitHub can hold one only on a line of the PR diff. */
export const GuestRowReasons = {
  REMOVED_BEFORE_HEAD: "removed-before-head",
  NOT_IN_PR_DIFF: "not-in-pr-diff",
  PR_DIFF_UNAVAILABLE: "pr-diff-unavailable",
  FILE_NOT_IN_BRIEF: "file-not-in-brief",
} as const;
export type GuestRowReason = ValueOf<typeof GuestRowReasons>;

export interface AddressedReviewComment {
  id: string;
  file: string;
  startLine?: number;
  line?: number;
  originalStartLine?: number;
  originalLine?: number;
  author: string;
  body: string;
  inReplyToId?: string;
  outdated: boolean;
}

/**
 * A full Brief or a Delta Brief as the screens render it: a Delta Brief's
 * `changedGroups` arrive as `changeGroups`, its `concernView` is derived, and
 * `artifactKind` tells the two apart.
 */
export interface Brief extends Omit<
  StoredBrief,
  "chunks" | "unattributed" | "anchoring"
> {
  artifactKind: LocalBriefKind;
  chunks: BriefChunk[];
  unattributed?: UnattributedFile[];
  baselineSha?: string;
  headSha?: string;
  baselineIndex?: number | null;
  headIndex?: number | null;
  commentsAddressed?: string;
  reviewComments?: AddressedReviewComment[];
  wholePrImpact?: string;
}

/**
 * @description Top-level fields of a `.comparison.json` marks sidecar
 * needed to determine comparison availability. `files` is intentionally omitted
 * here - availability only needs the header; readers that need per-line marks
 * fetch the full sidecar separately.
 */
export interface ComparisonMarksSummary {
  baselineSha: string;
  headSha: string;
  baselineLabel: ComparisonBaselineLabel;
  baselineIndex?: number;
}

/**
 * @description Full `.comparison.json` marks sidecar: the header fields plus
 * the per-file mechanical changed-line ranges. Structurally the same `files`
 * shape as `RevisionChanges`, so both feed the same FE mark-join. These marks
 * are the *sole* source of truth for which lines are highlighted - narrative
 * and Delta summaries never decide marks.
 */
export interface ComparisonMarks extends ComparisonMarksSummary {
  files: RevisionChangeFile[];
}

/** One revision of a PR before it becomes a timeline row; route-shaped. */
export interface RevisionPoint {
  /** The route's own handle for the revision; selection resolves by it. */
  key: string;
  ordinal: number;
  headSha: string;
  /** ISO time the revision was briefed; absent where the route has none. */
  at?: string;
  current: boolean;
}

/** One row of the Revisions tab. */
export interface RevisionRow {
  key: string;
  ordinal: number;
  shortSha: string;
  at?: string;
  current: boolean;
  newest: boolean;
}

/** The Revisions tab's rows, newest first; selection stays route-owned. */
export interface RevisionTimelineView {
  rows: RevisionRow[];
}

/** What a route hands the Revisions tab: the rows and how to go to one. */
export interface RevisionTimelinePlan {
  view: RevisionTimelineView;
  /** Route-owned; called with a row's key, never for the current row. */
  selectRevision: (key: string) => void;
}

export const PostCommentResultKinds = {
  POSTED: "posted",
  UNAUTHORIZED: WriteFailureKinds.UNAUTHORIZED,
  NOT_FOUND: "not-found",
  STALE: "stale",
  ORPHANED_ANCHOR: "orphaned-anchor",
  ALREADY_PUBLISHED: "already-published",
  PUBLISH_PENDING: "publish-pending",
  PUBLISH_IN_DOUBT: "publish-in-doubt",
  INVALID: "invalid",
  NO_WRITE_ACCESS: "no-write-access",
  GITHUB_PERMISSION: "github-permission",
  UPSTREAM: "upstream",
  INDETERMINATE: WriteFailureKinds.INDETERMINATE,
} as const;
export type PostCommentResultKind = ValueOf<typeof PostCommentResultKinds>;

export type PostCommentResult =
  | PostedComment
  /** 401, session expired; sign in again. The draft stays. */
  | { readonly kind: typeof PostCommentResultKinds.UNAUTHORIZED }
  /** 404, the PR (or repo access) is gone. */
  | { readonly kind: typeof PostCommentResultKinds.NOT_FOUND }
  /** 409, the head advanced under the pinned commit; reload to re-anchor. */
  | { readonly kind: typeof PostCommentResultKinds.STALE }
  /** 409, the draft's anchor points at no code; re-place or delete it. */
  | { readonly kind: typeof PostCommentResultKinds.ORPHANED_ANCHOR }
  /** 409, the draft is already on GitHub; nothing posted twice. */
  | { readonly kind: typeof PostCommentResultKinds.ALREADY_PUBLISHED }
  /** 409, an earlier attempt on this draft is still running. */
  | { readonly kind: typeof PostCommentResultKinds.PUBLISH_PENDING }
  /** 409, an earlier attempt may have posted it and GitHub could not say. */
  | { readonly kind: typeof PostCommentResultKinds.PUBLISH_IN_DOUBT }
  /** 400 (shape; mirrored client-side) or deterministic 413, edit the body, retry-as-is never clears. */
  | { readonly kind: typeof PostCommentResultKinds.INVALID }
  /**
   * 403, a url-box brief for a repo the reader's own GitHub account cannot
   * write to. Never a retry: it clears by installing the App there.
   */
  | { readonly kind: typeof PostCommentResultKinds.NO_WRITE_ACCESS }
  /** 403, GitHub refused the viewer's comment; nothing posted. */
  | { readonly kind: typeof PostCommentResultKinds.GITHUB_PERMISSION }
  /** 502/anything else, GitHub rejected or is unreachable. */
  | { readonly kind: typeof PostCommentResultKinds.UPSTREAM }
  /** A network throw, the proxy's 504 or an unreadable 2xx: it may have posted. */
  | { readonly kind: typeof PostCommentResultKinds.INDETERMINATE };

export const MarkReadyResultKinds = {
  READY: "ready",
  UNAUTHORIZED: WriteFailureKinds.UNAUTHORIZED,
  NOT_FOUND: "not-found",
  GITHUB_PERMISSION: "github-permission",
  NO_WRITE_ACCESS: "no-write-access",
  UPSTREAM: "upstream",
  INDETERMINATE: WriteFailureKinds.INDETERMINATE,
} as const;
export type MarkReadyResultKind = ValueOf<typeof MarkReadyResultKinds>;

export type MarkReadyResult =
  /** The PR is ready: fresh flip or already-ready convergence (indistinguishable). */
  | { kind: typeof MarkReadyResultKinds.READY }
  | { kind: typeof MarkReadyResultKinds.UNAUTHORIZED }
  | { kind: typeof MarkReadyResultKinds.NOT_FOUND }
  /**
   * 403: the App lacks `contents: write`. A distinct kind so the FE gives
   * actionable copy instead of the "no longer accessible" 404 copy: the viewer
   * proved repo access, so this is not an existence miss.
   */
  | { kind: typeof MarkReadyResultKinds.GITHUB_PERMISSION }
  /**
   * 403: a url-box brief for a repo the reader's own GitHub account cannot
   * write to. Never a retry: it clears by installing the App there.
   */
  | { kind: typeof MarkReadyResultKinds.NO_WRITE_ACCESS }
  | { kind: typeof MarkReadyResultKinds.UPSTREAM }
  /** The request never got an answer: the flip may or may not have happened. */
  | { kind: typeof MarkReadyResultKinds.INDETERMINATE };

/** The route-injected action shape the Brief screen's own-draft flow calls. */
export type MarkReadyAction = () => Promise<MarkReadyResult>;
