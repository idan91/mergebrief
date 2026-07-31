// Shared utility types live in `types` (types-only, zero runtime);
// re-exported here so this package's public contract (`index.ts` re-exports
// `Result`/`ValueOf` to consumers) is unchanged.
import type { Brand, ValueOf } from "types";

export type { Brand, MaybePromise, Result, ValueOf } from "types";

/**
 * Branded identifiers for the id families ADR 0018 (D1) makes load-bearing.
 * These prevent the exact installation_id/repo_id swap the tenancy
 * invariant (D2b) can't afford. Backed by `bigint` to match Postgres
 * `bigint` identity columns.
 */
export type InstallationId = Brand<bigint, "InstallationId">;
export type RepoId = Brand<bigint, "RepoId">;
export type ReviewerId = Brand<bigint, "ReviewerId">;
export type PullRequestRowId = Brand<bigint, "PullRequestRowId">;
export type BriefRowId = Brand<bigint, "BriefRowId">;
export type ApiTokenRowId = Brand<bigint, "ApiTokenRowId">;
export type GrantRowId = Brand<bigint, "GrantRowId">;

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

/**
 * Closed vocabularies (ADR 0018). Stored as plain `text` columns — no
 * `pgEnum` — so adding a value is a code change, not a migration. The
 * `as const` map + `ValueOf` union is the compile-time contract.
 */

/** `pull_request.state` (D5). */
export const PrState = {
  OPEN: "open",
  CLOSED: "closed",
  MERGED: "merged",
} as const;
export type PrState = ValueOf<typeof PrState>;

/** `disposition.decision` (D7). */
export const DispositionDecision = {
  ADDRESSED: "addressed",
  DISMISSED: "dismissed",
} as const;
export type DispositionDecision = ValueOf<typeof DispositionDecision>;

/** `generation.kind` (D10, extended by D12 with `revision-narrative`). */
export const GenerationKind = {
  BRIEF: "brief",
  DELTA: "delta",
  REVISION_NARRATIVE: "revision-narrative",
} as const;
export type GenerationKind = ValueOf<typeof GenerationKind>;

/**
 * `generation.status` (D10). `superseded` = terminal abort-on-supersession
 * (ADR 0006 #6, added BRIEF-2): a mid-call generation aborted because the PR
 * head advanced. An abort is NOT a failure — it consumes no attempt.
 */
export const GenerationStatus = {
  QUEUED: "queued",
  RUNNING: "running",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
  SUPERSEDED: "superseded",
} as const;
export type GenerationStatus = ValueOf<typeof GenerationStatus>;

/** `generation.phase` (D10; optional determinate-progress detail). */
export const GenerationPhase = {
  FETCHING: "fetching",
  REDACTING: "redacting",
  GENERATING: "generating",
  WRITING: "writing",
} as const;
export type GenerationPhase = ValueOf<typeof GenerationPhase>;

/** `audit_log.actor_type` (D9). */
export const AuditActorType = {
  REVIEWER: "reviewer",
  APP: "app",
  SYSTEM: "system",
} as const;
export type AuditActorType = ValueOf<typeof AuditActorType>;

/**
 * `audit_log.action` (D9; `view` may join later). CHECK-constrained since
 * migration 0002 — adding a value needs a code change AND a migration, in
 * lockstep (`submit` landed with 0007, BRIEF-23).
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

