export const Categories = {
  Bugfix: "bugfix",
  LogicRefactor: "logic-refactor",
  MoveWithEdits: "move-with-edits",
  LibBump: "lib-bump",
  PureMove: "pure-move",
  NewFeature: "new-feature",
  DependencyUpdate: "dependency-update",
  SchemaChange: "schema-change",
} as const;

export const Concerns = {
  Implementation: "implementation",
  Test: "test",
  Doc: "doc",
  Spec: "spec",
  Config: "config",
  Generated: "generated",
} as const;

export const Roles = {
  Carrier: "carrier",
  Supporting: "supporting",
} as const;

export const RiskSurfaceAttributes = {
  NoTests: "no-tests",
  NoTypes: "no-types",
  LegacyArea: "legacy-area",
  DenseLogic: "dense-logic",
  TouchesAuth: "touches-auth",
  MutatesState: "mutates-state",
  RemovesValidation: "removes-validation",
  RelaxesPermissions: "relaxes-permissions",
  WidensErrorHandling: "widens-error-handling",
  AddsFeatureFlag: "adds-feature-flag",
  ExternalIo: "external-io",
  CrossService: "cross-service",
  SchemaAdjacent: "schema-adjacent",
  HotPath: "hot-path",
  WidelyImported: "widely-imported",
  ReleaseImminent: "release-imminent",
} as const;

export type ValueOf<T> = T[keyof T];

export type Category = ValueOf<typeof Categories>;
export type Concern = ValueOf<typeof Concerns>;
export type Role = ValueOf<typeof Roles>;
export type RiskSurfaceAttribute = ValueOf<typeof RiskSurfaceAttributes>;

export interface PrRef {
  repo: string;
  number: number;
  title: string;
  url: string;
  sha: string;
  description: string;
}

export interface ChunkLoc {
  added: number;
  deleted: number;
}

export interface LineRange {
  start: number;
  end: number;
}

/**
 * @description Mechanical prevHead→head changed lines for one file (ADR 0021).
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

export type DiffLineKind = "hunk" | "add" | "del" | "ctx" | "note";

export interface DiffLine {
  kind: DiffLineKind;
  content: string;
  oldLine?: number;
  newLine?: number;
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
  riskSurface: RiskSurfaceAttribute[];
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

export interface ConcernRollup {
  concern: Concern;
  added: number;
  deleted: number;
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

export interface Brief {
  artifactKind: "brief" | "delta";
  pr: PrRef;
  summary: string;
  changeGroups: ChangeGroup[];
  chunks: BriefChunk[];
  concernView: ConcernRollup[];
  index?: number;
  commitRange?: CommitRange;
  generation?: Generation;
  baselineSha?: string;
  headSha?: string;
  baselineIndex?: number | null;
  headIndex?: number | null;
  commentsAddressed?: string;
  reviewComments?: AddressedReviewComment[];
  wholePrImpact?: string;
}

/** Which comparison baseline a mechanical marks sidecar is relative to (ADR 0024). */
export type ComparisonBaselineLabel = "previous-brief" | "checkpoint";

/**
 * @description Top-level fields of a `.comparison.json` marks sidecar (ADR 0024)
 * needed to determine comparison availability. `files` is intentionally omitted
 * here — availability only needs the header; readers that need per-line marks
 * fetch the full sidecar separately.
 */
export interface ComparisonMarksSummary {
  baselineSha: string;
  headSha: string;
  baselineLabel: ComparisonBaselineLabel;
  baselineIndex: number | null;
}

/**
 * @description Availability of the shared Previous-Brief comparison for one
 * Brief head: the mechanical marks exist (source of truth), and — when
 * generated — the matching Revision narrative sidecar id (real narrative or
 * skip stub; callers discriminate on `artifactKind` after fetching).
 */
export interface PreviousBriefComparisonAvailability {
  marksId: string;
  narrativeId?: string;
  baselineSha: string;
  baselineIndex: number;
}

/**
 * @description Availability of the personal "Your last review" comparison for
 * one Brief head, approximated locally from available Delta artifacts.
 * `deltaId` is optional: `delta-cli` writes checkpoint marks before the Delta
 * LLM call, so marks can exist without a Delta (ADR 0024 marks-emission rule).
 * A marks-only baseline is still "available" — the marks are the comparison.
 */
export interface LastReviewComparisonAvailability {
  marksId: string;
  deltaId?: string;
  baselineSha: string;
  baselineIndex: number | null;
}

/**
 * @description Comparison availability for one Brief head (ADR 0024). Absent
 * keys mean that baseline has no mechanical marks for this head — the FE
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
  /** Only populated for `artifactKind: "brief"` entries (ADR 0024, plan step 5). */
  comparisons?: ComparisonAvailability;
}
