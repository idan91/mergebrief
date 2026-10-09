import type { StoredBrief } from "brief-core/artifact";
import type {
  Chunk,
  LineRange,
  UnattributedFile as StoredUnattributedFile,
} from "brief-core/types";
import type { ValueOf } from "types";
import type { DiffLine } from "../../utils/diffTokens/types";

/** Built-in or repo-policy risk token; the closed vocabulary is per-generation. */
export type RiskToken = string;

/** Live DB-route PR state. When present it supersedes the artifact stamp. */
export interface LivePrState {
  state: "open" | "closed" | "merged";
  draft: boolean;
  /** The stack read: absent is not read yet or failed, see `PullStack`. */
  stack?: PullStack;
}

export interface PrStackMember {
  number: number;
  title: string;
}

export interface LinearPrStack {
  members: PrStackMember[];
  index: number;
}

export interface ForkPrStack {
  parent?: PrStackMember | undefined;
  children: PrStackMember[];
}

export type PrStack = LinearPrStack | ForkPrStack;

/** The stack read: null when the PR sits in no open stack and none was recorded. */
export interface PullStack {
  stack: PrStack | null;
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

export const ExpansionDirections = {
  UP: "up",
  DOWN: "down",
} as const;
export type ExpansionDirection = ValueOf<typeof ExpansionDirections>;

/**
 * Where expanded context enters a chunk's rows. A chunk's diff is SLICED, so
 * a gap is not always a hunk boundary: the edge names the insertion point in
 * the rows the chunk actually carries, which a hunk index cannot.
 */
export interface ExpansionEdge {
  /** Insertion index into the chunk's `diff`. */
  rowIndex: number;
  direction: ExpansionDirection;
}

/**
 * What one hunk edge has expanded: the union the height model reads, the
 * ranges each click read (the query cache holds their lines) and, once a
 * read reached it, where the file ends.
 */
export interface EdgeExpansion {
  range: LineRange;
  ranges: readonly LineRange[];
  totalLines?: number;
}

/** One edge of one gap in a chunk's rows, in head-file line numbers. */
export interface ExpansionGap {
  edge: ExpansionEdge;
  /** First missing line, inclusive. */
  from: number;
  /** Last missing line, inclusive; absent where the gap runs to end of file. */
  to?: number;
  /** `oldLine - newLine` in force at this edge. */
  offset: number;
}

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
  startLine: number | null;
  line: number | null;
  originalStartLine: number | null;
  originalLine: number | null;
  author: string;
  body: string;
  inReplyToId: string | null;
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
  artifactKind: "brief" | "delta";
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

/** Which comparison baseline a mechanical marks sidecar is relative to. */
export type ComparisonBaselineLabel = "previous-brief" | "checkpoint";

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
  baselineIndex: number | null;
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

/**
 * @description Availability of the shared Previous-Brief comparison for one
 * Brief head: the mechanical marks exist (source of truth), and - when
 * generated - the matching Revision narrative sidecar id (real narrative or
 * skip stub; callers discriminate on `artifactKind` after fetching).
 */
export interface PreviousBriefComparisonAvailability {
  marksId: string;
  /**
   * @description Present whenever a `.revision-narrative.json` sidecar exists ,
   * INCLUDING skip stubs (`artifactKind: "revisionNarrativeSkipped"`, written
   * for huge spans or when disabled by config). narrativeId-present means
   * "there is a narrative artifact to fetch", NOT "a summary is available":
   * readers must discriminate on the fetched file's `artifactKind` and treat
   * a stub as narrative-unavailable with a knowable skip reason.
   */
  narrativeId?: string;
  baselineSha: string;
  baselineIndex: number;
}

/**
 * @description Availability of the personal "Your last review" comparison for
 * one Brief head, approximated locally from available Delta artifacts.
 * `deltaId` is optional: `delta-cli` writes checkpoint marks before the Delta
 * LLM call, so marks can exist without a Delta.
 * A marks-only baseline is still "available" - the marks are the comparison.
 */
export interface LastReviewComparisonAvailability {
  marksId: string;
  deltaId?: string;
  baselineSha: string;
  baselineIndex: number | null;
}

/**
 * @description Comparison availability for one Brief head. Absent
 * keys mean that baseline has no mechanical marks for this head - the FE
 * disables the corresponding Compare option.
 */
export interface ComparisonAvailability {
  previousBrief?: PreviousBriefComparisonAvailability;
  lastReview?: LastReviewComparisonAvailability;
}

export interface LocalBriefSummary {
  id: string;
  artifactKind: "brief" | "delta";
  repo: string;
  number: number;
  title: string;
  sha: string;
  index?: number;
  baselineSha?: string;
  headSha?: string;
  baselineIndex?: number | null;
  headIndex?: number | null;
  /** Only populated for `artifactKind: "brief"` entries. */
  comparisons?: ComparisonAvailability;
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

/** The head-file lines one click asks the file-range read for. */
export interface ExpansionRange {
  from: number;
  to: number;
}

export interface ResolveExpansionRangeParams {
  gap: ExpansionGap;
  /** Head-file lines this edge has already taken. */
  expanded?: LineRange;
  /** Lines the other edge of the same gap already read; this edge stops there. */
  blocked?: readonly LineRange[];
}

export const FileRangeResultKinds = {
  READY: "ready",
  TOO_LARGE: "too-large",
  NOT_TEXT: "not-text",
  NOT_FOUND: "not-found",
  UNAVAILABLE: "unavailable",
} as const;
export type FileRangeResultKind = ValueOf<typeof FileRangeResultKinds>;

/** A slice of the file at the head ref, as the file-range read returns it. */
export interface FileRangeSlice {
  from: number;
  to: number;
  lines: readonly string[];
}

export interface SpliceExpandedRowsParams {
  diff: readonly DiffLine[];
  gap: ExpansionGap;
  slice: FileRangeSlice;
  /** The file's whole diff; absent falls back to the slice's lines with the edge offset. */
  fileRows?: readonly DiffLine[];
  /** The last gap line the sibling read covers; the gap closes together. */
  coveredTo?: number;
}

/** One edge's read, ready to splice. */
export interface ExpansionApplication {
  gap: ExpansionGap;
  slice: FileRangeSlice;
  fileRows?: readonly DiffLine[];
  coveredTo?: number;
}

/** A gap of the base rows and what the store holds for its edge. */
export interface StoredEdge {
  gap: ExpansionGap;
  edgeKey: string;
  expansion: EdgeExpansion;
}

/** An edge as the table renders it: placed by the spliced rows. */
export interface ExpandableEdge {
  /** The file's line count once any read on the file has reported it. */
  fileEnd?: number;
  /** Insertion index into the SPLICED rows. */
  rowIndex: number;
  /** The base-row gap the store and the read are keyed on. */
  gap: ExpansionGap;
  edgeKey: string;
  expansion: EdgeExpansion | undefined;
  /** What the other edge of the same gap already took; this edge stops there. */
  sibling?: LineRange;
}

export interface SpliceStoredEdgesParams {
  rows: readonly DiffLine[];
  edges: readonly StoredEdge[];
  lines: ReadonlyMap<number, string>;
  fileRows?: readonly DiffLine[] | undefined;
}

/** Where an expansion range's rows come from: the file's diff and the chunk's own rows. */
export interface ExpansionRowSources {
  fileRows: readonly DiffLine[];
  range: ExpansionRange;
  /** The gap's first line: a deletion anchored just above it rides the first read. */
  gapStart: number;
  /** The chunk's own rows; a deletion they carry is never repeated. */
  base: readonly DiffLine[];
}

export interface CollectExpansionRowsParams extends ExpansionRowSources {
  slice: FileRangeSlice;
}

export interface ExpanderStep {
  range: ExpansionRange;
  /** The click takes the whole remainder of the gap. */
  takesAll: boolean;
}
