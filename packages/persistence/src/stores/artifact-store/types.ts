import type { brief } from "../../schema/brief";
import type { chunkLayout } from "../../schema/chunk-layout";
import type { comparisonMarks } from "../../schema/comparison-marks";
import type { delta } from "../../schema/delta";
import type { hunkSpan } from "../../schema/hunk-span";
import type { revisionNarrative } from "../../schema/revision-narrative";
import type { ScopeContext } from "../scope-context";
import type { BriefRowId, PullRequestRowId } from "../../types";

export type BriefRow = typeof brief.$inferSelect;

/** Lean brief listing row: span/index metadata only, never the body. */
export interface BriefSpanRow {
  readonly id: BriefRowId;
  readonly baseSha: string;
  readonly headSha: string;
  readonly headIndex: number;
  readonly createdAt: Date;
}

/**
 * Lean comparison-span listing row: the natural-key SHA pair only, never the
 * body (marks / delta). Feeds the PR-meta per-revision availability join: one
 * listing per kind, existence derived in memory.
 */
export interface ComparisonSpanRow {
  readonly baselineSha: string;
  readonly headSha: string;
}

/** A delta span, and whether its body is the span's skip record instead of a Delta Brief. */
export interface DeltaSpanRow extends ComparisonSpanRow {
  readonly skipped: boolean;
}

/** The prevHead/head pair only, never the body. */
export interface NarrativeSpanRow {
  readonly prevHeadSha: string;
  readonly headSha: string;
}
export type DeltaRow = typeof delta.$inferSelect;
/** The sidecar row with its body as stored text; the api serves it verbatim. */
export type ChunkLayoutRow = Pick<
  typeof chunkLayout.$inferSelect,
  "id" | "briefId" | "body" | "byteSize" | "createdAt"
>;
export type RevisionNarrativeRow = typeof revisionNarrative.$inferSelect;
export type ComparisonMarksRow = typeof comparisonMarks.$inferSelect;
export type HunkSpanRow = typeof hunkSpan.$inferSelect;

/** Origin trio surfaced on the Receipt. */
export interface Origin {
  readonly provider: string;
  readonly model: string;
  readonly effort: string;
}

interface BodyVersionStamp {
  /** The body shape version this writer wrote; a rewrite replaces it with the body. */
  readonly bodyVersion: number;
}

export interface BriefWriteInput extends Origin, BodyVersionStamp {
  readonly pullRequestId: PullRequestRowId;
  /** PR-base SHA, the whole-PR span's lower bound. */
  readonly baseSha: string;
  readonly headSha: string;
  readonly headIndex: number;
  readonly commitCount: number;
  readonly body: string;
  /**
   * Repo-config origin + policy snapshot JSON. The worker serializes it; this
   * layer stores it opaquely like `body`. Omit for generations that never ran
   * the repo-config phase.
   */
  readonly repoConfig?: string;
  /**
   * Anchor origin: 'anchored' | 'fresh-restart' | 'none', DB-enforced. Omit
   * only for writers predating the stamp; the worker always stamps.
   */
  readonly anchorState?: string;
  /** Fresh-restart reason ('model-swap'); only with anchorState 'fresh-restart'. */
  readonly anchorReason?: string;
  /**
   * The chunk ids carried from the previous Brief. Empty for a fresh
   * restart; omit only for writers predating the stamp.
   */
  readonly carriedChunkIds?: readonly string[];
  /** Every group id the PR's Brief chain has used, this Brief included. */
  readonly usedGroupIds: readonly string[];
  /**
   * The brief's `chunk_layout` counts, checked with `ChunkLayoutBodySchema`.
   * The write replaces the brief's sidecar in its own transaction; omitted,
   * it drops the sidecar, since a rewritten body's counts are unknown.
   */
  readonly chunkLayout?: unknown;
}

export interface DeltaWriteInput extends Origin, BodyVersionStamp {
  readonly pullRequestId: PullRequestRowId;
  /** Checkpoint baseline: a prior head at last submit. */
  readonly baselineSha: string;
  readonly headSha: string;
  readonly body: string;
}

export interface RevisionNarrativeWriteInput extends Origin, BodyVersionStamp {
  readonly pullRequestId: PullRequestRowId;
  /** The anchoring `brief` row; verified in-tenant + same-PR. */
  readonly briefId: BriefRowId;
  /** Prior briefed head, the third SHA role. */
  readonly prevHeadSha: string;
  readonly headSha: string;
  readonly body: string;
}

export interface ChunkLayoutBackfillInput {
  readonly pullRequestId: PullRequestRowId;
  /** The brief the counts describe; verified in-tenant + same-PR. */
  readonly briefId: BriefRowId;
  /**
   * Counts by chunk id and by remainder file, validated with
   * `ChunkLayoutBodySchema`. Typed `unknown` because this is the boundary
   * that refuses anything beyond counts.
   */
  readonly body: unknown;
}

export interface HunkSpanWriteInput {
  readonly pullRequestId: PullRequestRowId;
  /** The previous Brief's head. */
  readonly baselineSha: string;
  readonly headSha: string;
  /**
   * The `@@` coordinates, validated with `HunkSpansSchema`. Typed `unknown`
   * because this is the boundary that rejects anything content-bearing.
   */
  readonly spans: unknown;
}

export interface ComparisonMarksWriteInput {
  readonly pullRequestId: PullRequestRowId;
  /**
   * The marks payload, validated with `ComparisonMarksBodySchema`. Typed
   * `unknown` because this is the boundary that rejects the CLI's extra keys;
   * the natural-key SHAs are taken from the validated body, not passed apart.
   */
  readonly marks: unknown;
}

export interface BriefStore {
  write(input: BriefWriteInput): Promise<BriefRow>;
  get(
    pullRequestId: PullRequestRowId,
    baseSha: string,
    headSha: string,
  ): Promise<BriefRow | undefined>;
  /** Whether a brief covers (base, head), without reading its body. */
  has(
    pullRequestId: PullRequestRowId,
    baseSha: string,
    headSha: string,
  ): Promise<boolean>;
  /**
   * All briefs on a PR, ordered by `headIndex` ascending: the worker's
   * DB-mode stand-in for the CLI manifest: next index = max + 1, previous
   * briefed head = the highest-index row whose head differs. Deliberately a
   * LEAN projection (key/index columns only, never `body`): the caller wants
   * span metadata, and a long-lived PR can hold many multi-hundred-KB bodies.
   */
  listForPullRequest(pullRequestId: PullRequestRowId): Promise<BriefSpanRow[]>;
  /**
   * The LATEST brief (highest `head_index`) per PR, batched for the list and
   * PR-meta endpoints' "current span" derivation. Lean rows (never `body`);
   * PRs with no brief are simply absent from the map.
   */
  latestForPullRequests(
    pullRequestIds: readonly PullRequestRowId[],
  ): Promise<ReadonlyMap<PullRequestRowId, BriefSpanRow>>;
  /**
   * Lean read of ONE span's repo-config snapshot: the brief-context
   * endpoint's backing query. Never loads `body` (multi-hundred-KB).
   * `undefined` = no brief row for the span; `null` = the row exists but
   * recorded no snapshot.
   */
  getRepoConfig(
    pullRequestId: PullRequestRowId,
    baseSha: string,
    headSha: string,
  ): Promise<string | null | undefined>;
}

export interface DeltaStore {
  write(input: DeltaWriteInput): Promise<DeltaRow>;
  get(
    pullRequestId: PullRequestRowId,
    baselineSha: string,
    headSha: string,
  ): Promise<DeltaRow | undefined>;
  /**
   * All delta spans on a PR: the SHA pair and the `skipped` column, never
   * the body. One query backs the per-revision lastReview join; existence is
   * derived in memory, never one probe per revision.
   */
  listForPullRequest(pullRequestId: PullRequestRowId): Promise<DeltaSpanRow[]>;
}

export interface RevisionNarrativeStore {
  write(input: RevisionNarrativeWriteInput): Promise<RevisionNarrativeRow>;
  get(
    pullRequestId: PullRequestRowId,
    prevHeadSha: string,
    headSha: string,
  ): Promise<RevisionNarrativeRow | undefined>;
  /**
   * All narrative spans on a PR: the prevHead/head pair only, never the
   * body. One query backs the per-revision previousBrief narrative join.
   */
  listForPullRequest(
    pullRequestId: PullRequestRowId,
  ): Promise<NarrativeSpanRow[]>;
}

export interface ComparisonMarksStore {
  /** Throws `InvalidArtifactBodyError` when the body is not coordinates-only. */
  write(input: ComparisonMarksWriteInput): Promise<ComparisonMarksRow>;
  get(
    pullRequestId: PullRequestRowId,
    baselineSha: string,
    headSha: string,
  ): Promise<ComparisonMarksRow | undefined>;
  /**
   * All marks spans on a PR: the SHA pair only, never the body. One query
   * backs BOTH per-revision joins (previousBrief marks, lastReview marks);
   * existence is derived in memory, never one probe per revision.
   */
  listForPullRequest(
    pullRequestId: PullRequestRowId,
  ): Promise<ComparisonSpanRow[]>;
}

export interface HunkSpanStore {
  /** Throws `InvalidArtifactBodyError` when the spans are not coordinates-only. */
  write(input: HunkSpanWriteInput): Promise<HunkSpanRow>;
  /**
   * Every hop on a PR, full rows, ordered by row id: insertion order, NOT
   * chain order (a re-generated span keeps its original id). A chain links
   * `baseline_sha → head_sha` along consecutive brief heads, never by position
   * or by every row matching a baseline: rows FORK on a shared baseline when a
   * head's generation failed after its hop. A pair with no row enters the
   * chain as `undefined`, never skipped: skipping it passes anchors through
   * onto post-push line numbers.
   */
  listForPullRequest(pullRequestId: PullRequestRowId): Promise<HunkSpanRow[]>;
}

export interface ChunkLayoutStore {
  /**
   * Stores a sidecar for a brief that has none; true when it inserted. A
   * sidecar already there stays. A brief outside the scope or PR throws
   * `ScopeViolationError` before any insert.
   */
  backfill(input: ChunkLayoutBackfillInput): Promise<boolean>;
  /** Whether the brief carries a sidecar, without reading its body. */
  has(briefId: BriefRowId): Promise<boolean>;
  /** The sidecar of the brief covering (base, head); undefined when the brief has none. */
  get(
    pullRequestId: PullRequestRowId,
    baseSha: string,
    headSha: string,
  ): Promise<ChunkLayoutRow | undefined>;
}

export interface ArtifactStore {
  readonly ctx: ScopeContext;
  readonly briefs: BriefStore;
  readonly chunkLayouts: ChunkLayoutStore;
  readonly deltas: DeltaStore;
  readonly revisionNarratives: RevisionNarrativeStore;
  readonly comparisonMarks: ComparisonMarksStore;
  readonly hunkSpans: HunkSpanStore;
}
