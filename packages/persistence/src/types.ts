// Shared utility types live in `types` (types-only, zero runtime);
// re-exported here so this package's public contract (`index.ts` re-exports
// `Result`/`ValueOf` to consumers) is unchanged.
import type { Brand, ValueOf } from "types";

export type { Brand, MaybePromise, Result, ValueOf } from "types";

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
 * values are always positive; the guard is the sanctioned way to brand —
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
 * Closed vocabularies. Stored as plain `text` columns — no `pgEnum` — but
 * CHECK-constrained in the DB, so adding a value needs a code change AND a
 * migration, in lockstep. The `as const` map + `ValueOf` union is the
 * compile-time contract.
 */

/** `pull_request.state`. */
export const PrState = {
  OPEN: "open",
  CLOSED: "closed",
  MERGED: "merged",
} as const;
export type PrState = ValueOf<typeof PrState>;

/** `disposition.decision`. */
export const DispositionDecision = {
  ADDRESSED: "addressed",
  DISMISSED: "dismissed",
} as const;
export type DispositionDecision = ValueOf<typeof DispositionDecision>;

/** `generation.kind`. */
export const GenerationKind = {
  BRIEF: "brief",
  DELTA: "delta",
  REVISION_NARRATIVE: "revision-narrative",
} as const;
export type GenerationKind = ValueOf<typeof GenerationKind>;

/**
 * `generation.status`. `superseded` = a mid-call generation aborted because
 * the PR head advanced; `capped` = a skip because the repo hit its daily
 * generation cap. Neither is a failure — both are terminal and consume no
 * attempt.
 */
export const GenerationStatus = {
  QUEUED: "queued",
  RUNNING: "running",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
  SUPERSEDED: "superseded",
  CAPPED: "capped",
} as const;
export type GenerationStatus = ValueOf<typeof GenerationStatus>;

/** `generation.phase` — optional determinate-progress detail. */
export const GenerationPhase = {
  FETCHING: "fetching",
  REDACTING: "redacting",
  GENERATING: "generating",
  WRITING: "writing",
} as const;
export type GenerationPhase = ValueOf<typeof GenerationPhase>;

/**
 * `generation.error_code` — the DB-stored failure vocabulary (CHECK-
 * constrained; adding a code needs a migration in lockstep). Distinct from
 * the store-internal `GenerationErrorCode`. The web catalog renders
 * `generationError.<code>`; a new code also needs its catalog key and the
 * web vocab mirror.
 */
export const GenerationFailureCode = {
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
export type GenerationFailureCode = ValueOf<typeof GenerationFailureCode>;

/** Codes that carry interpolation params, typed per code. */
export interface GenerationFailureParamMap {
  [GenerationFailureCode.GENERATION_CONFIG]: { readonly detail: string };
  [GenerationFailureCode.UNKNOWN]: { readonly detail: string };
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
export const AuditActorType = {
  REVIEWER: "reviewer",
  APP: "app",
  SYSTEM: "system",
} as const;
export type AuditActorType = ValueOf<typeof AuditActorType>;

/**
 * `audit_log.action`. CHECK-constrained in the DB — adding a value needs a
 * code change AND a migration, in lockstep.
 */
export const AuditAction = {
  GENERATE: "generate",
  DELETE: "delete",
  CONFIG: "config",
  AUTH: "auth",
  SUBMIT: "submit",
  MARK_READY: "mark-ready",
  RESOLVE_THREAD: "resolve-thread",
  UNRESOLVE_THREAD: "unresolve-thread",
} as const;
export type AuditAction = ValueOf<typeof AuditAction>;

/** `review_session.review_outcome` — the provisional submit verdict. */
export const ReviewOutcome = {
  COMMENT: "comment",
  APPROVE: "approve",
  REQUEST_CHANGES: "request-changes",
} as const;
export type ReviewOutcome = ValueOf<typeof ReviewOutcome>;

/** `review_draft_comment.status`. */
export const DraftCommentStatus = {
  DRAFT: "draft",
  SUBMITTED: "submitted",
} as const;
export type DraftCommentStatus = ValueOf<typeof DraftCommentStatus>;

/**
 * `review_draft_comment.side` — the diff side the coordinates address. The
 * client's vocabulary, mapped to GitHub's LEFT/RIGHT only at submit.
 */
export const DraftCommentSide = {
  OLD: "old",
  NEW: "new",
} as const;
export type DraftCommentSide = ValueOf<typeof DraftCommentSide>;

/**
 * `review_draft_comment.anchor_status` — carry-over verdict on a comment's
 * coordinates. NULL means the anchor still holds exactly.
 */
export const AnchorStatus = {
  MOVED: "moved",
  ORPHANED: "orphaned",
} as const;
export type AnchorStatus = ValueOf<typeof AnchorStatus>;

/**
 * `review_group_reclassification.category` — the Change-group intent
 * vocabulary, wire-identical to brief-core's `Categories`. Mirrored here (not
 * imported) so the schema package stays off brief-core's dependency graph;
 * `test/review-session.test.ts` pins the mirror against the source AND
 * against the DB CHECK, so all three move together.
 */
export const ChangeGroupCategory = {
  BUGFIX: "bugfix",
  LOGIC_REFACTOR: "logic-refactor",
  MOVE_WITH_EDITS: "move-with-edits",
  LIB_BUMP: "lib-bump",
  PURE_MOVE: "pure-move",
  NEW_FEATURE: "new-feature",
  DEPENDENCY_UPDATE: "dependency-update",
  SCHEMA_CHANGE: "schema-change",
} as const;
export type ChangeGroupCategory = ValueOf<typeof ChangeGroupCategory>;
