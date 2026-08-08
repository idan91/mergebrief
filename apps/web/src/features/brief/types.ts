// Brief artifact shapes + closed vocabularies (ADR 0021/0024/0025/0026).
// Mirrors brief-core's `types.ts`: the vocabularies below carry the SAME wire
// values, re-declared here as as-const maps. Hand-rolled by design — this
// feature parses artifacts with its own guards (`validation.ts`) rather than
// importing the generator's Zod schemas, which would drag brief-core into the
// client bundle. The mirrored vocabularies and unions are pinned to their
// source by lockstep tests (`types.test.ts` imports brief-core at dev time and
// asserts equality), because CI's per-package path filter would otherwise let
// an upstream vocabulary change land green (BRIEF-23).
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
  CARRIER: "carrier",
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

/** GitHub PR lifecycle states — a merged PR's `state` is `closed`. */
export type PrLifecycleState = "open" | "closed";

/**
 * @description Live PR lifecycle from the DB route's webhook-maintained
 * pull-request row (BRIEF-103 spec: "DB path live via webhooks") — folds
 * merged into the state like the DB vocabulary does. When present it
 * SUPERSEDES the artifact's stamped snapshot; the local file path never
 * has it and falls back to the stamp. Structural on purpose: the pulls
 * feature's `PrSummary` slice assigns without a lateral import.
 */
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
   * @description PR lifecycle snapshot stamped at generation time
   * (BRIEF-103) — a snapshot by design, no staleness hint. Absent on
   * pre-stamping artifacts; the state badge simply doesn't render.
   */
  state?: PrLifecycleState;
  draft?: boolean;
  merged?: boolean;
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
  /**
   * @description BRIEF-85: meaningful only on `deviations` — the PR
   * description acknowledges the reversal, making the item a quiet receipt
   * rather than an alarm. Generation forces it `false` in every other bucket;
   * pre-BRIEF-85 Briefs have no such field and read as `false`.
   */
  acknowledged: boolean;
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
  /**
   * @description BRIEF-85 alarm bucket: stated asks the diff moves AGAINST
   * that the corpus nowhere retracts. Items whose `acknowledged` is true are
   * quiet receipts (the description owns the reversal) and render at the tail,
   * apart from the unacknowledged ones. Empty on a pre-BRIEF-85 Brief.
   */
  deviations: IntentItem[];
  /**
   * @description BRIEF-85 alarm bucket: asks the corpus claims are fixed
   * while the diff touches only the problem's signal/check path. Empty on a
   * pre-BRIEF-85 Brief.
   */
  claimedButUnachieved: IntentItem[];
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
 * @description Cross-revision anchor provenance (BRIEF-143), CLI-assigned:
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
 * @description One prose field exceeding the BRIEF-148 length caps —
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
  index?: number;
  commitRange?: CommitRange;
  generation?: Generation;
  anchor?: BriefAnchor;
  /**
   * @description Warning lines the generation pipeline emitted (salvage,
   * feedback retry, served-model mismatch) — CLI-collected (BRIEF-11).
   * Rendered under the header meta line so a degraded generation is
   * visible, not just finished.
   */
  generationWarnings?: string[];
  /**
   * @description Prose fields exceeding the BRIEF-148 length caps —
   * pipeline-stamped; absent when everything fits.
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
  /**
   * @description Prose fields exceeding the BRIEF-148 length caps —
   * pipeline-stamped; absent when everything fits.
   */
  lengthViolations?: LengthViolation[];
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
