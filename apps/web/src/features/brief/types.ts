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

/** Mechanical prevHead→head changed lines for one file (ADR 0021). */
export interface RevisionChangeFile {
  file: string;
  /** Added/changed lines in head (new-side) coords — joins on a diff row's newLine. */
  addedRanges: LineRange[];
  /** Removed lines in prevHead (old-side) coords — joins on a del row's oldLine. */
  removedRanges: LineRange[];
}

/** The revision-changes sidecar: what's new in this revision, shared/per-revision. */
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
}
