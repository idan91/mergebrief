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
  NewDependency: "new-dependency",
  NewAbstraction: "new-abstraction",
  CommentContradictsCode: "comment-contradicts-code",
  ExternalIo: "external-io",
  CrossService: "cross-service",
  SchemaAdjacent: "schema-adjacent",
  HotPath: "hot-path",
  WidelyImported: "widely-imported",
  ReleaseImminent: "release-imminent",
} as const;

// Re-exported from the shared types-only package; kept on this module so
// existing `import { type ValueOf } from "./types"` sites stay valid.
export type { ValueOf } from "types";
import type { ValueOf } from "types";

export type Category = ValueOf<typeof Categories>;
export type Concern = ValueOf<typeof Concerns>;
export type Role = ValueOf<typeof Roles>;
export type RiskSurfaceAttribute = ValueOf<typeof RiskSurfaceAttributes>;

/**
 * @description A risk-surface token on a stored chunk: a built-in
 * `RiskSurfaceAttribute` or a repo-policy custom attribute name (BRIEF-52 —
 * the closed vocabulary is per-generation and enum-enforced server-side, so
 * the static type here is honestly `string`; source and display weight
 * derive from the artifact's policy snapshot, see repoConfig.ts).
 */
export type RiskToken = string;

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

/**
 * @description One short factual note evidencing a risk-surface attribute on
 * a chunk (ADR 0026) — e.g. the both-sides citation required for
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
 * @description One step of a Brief's Reading order (ADR 0025): `groupId`
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
 * @description How actionable the composite intent corpus is (BRIEF-54,
 * ADR 0009 §2 as amended). `precise` populates the three buckets; `broad`
 * and `none` render as "intent check unavailable". Plain union (the
 * `ComparisonBaselineLabel` precedent) — a small closed set used only for
 * typing.
 */
export type Specificity = "precise" | "broad" | "none";

/**
 * @description One item shared by all three intent buckets (BRIEF-54). The
 * grill-locked three-shape factoring overflowed Anthropic's structured-
 * output grammar, so one shape carries every bucket; the per-bucket field
 * rules (statedButMissing has no `groupIds`; `doneButUnstated` has no
 * `quote`/`sourceUrl`) are enforced server-side and mirrored in rendering.
 * `sourceUrl` is `""` for a PR title/description citation.
 */
export interface IntentItem {
  intent: string;
  quote: string;
  sourceUrl: string;
  groupIds: string[];
}

/**
 * @description The ticket-gated intent check (BRIEF-54): did this PR do what
 * its stated intent asked? Factual buckets, never a verdict. Full Brief
 * only — never present on a Delta Brief. Boundary-parsed defensively
 * (`validation.ts`): a malformed field is dropped to `undefined`, so by the
 * time a `Brief` reaches the app this is either well-formed or absent (a
 * pre-feature Brief renders no intent bar).
 */
export interface IntentCheck {
  ticketUrls: string[];
  specificity: Specificity;
  scopeNote: string;
  accomplished: IntentItem[];
  statedButMissing: IntentItem[];
  doneButUnstated: IntentItem[];
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
  /**
   * @description Warning lines the generation pipeline emitted (salvage,
   * feedback retry, served-model mismatch) — CLI-collected (BRIEF-11).
   * Rendered under the header meta line so a degraded generation is
   * visible, not just finished.
   */
  generationWarnings?: string[];
  baselineSha?: string;
  headSha?: string;
  baselineIndex?: number | null;
  headIndex?: number | null;
  commentsAddressed?: string;
  reviewComments?: AddressedReviewComment[];
  wholePrImpact?: string;
  /**
   * @description Reading order over `changeGroups` (ADR 0025), full Brief
   * only — never present on a Delta Brief. Boundary-parsed defensively: a
   * present-but-invalid permutation is dropped client-side (`validation.ts`),
   * so by the time a `Brief` reaches the rest of the app this is either a
   * verified permutation of `changeGroups` ids or `undefined`.
   */
  readingOrder?: ReadingOrderStep[];
  /**
   * @description The ticket-gated intent check (BRIEF-54), full Brief only.
   * Absent on pre-feature Briefs and on Delta Briefs — the intent bar
   * renders only when this is present.
   */
  intentCheck?: IntentCheck;
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
 * @description Full `.comparison.json` marks sidecar (ADR 0024): the header
 * fields plus the per-file mechanical changed-line ranges. Structurally the
 * same `files` shape as `RevisionChanges`, so both feed the same FE mark-join.
 * These marks are the *sole* source of truth for which lines are highlighted —
 * narrative/Delta summaries never decide marks (ADR 0021/0024).
 */
export interface ComparisonMarks extends ComparisonMarksSummary {
  files: RevisionChangeFile[];
}

/**
 * @description A revision-narrative chunk (ADR 0024): an incremental
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
 * Previous-Brief comparison (ADR 0024). Every chunk attaches to a full-Brief
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
  overview: string;
  chunks: RevisionNarrativeChunk[];
}

/** Why a Previous-Brief narrative was deliberately not generated (ADR 0024). */
export type RevisionNarrativeSkipReason =
  | "span too large"
  | "disabled by config";

/**
 * @description Explicit skip stub written when a Previous-Brief span never got
 * a generated narrative (huge span or config-disabled). Distinct from an absent
 * file (generation failed): a stub means "deliberately skipped, retry won't
 * help" and the FE surfaces the reason rather than a failure state (ADR 0024).
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
 * Brief head: the mechanical marks exist (source of truth), and — when
 * generated — the matching Revision narrative sidecar id (real narrative or
 * skip stub; callers discriminate on `artifactKind` after fetching).
 */
export interface PreviousBriefComparisonAvailability {
  marksId: string;
  /**
   * @description Present whenever a `.revision-narrative.json` sidecar exists —
   * INCLUDING skip stubs (`artifactKind: "revisionNarrativeSkipped"`, written
   * for huge spans or when disabled by config). narrativeId-present means
   * "there is a narrative artifact to fetch", NOT "a summary is available":
   * readers must discriminate on the fetched file's `artifactKind` and treat
   * a stub as narrative-unavailable with a knowable skip reason (ADR 0024).
   */
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
