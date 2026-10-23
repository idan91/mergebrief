import type {
  Brand,
  CommentAnchorKind,
  DiffSide,
  GenerationFailureCode,
  GenerationFailureCodes,
  ValueOf,
  AccessLevel,
  AccessLevels,
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

/** GitHub's `X-GitHub-Delivery` header: unsigned, so a log field only, never a key. */
export type DeliveryId = Brand<string, "DeliveryId">;
/** Lowercase hex SHA-256 of a verified `X-Hub-Signature-256` header. */
export type WebhookSignatureDigest = Brand<string, "WebhookSignatureDigest">;

/** Each pattern's source must read the same as a POSIX regex: a CHECK reuses it. */
export const DELIVERY_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
export const WEBHOOK_SIGNATURE_DIGEST_PATTERN = /^[0-9a-f]{64}$/;

export function isDeliveryId(value: string): value is DeliveryId {
  return DELIVERY_ID_PATTERN.test(value);
}
export function isWebhookSignatureDigest(
  value: string,
): value is WebhookSignatureDigest {
  return WEBHOOK_SIGNATURE_DIGEST_PATTERN.test(value);
}

/**
 * Work a webhook event names that a stored Brief for its base and head pair
 * does not cover. In memory only: the ingest routine reads it to decide
 * whether a covered event still queues a job.
 */
export const UncoveredWorks = {
  /** A ready flip: the Entry comment may still have to be posted. */
  ENTRY_COMMENT: "entry-comment",
  /** A submitted review: its checkpoint delta still has to be built. */
  REVIEW: "review",
} as const;
export type UncoveredWork = ValueOf<typeof UncoveredWorks>;

/**
 * Where a draft stands with a publish attempt. `in-doubt` is a claim older
 * than the lease: the attempt may or may not have reached GitHub.
 */
export const ClaimStates = {
  UNCLAIMED: "unclaimed",
  PENDING: "pending",
  IN_DOUBT: "in-doubt",
} as const;
export type ClaimState = ValueOf<typeof ClaimStates>;

/** `generation.kind`. */
export const GenerationKinds = {
  BRIEF: "brief",
  DELTA: "delta",
  REVISION_NARRATIVE: "revision-narrative",
} as const;
export type GenerationKind = ValueOf<typeof GenerationKinds>;

/** What a claim on a `generation` row found. */
export const ClaimOutcomes = {
  /** The row is now this run's: a fresh run id, a lease, one paid attempt. */
  CLAIMED: "claimed",
  /** Another run's lease is live; nothing was written. */
  HELD: "held",
  /** The day's attempts reached the cap; nothing was written. */
  CAPPED: "capped",
  /** The row already succeeded; there is nothing to claim. */
  FINISHED: "finished",
  /** The head's paid attempts since its last trigger are spent; nothing was written. */
  EXHAUSTED: "exhausted",
} as const;
export type ClaimOutcome = ValueOf<typeof ClaimOutcomes>;

/** graphile's `job_key_mode` for an `add_job` on a key that already has a job. */
export const JobKeyModes = {
  /** Replace the waiting job's payload and `run_at`. */
  REPLACE: "replace",
  /** Replace the payload and keep the waiting job's `run_at`. */
  PRESERVE_RUN_AT: "preserve_run_at",
} as const;
export type JobKeyMode = ValueOf<typeof JobKeyModes>;

/** What charging a paid run that holds no claim to the day's cap found. */
export const ChargeOutcomes = {
  /** One attempt row was written under the cap. */
  CHARGED: "charged",
  /** The day's attempts reached the cap; nothing was written. */
  CAPPED: "capped",
} as const;
export type ChargeOutcome = ValueOf<typeof ChargeOutcomes>;

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
  AccessLevel,
  typeof AccessLevels.READ
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

interface DraftAnchorBase {
  readonly kind: CommentAnchorKind;
  readonly file: string;
}

export interface LineDraftAnchor extends DraftAnchorBase {
  readonly kind: Extract<CommentAnchorKind, "line">;
  readonly side: DiffSide;
  readonly startLine: number;
  readonly endLine: number;
  readonly startSide?: DiffSide;
}

export interface FileDraftAnchor extends DraftAnchorBase {
  readonly kind: Extract<CommentAnchorKind, "file">;
}

export type DraftAnchor = LineDraftAnchor | FileDraftAnchor;
