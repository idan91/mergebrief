/**
 * Union of a mapped type's value types. Used instead of `enum` for closed
 * vocabularies: pair with an `as const` object map, e.g.
 *   const GenerationStatus = { pending: "pending", done: "done" } as const;
 *   type GenerationStatus = ValueOf<typeof GenerationStatus>;
 */
export type ValueOf<T> = T[keyof T];

/**
 * Nominal-typing helper: brands a primitive type `K` with a unique tag `T`
 * so structurally identical ids (e.g. two branded bigints) are not
 * interchangeable at compile time. There is no runtime representation —
 * `Brand` only exists in the type system.
 */
export type Brand<K, T> = K & { readonly __brand: T };

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

/**
 * Closed vocabularies (ADR 0018). Stored as plain `text` columns — no
 * `pgEnum` — so adding a value is a code change, not a migration. The
 * `as const` map + `ValueOf` union is the compile-time contract.
 */

/** `pull_request.state` (D5). */
export const PrState = {
  open: "open",
  closed: "closed",
  merged: "merged",
} as const;
export type PrState = ValueOf<typeof PrState>;

/** `disposition.decision` (D7). */
export const DispositionDecision = {
  addressed: "addressed",
  dismissed: "dismissed",
} as const;
export type DispositionDecision = ValueOf<typeof DispositionDecision>;

/** `generation.kind` (D10, extended by D12 with `revision-narrative`). */
export const GenerationKind = {
  brief: "brief",
  delta: "delta",
  revisionNarrative: "revision-narrative",
} as const;
export type GenerationKind = ValueOf<typeof GenerationKind>;

/** `generation.status` (D10). */
export const GenerationStatus = {
  queued: "queued",
  running: "running",
  succeeded: "succeeded",
  failed: "failed",
} as const;
export type GenerationStatus = ValueOf<typeof GenerationStatus>;

/** `generation.phase` (D10; optional determinate-progress detail). */
export const GenerationPhase = {
  fetching: "fetching",
  redacting: "redacting",
  generating: "generating",
  writing: "writing",
} as const;
export type GenerationPhase = ValueOf<typeof GenerationPhase>;

/** `audit_log.actor_type` (D9). */
export const AuditActorType = {
  reviewer: "reviewer",
  app: "app",
  system: "system",
} as const;
export type AuditActorType = ValueOf<typeof AuditActorType>;

/** `audit_log.action` (D9; `view` may join later — code change only). */
export const AuditAction = {
  generate: "generate",
  delete: "delete",
  config: "config",
  auth: "auth",
} as const;
export type AuditAction = ValueOf<typeof AuditAction>;

/**
 * Discriminated union for expected failures (purge target missing, decrypt
 * failure, artifact absent, ...). Reserve `throw` for programmer errors.
 */
export type Result<T, E> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };
