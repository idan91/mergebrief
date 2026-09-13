import type { DiffLine } from "../../utils/diffTokens/types";

export const Categories = {
  BUGFIX: "bugfix",
  LOGIC_REFACTOR: "logic-refactor",
  MOVE_WITH_EDITS: "move-with-edits",
  LIB_BUMP: "lib-bump",
  PURE_MOVE: "pure-move",
  NEW_FEATURE: "new-feature",
  DEPENDENCY_UPDATE: "dependency-update",
  SCHEMA_CHANGE: "schema-change",
} as const;

export const Concerns = {
  IMPLEMENTATION: "implementation",
  TEST: "test",
  DOC: "doc",
  SPEC: "spec",
  CONFIG: "config",
  GENERATED: "generated",
} as const;

export const Roles = {
  CORE: "core",
  SUPPORTING: "supporting",
} as const;

export const RiskSurfaceAttributes = {
  NO_TESTS: "no-tests",
  NO_TYPES: "no-types",
  LEGACY_AREA: "legacy-area",
  DENSE_LOGIC: "dense-logic",
  TOUCHES_AUTH: "touches-auth",
  MUTATES_STATE: "mutates-state",
  REMOVES_VALIDATION: "removes-validation",
  RELAXES_PERMISSIONS: "relaxes-permissions",
  WIDENS_ERROR_HANDLING: "widens-error-handling",
  ADDS_FEATURE_FLAG: "adds-feature-flag",
  NEW_DEPENDENCY: "new-dependency",
  NEW_ABSTRACTION: "new-abstraction",
  COMMENT_CONTRADICTS_CODE: "comment-contradicts-code",
  EXTERNAL_IO: "external-io",
  CROSS_SERVICE: "cross-service",
  SCHEMA_ADJACENT: "schema-adjacent",
  HOT_PATH: "hot-path",
  WIDELY_IMPORTED: "widely-imported",
  RELEASE_IMMINENT: "release-imminent",
} as const;

import type { ValueOf } from "types";

export type Category = ValueOf<typeof Categories>;
export type Concern = ValueOf<typeof Concerns>;
export type Role = ValueOf<typeof Roles>;
export type RiskSurfaceAttribute = ValueOf<typeof RiskSurfaceAttributes>;

/** Built-in or repo-policy risk token; the closed vocabulary is per-generation. */
export type RiskToken = string;

/** GitHub PR lifecycle states. A merged PR's `state` is `closed`. */
export type PrLifecycleState = "open" | "closed";

/** Live DB-route PR state. When present it supersedes the artifact stamp. */
export interface LivePrState {
  state: "open" | "closed" | "merged";
  draft: boolean;
}

export interface PrRef {
  repo: string;
  number: number;
  title: string;
  url: string;
  sha: string;
  description: string;
  /**
   * @description PR lifecycle snapshot stamped at generation time - a
   * snapshot by design, no staleness hint. Absent on pre-stamping
   * artifacts; the state badge simply doesn't render.
   */
  state?: PrLifecycleState;
  draft?: boolean;
  merged?: boolean;
  /** Head branch name; absent on pre-stamping artifacts. */
  headRef?: string;
  /** Base branch name; absent on pre-stamping artifacts. */
  baseRef?: string;
  stack?: PrStack;
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
  parent?: PrStackMember;
  children: PrStackMember[];
}

export type PrStack = LinearPrStack | ForkPrStack;

export interface ChunkLoc {
  added: number;
  deleted: number;
}

export interface LineRange {
  start: number;
  end: number;
}

/**
 * @description Changed lines no chunk claims, as per-file ranges ,
 * pipeline-derived, counts always derive from the ranges.
 */
export interface UnattributedFile {
  file: string;
  /** @description New-side changed lines no chunk claims. */
  addedRanges: LineRange[];
  /** @description Old-side changed lines no chunk claims. */
  removedRanges: LineRange[];
  /**
   * @description Sliced diff rows for the unattributed ranges - attached
   * where the diff is available (server sidecar / live diff), like
   * `BriefChunk.diff`; never part of the stored artifact.
   */
  diff?: DiffLine[];
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
 * windows each click read (the query cache holds their lines) and, once a
 * read reached it, where the file ends.
 */
export interface EdgeExpansion {
  range: LineRange;
  windows: readonly LineRange[];
  totalLines?: number;
}

/** One edge of one hole in a chunk's rows, in head-file line numbers. */
export interface ExpansionGap {
  edge: ExpansionEdge;
  /** First missing line, inclusive. */
  from: number;
  /** Last missing line, inclusive; absent where the hole runs to end of file. */
  to?: number;
  /** `oldLine - newLine` in force at this edge. */
  offset: number;
}

/**
 * @description One short factual note evidencing a risk-surface attribute on
 * a chunk - e.g. the both-sides citation required for
 * `comment-contradicts-code`.
 */
export interface RiskNote {
  attr: RiskToken;
  note: string;
}

export interface BriefChunk {
  id: string;
  changeGroupId: string;
  file: string;
  concern: Concern;
  role: Role;
  loc: ChunkLoc;
  addedRanges: LineRange[];
  removedRanges: LineRange[];
  riskSurface: RiskToken[];
  riskNotes?: RiskNote[];
  summary?: string;
  addressesComments?: string[];
  diff?: DiffLine[];
}

export interface ChangeGroup {
  id: string;
  title: string;
  summary: string;
  dominantCategory: Category;
  secondaryCategories: Category[];
  uncertain: boolean;
  uncertainBetween: Category[];
}

/**
 * @description One step of a Brief's Reading order: `groupId`
 * references a `ChangeGroup.id`; `why` is a short comprehension-language line
 * on why this group comes next (never importance/priority/severity language).
 */
export interface ReadingOrderStep {
  groupId: string;
  why: string;
}

export interface ConcernRollup {
  concern: Concern;
  added: number;
  deleted: number;
}

/**
 * @description How actionable the composite intent source is. `precise`
 * populates the three buckets; `broad` and `none` render as "intent check
 * unavailable".
 */
export type Specificity = "precise" | "broad" | "none";

export const AlignmentReads = {
  ALIGNED: "aligned",
  PARTIAL: "partial",
  MISALIGNED: "misaligned",
} as const;
export type AlignmentRead = ValueOf<typeof AlignmentReads>;

/**
 * @description The Ticket alignment read against the primary ticket's goal:
 * the read word, the goal quoted verbatim, one factual sentence about the
 * diff. Never a gate.
 */
export interface TicketAlignment {
  read: AlignmentRead;
  goal: string;
  response: string;
}

export const TicketTrackers = { GITHUB: "github", NOTION: "notion" } as const;
export type TicketTracker = ValueOf<typeof TicketTrackers>;

export const ReferenceLocations = {
  DESCRIPTION: "description",
  TITLE: "title",
  BRANCH: "branch",
} as const;
export type ReferenceLocation = ValueOf<typeof ReferenceLocations>;

export const PrimaryTicketStatuses = {
  READ: "read",
  UNREAD: "unread",
} as const;
export type PrimaryTicketStatus = ValueOf<typeof PrimaryTicketStatuses>;

export const TicketUnreadReasons = {
  NOT_FOUND: "not-found",
  NO_CREDENTIAL: "no-credential",
  TIMEOUT: "timeout",
  RATE_LIMITED: "rate-limited",
  UNSUPPORTED: "unsupported",
} as const;
export type TicketUnreadReason = ValueOf<typeof TicketUnreadReasons>;

/**
 * @description The one ticket the PR is about, as the harness resolved and
 * read it. Harness-written, never model-produced. `key` is `""` for a
 * URL-only reference; `title` and `header` are `""` when unread; `reason` is
 * `""` when read.
 */
export interface PrimaryTicket {
  key: string;
  url: string;
  tracker: TicketTracker;
  foundIn: ReferenceLocation;
  title: string;
  header: string;
  status: PrimaryTicketStatus;
  reason: TicketUnreadReason | "";
}

/**
 * @description One item shared by all three intent buckets - a per-bucket
 * shape overflowed the structured-output grammar, so one shape carries every
 * bucket. The per-bucket field rules (`statedButMissing` has no `groupIds`;
 * `doneButUnstated` has no `quote`/`sourceUrl`) are enforced server-side and
 * mirrored in rendering. `sourceUrl` is `""` for a PR title/description citation.
 */
export interface IntentItem {
  intent: string;
  quote: string;
  sourceUrl: string;
  groupIds: string[];
  /**
   * @description Meaningful only on `deviations` - the PR description
   * acknowledges the reversal, making the item a quiet receipt rather than an
   * alarm. Generation forces it `false` in every other bucket; older Briefs
   * have no such field and read as `false`.
   */
  acknowledged: boolean;
}

/**
 * @description The ticket-gated intent check: did this PR do what
 * its stated intent asked? Factual buckets, never a verdict. Full Brief
 * only - never present on a Delta Brief. Boundary-parsed defensively
 * (`validation.ts`): a malformed field is dropped to `undefined`, so by the
 * time a `Brief` reaches the app this is either well-formed or absent (a
 * pre-feature Brief renders no intent bar).
 */
export interface IntentCheck {
  ticketUrls: string[];
  /**
   * @description Display title per `ticketUrls` entry, same order and length
   * (the boundary parser realigns). `""` = no usable title - the renderer
   * falls back to the id alone. Empty strings throughout on older Briefs.
   */
  ticketTitles: string[];
  specificity: Specificity;
  scopeNote: string;
  accomplished: IntentItem[];
  statedButMissing: IntentItem[];
  doneButUnstated: IntentItem[];
  /**
   * @description Alarm bucket: stated asks the diff moves AGAINST that the
   * source nowhere retracts. Items whose `acknowledged` is true are quiet
   * receipts (the description owns the reversal) and render at the tail,
   * apart from the unacknowledged ones. Empty on an older Brief.
   */
  deviations: IntentItem[];
  /**
   * @description Alarm bucket: asks the source claims are fixed while the
   * diff touches only the problem's signal/check path. Empty on an older Brief.
   */
  claimedButUnachieved: IntentItem[];
  /**
   * @description The primary ticket, when the PR references one. Absent on
   * older Briefs and when no reference was found; a malformed value drops to
   * absent at the boundary, never the whole check.
   */
  primaryTicket?: PrimaryTicket;
  /**
   * @description Absent when there is no primary ticket, it could not be
   * read, the sources are broad or absent, or the goal did not verify.
   */
  alignment?: TicketAlignment;
}

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

export interface CommitRange {
  base: string;
  head: string;
  commitCount: number;
}

export interface Generation {
  provider: string;
  model: string;
  effort: string | null;
}

/**
 * @description Cross-revision anchor origin, CLI-assigned:
 * `anchored` = incremental regeneration against the previous brief;
 * `fresh-restart` = a deliberate from-scratch run (reason names why, e.g.
 * "model-swap"); `none` = first generation or anchoring off. Absent on
 * pre-feature briefs. Mirrors the server union; unknown states are dropped
 * at the parse boundary (server-enforced vocabulary).
 */
export interface BriefAnchor {
  state: "anchored" | "fresh-restart" | "none";
  reason?: string;
}

/**
 * @description One text field exceeding the length caps ,
 * pipeline-stamped (warn-only floor), never model-produced. The FE renders
 * a single muted "consider a stronger model" line when any are present;
 * the entries themselves are diagnostic, not itemized in the UI.
 */
export interface LengthViolation {
  surface: string;
  field: string;
  actual: number;
  cap: number;
}

export interface Brief {
  artifactKind: "brief" | "delta";
  pr: PrRef;
  summary: string;
  changeGroups: ChangeGroup[];
  chunks: BriefChunk[];
  concernView: ConcernRollup[];
  /**
   * @description Changed lines no chunk claims - pipeline-derived (`[]` =
   * fully attributed); absent on pre-feature briefs.
   */
  unattributed?: UnattributedFile[];
  /**
   * @description Whole-diff added/removed totals derived from the parsed
   * diff - exact even when chunk overlaps double-count per-chunk sums.
   * Absent on pre-feature briefs.
   */
  diffTotals?: ChunkLoc;
  index?: number;
  commitRange?: CommitRange;
  generation?: Generation;
  anchor?: BriefAnchor;
  /**
   * @description Warning lines the generation pipeline emitted (salvage,
   * feedback retry, served-model mismatch) - CLI-collected.
   * Rendered under the header meta line so a degraded generation is
   * visible, not just finished.
   */
  generationWarnings?: string[];
  /**
   * @description Text fields exceeding the length caps - pipeline-stamped;
   * absent when everything fits.
   */
  lengthViolations?: LengthViolation[];
  baselineSha?: string;
  headSha?: string;
  baselineIndex?: number | null;
  headIndex?: number | null;
  commentsAddressed?: string;
  reviewComments?: AddressedReviewComment[];
  wholePrImpact?: string;
  /**
   * @description Reading order over `changeGroups`, full Brief
   * only - never present on a Delta Brief. Boundary-parsed defensively: a
   * present-but-invalid permutation is dropped client-side (`validation.ts`),
   * so by the time a `Brief` reaches the rest of the app this is either a
   * verified permutation of `changeGroups` ids or `undefined`.
   */
  readingOrder?: ReadingOrderStep[];
  /**
   * @description The ticket-gated intent check, full Brief only.
   * Absent on pre-feature Briefs and on Delta Briefs - the intent bar
   * renders only when this is present.
   */
  intentCheck?: IntentCheck;
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
 * @description A revision-narrative chunk: an incremental
 * `prevHead→head` change attached to an existing full-Brief Change-group via
 * `briefChangeGroupId`. `addedRanges`/`removedRanges` are head/old-side coords,
 * same join semantics as the mechanical marks. FE mirror of the categorizer's
 * `RevisionNarrativeChunk`.
 */
export interface RevisionNarrativeChunk {
  id: string;
  briefChangeGroupId: string;
  file: string;
  addedRanges: LineRange[];
  removedRanges: LineRange[];
  summary: string;
}

/**
 * @description The shared, per-revision "what changed" narrative for the
 * Previous-Brief comparison. Every chunk attaches to a full-Brief
 * Change-group; it carries no reviewer Checkpoint or `wholePrImpact`.
 */
export interface RevisionNarrative {
  artifactKind: "revisionNarrative";
  pr: PrRef;
  prevHeadSha: string;
  headSha: string;
  prevIndex: number;
  headIndex: number;
  generation: Generation;
  generationWarnings?: string[];
  /**
   * @description Text fields exceeding the length caps - pipeline-stamped;
   * absent when everything fits.
   */
  lengthViolations?: LengthViolation[];
  overview: string;
  chunks: RevisionNarrativeChunk[];
}

/** Why a Previous-Brief narrative was deliberately not generated. */
export type RevisionNarrativeSkipReason =
  | "span too large"
  | "disabled by config";

/**
 * @description Explicit skip stub written when a Previous-Brief span never got
 * a generated narrative (huge span or config-disabled). Distinct from an absent
 * file (generation failed): a stub means "deliberately skipped, retry won't
 * help" and the FE surfaces the reason rather than a failure state.
 */
export interface RevisionNarrativeSkipped {
  artifactKind: "revisionNarrativeSkipped";
  pr: PrRef;
  prevHeadSha: string;
  headSha: string;
  prevIndex: number;
  headIndex: number;
  skipped: RevisionNarrativeSkipReason;
}

/**
 * @description A fetched `.revision-narrative.json`: either a real narrative or
 * a skip stub. `narrativeId`-present in availability only means "an artifact
 * exists to fetch"; callers discriminate on `artifactKind` after fetching.
 */
export type RevisionNarrativeArtifact =
  | RevisionNarrative
  | RevisionNarrativeSkipped;

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

/** The head-file lines one click asks the file-range read for. */
export interface ExpansionWindow {
  from: number;
  to: number;
}

export interface ResolveExpansionWindowParams {
  gap: ExpansionGap;
  /** Head-file lines this edge has already taken. */
  expanded?: LineRange;
  /** Head-file lines another chunk of the same file already renders. */
  claimed?: readonly LineRange[];
}

/** A slice of the file at the head ref, as the file-range read returns it. */
export interface FileRangeSlice {
  from: number;
  to: number;
  lines: readonly string[];
}

export interface SpliceExpandedRowsParams {
  diff: readonly DiffLine[];
  gap: ExpansionGap;
  range: FileRangeSlice;
  claimed?: readonly LineRange[];
  /** The last hole line the sibling read covers; the hole closes together. */
  coveredTo?: number;
}

/** One edge's read, ready to splice. */
export interface ExpansionApplication {
  gap: ExpansionGap;
  range: FileRangeSlice;
  claimed?: readonly LineRange[];
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
  /** What the other edge of the same hole already took; this edge stops there. */
  sibling?: LineRange;
}

export interface SpliceStoredEdgesParams {
  rows: readonly DiffLine[];
  edges: readonly StoredEdge[];
  lines: ReadonlyMap<number, string>;
  claimed: readonly LineRange[];
}

export interface ExpanderStep {
  window: ExpansionWindow;
  /** The click takes the whole remainder of the hole. */
  takesAll: boolean;
}
