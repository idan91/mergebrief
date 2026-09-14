// Shared utility types and maps live in `types`; re-exported here so this
// package's public contract (`index.ts` re-exports `Result`/`ValueOf` to
// consumers) is unchanged.
import type { Brand, CommentAnchorKind, ValueOf } from "types";

export {
  type Brand,
  type MaybePromise,
  type Result,
  type ValueOf,
} from "types";

/**
 * Branded identifiers. These prevent the exact installation_id/repo_id swap
 * the tenancy invariant can't afford. Backed by `bigint` to match Postgres
 * `bigint` identity columns.
 */
export type InstallationId = Brand<bigint, "InstallationId">;
export type RepoId = Brand<bigint, "RepoId">;
export type ReviewerId = Brand<bigint, "ReviewerId">;
export type PullRequestRowId = Brand<bigint, "PullRequestRowId">;
export type BriefRowId = Brand<bigint, "BriefRowId">;
export type ApiTokenRowId = Brand<bigint, "ApiTokenRowId">;
export type GrantRowId = Brand<bigint, "GrantRowId">;
export type ReviewSessionId = Brand<bigint, "ReviewSessionId">;

/**
 * Type guards for branding raw bigints at boundaries (webhook payloads,
 * job payloads, test fixtures). GitHub numeric ids and identity-column
 * values are always positive; the guard is the sanctioned way to brand,
 * never `as`.
 */
function isPositiveBigInt(value: bigint): boolean {
  return value > 0n;
}
export function isInstallationId(value: bigint): value is InstallationId {
  return isPositiveBigInt(value);
}
export function isRepoId(value: bigint): value is RepoId {
  return isPositiveBigInt(value);
}
export function isReviewerId(value: bigint): value is ReviewerId {
  return isPositiveBigInt(value);
}
export function isPullRequestRowId(value: bigint): value is PullRequestRowId {
  return isPositiveBigInt(value);
}
export function isBriefRowId(value: bigint): value is BriefRowId {
  return isPositiveBigInt(value);
}
export function isApiTokenRowId(value: bigint): value is ApiTokenRowId {
  return isPositiveBigInt(value);
}
export function isGrantRowId(value: bigint): value is GrantRowId {
  return isPositiveBigInt(value);
}
export function isReviewSessionId(value: bigint): value is ReviewSessionId {
  return isPositiveBigInt(value);
}

/**
 * Closed vocabularies. Stored as plain `text` columns, not `pgEnum`, but
 * CHECK-constrained in the DB, so adding a value needs a code change AND a
 * migration, in lockstep. The `as const` map + `ValueOf` union is the
 * compile-time contract.
 */

/**
 * `pull_request.source`: which door created the row: the App-installation
 * webhook world or the signed-in URL box. Paired with the owner-shape CHECK:
 * `app-installation` rows carry `installation_id`, `url-box` rows carry
 * `owner_user_id`. Audit entries carry the same vocabulary.
 */
export const PullRequestSources = {
  APP_INSTALLATION: "app-installation",
  URL_BOX: "url-box",
} as const;
export type PullRequestSource = ValueOf<typeof PullRequestSources>;

/** `pull_request.state`. */
export const PrStates = {
  OPEN: "open",
  CLOSED: "closed",
  MERGED: "merged",
} as const;
export type PrState = ValueOf<typeof PrStates>;

/** `disposition.decision`. */
export const DispositionDecisions = {
  ADDRESSED: "addressed",
  DISMISSED: "dismissed",
} as const;
export type DispositionDecision = ValueOf<typeof DispositionDecisions>;

/**
 * `disposition.carry_status`: how this row reached the session it sits in.
 * Nullable in the DB: a decision made in this session carries no status.
 */
export const DispositionCarryStatuses = {
  NEW: "new",
  REOPENED: "reopened",
  SETTLED: "settled",
  DROPPED: "dropped",
} as const;
export type DispositionCarryStatus = ValueOf<typeof DispositionCarryStatuses>;

/**
 * `disposition.evidence_status`: a one-value vocabulary today; nullable
 * means the evidence the decision claimed is still present.
 */
export const DispositionEvidenceStatuses = {
  MISSING_EVIDENCE: "missing-evidence",
} as const;
export type DispositionEvidenceStatus = ValueOf<
  typeof DispositionEvidenceStatuses
>;

/**
 * `disposition.evidence_kind`: what an addressing decision points at. The
 * kind is what makes `evidence_ref` readable: a draft comment's row id, a
 * Chunk id, or the reviewer's own words. Null on a dismissal, which carries
 * its `reason` instead.
 */
export const DispositionEvidenceKinds = {
  LINKED_COMMENT: "linked-comment",
  CHUNK_REVIEWED: "chunk-reviewed",
  MANUAL_NOTE: "manual-note",
} as const;
export type DispositionEvidenceKind = ValueOf<typeof DispositionEvidenceKinds>;

/** The evidence an `address-risk` claims; `ref` reads per `kind`. */
export interface DispositionEvidence {
  readonly kind: DispositionEvidenceKind;
  /** A draft-comment row id, a Chunk id, or the note itself; null when empty. */
  readonly ref: string | null;
}

/**
 * `api_token.scope`: the same three rungs the Product Operation catalog
 * classifies every operation by, cumulative left to right. One vocabulary for
 * both is what keeps the scope check a lookup rather than a mapping, so
 * `apps/api` re-exports this map rather than declaring its own. Chosen at
 * mint, immutable for the token's life.
 */
export const WriteClassifications = {
  READ: "read",
  PRIVATE_WRITE: "private-write",
  EXTERNAL_WRITE: "external-write",
} as const;
export type WriteClassification = ValueOf<typeof WriteClassifications>;

/** `generation.kind`. */
export const GenerationKinds = {
  BRIEF: "brief",
  DELTA: "delta",
  REVISION_NARRATIVE: "revision-narrative",
} as const;
export type GenerationKind = ValueOf<typeof GenerationKinds>;

/**
 * `generation.status`. `superseded` = a mid-call generation aborted because
 * the PR head advanced; `capped` = a skip because the repo hit its daily
 * generation cap. Neither is a failure; both are terminal and consume no
 * attempt.
 */
export const GenerationStatuses = {
  PENDING: "pending",
  RUNNING: "running",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
  SUPERSEDED: "superseded",
  CAPPED: "capped",
} as const;
export type GenerationStatus = ValueOf<typeof GenerationStatuses>;

/** `generation.phase`: optional determinate-progress detail. */
export const GenerationPhases = {
  FETCHING: "fetching",
  REDACTING: "redacting",
  GENERATING: "generating",
  WRITING: "writing",
} as const;
export type GenerationPhase = ValueOf<typeof GenerationPhases>;

/**
 * `generation.error_code`: the DB-stored failure vocabulary (CHECK-
 * constrained; adding a code needs a migration in lockstep). Distinct from
 * the store-internal `GenerationErrorCodes`. The web catalog renders
 * `generationError.<code>`; a new code also needs its catalog key and the
 * web vocab mirror.
 */
export const GenerationFailureCodes = {
  PROVIDER_AUTH: "provider-auth",
  PROVIDER_RATE_LIMIT: "provider-rate-limit",
  PROVIDER_TIMEOUT: "provider-timeout",
  PROVIDER_UNAVAILABLE: "provider-unavailable",
  PROVIDER_REFUSAL: "provider-refusal",
  OUTPUT_INVALID: "output-invalid",
  GENERATION_CONFIG: "generation-config",
  GITHUB_ACCESS: "github-access",
  DIFF_TOO_LARGE: "diff-too-large",
  GITHUB_UNAVAILABLE: "github-unavailable",
  UNKNOWN: "unknown",
} as const;
export type GenerationFailureCode = ValueOf<typeof GenerationFailureCodes>;

/** Codes that carry interpolation params, typed per code. */
export interface GenerationFailureParamMap {
  [GenerationFailureCodes.GENERATION_CONFIG]: { readonly detail: string };
  [GenerationFailureCodes.UNKNOWN]: { readonly detail: string };
}

type ParamFailureCode = keyof GenerationFailureParamMap;
type ParamlessFailureCode = Exclude<GenerationFailureCode, ParamFailureCode>;

/**
 * What `markFailed` takes: the typed failure union. `detail` params are
 * sanitized INSIDE persistence (callers cannot bypass).
 */
export type GenerationFailure =
  | { readonly code: ParamlessFailureCode }
  | {
      [K in ParamFailureCode]: {
        readonly code: K;
        readonly params: GenerationFailureParamMap[K];
      };
    }[ParamFailureCode];

/** The `generation.error_params` jsonb shape (today: detail only). */
export interface GenerationFailureParams {
  readonly detail: string;
}

/** `audit_log.actor_type`. */
export const AuditActorTypes = {
  REVIEWER: "reviewer",
  APP: "app",
  SYSTEM: "system",
} as const;
export type AuditActorType = ValueOf<typeof AuditActorTypes>;

/** `audit_log.classification`: where the audited write landed. The same
 * vocabulary `api_token.scope` uses, minus `read`: reads are never audited. */
export type AuditClassification = Exclude<
  WriteClassification,
  typeof WriteClassifications.READ
>;

/** `audit_log.channel`: the credential surface the call arrived on. */
export const AuditChannels = {
  COOKIE: "cookie",
  BEARER: "bearer",
  WEBHOOK: "webhook",
  WORKER: "worker",
} as const;
export type AuditChannel = ValueOf<typeof AuditChannels>;

/** `audit_log.outcome`: how the audited action ended. */
export const AuditOutcomes = {
  OK: "ok",
  DENIED: "denied",
  FAILED: "failed",
} as const;
export type AuditOutcome = ValueOf<typeof AuditOutcomes>;

/** `review_session.review_outcome`: the provisional submit verdict. */
export const ReviewOutcomes = {
  COMMENT: "comment",
  APPROVE: "approve",
  REQUEST_CHANGES: "request-changes",
} as const;
export type ReviewOutcome = ValueOf<typeof ReviewOutcomes>;

/** `review_draft_comment.status`. */
export const DraftCommentStatuses = {
  DRAFT: "draft",
  SUBMITTED: "submitted",
} as const;
export type DraftCommentStatus = ValueOf<typeof DraftCommentStatuses>;

interface DraftAnchorBase {
  readonly kind: CommentAnchorKind;
  readonly file: string;
}

export interface LineDraftAnchor extends DraftAnchorBase {
  readonly kind: Extract<CommentAnchorKind, "line">;
  readonly side: DraftCommentSide;
  readonly startLine: number;
  readonly endLine: number;
  readonly startSide?: DraftCommentSide;
}

export interface FileDraftAnchor extends DraftAnchorBase {
  readonly kind: Extract<CommentAnchorKind, "file">;
}

export type DraftAnchor = LineDraftAnchor | FileDraftAnchor;

/**
 * `review_draft_comment.side`: the diff side the coordinates address. The
 * client's vocabulary, mapped to GitHub's LEFT/RIGHT only at submit.
 */
export const DraftCommentSides = {
  OLD: "old",
  NEW: "new",
} as const;
export type DraftCommentSide = ValueOf<typeof DraftCommentSides>;

/**
 * `review_draft_comment.anchor_status`: carry-over verdict on a comment's
 * coordinates. NULL means the anchor still holds exactly.
 */
export const AnchorStatuses = {
  MOVED: "moved",
  ORPHANED: "orphaned",
} as const;
export type AnchorStatus = ValueOf<typeof AnchorStatuses>;

/**
 * `review_group_reclassification.category`: the Change-group intent
 * vocabulary, wire-identical to brief-core's `Categories`. Mirrored here (not
 * imported) so the schema package stays off brief-core's dependency graph;
 * `test/review-session.test.ts` pins the mirror against the source AND
 * against the DB CHECK, so all three move together.
 */
export const ChangeGroupCategories = {
  BUGFIX: "bugfix",
  LOGIC_REFACTOR: "logic-refactor",
  MOVE_WITH_EDITS: "move-with-edits",
  LIB_BUMP: "lib-bump",
  PURE_MOVE: "pure-move",
  NEW_FEATURE: "new-feature",
  DEPENDENCY_UPDATE: "dependency-update",
  SCHEMA_CHANGE: "schema-change",
} as const;
export type ChangeGroupCategory = ValueOf<typeof ChangeGroupCategories>;
