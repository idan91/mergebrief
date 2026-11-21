// ENTRY POINT: the package's public surface (`package.json` `exports["."]`;
// the PGlite test harness lives on the separate `persistence/testing` subpath).
//
// Containment: this file re-exports the shared types, the tenant repository
// factory, and the OPAQUE `AppDatabase` + its lifecycle, but NEVER a drizzle
// table, the raw drizzle handle type (`AppDrizzle`) nor the `internal()`
// unwrap. The only queryable surface a consumer gets is the ctx-bound
// repository.

// --- root: shared types -----------------------------------------------------
export {
  isInstallationId,
  isRepoId,
  isReviewerId,
  isPullRequestRowId,
  isBriefRowId,
  isApiTokenRowId,
  isGrantRowId,
  isReviewSessionId,
  isDeliveryId,
  isDatabaseTimestamp,
  UncoveredWorks,
  GenerationKinds,
  ClaimOutcomes,
  ClaimEnds,
  ChargeOutcomes,
  TriggerOnDemandOutcomes,
  GenerateEveryPushOutcomes,
  AuditActorTypes,
  AuditChannels,
  AuditOutcomes,
  ClaimStates,
  EntryCommentSwapErrorCodes,
} from "./types";
export type {
  InstallationId,
  RepoId,
  ReviewerId,
  PullRequestRowId,
  BriefRowId,
  ApiTokenRowId,
  GrantRowId,
  ReviewSessionId,
  DeliveryId,
  DatabaseTimestamp,
  WebhookSignatureDigest,
  UncoveredWork,
  GenerationKind,
  GenerationFailure,
  ClaimOutcome,
  ClaimEnd,
  ChargeOutcome,
  TriggerOnDemandOutcome,
  GenerateEveryPushOutcome,
  AuditChannel,
  AuditOutcome,
  ClaimState,
  DraftAnchor,
  EntryCommentSwapErrorCode,
} from "./types";

// --- version/: the one semver grammar for a MergeBrief version string ------
export {
  compareSemver,
  formatSemver,
  isDevVersion,
  parseSemver,
  parseServerVersion,
} from "./version";
export type { Semver } from "./version";
export { isHttpUrl } from "./url";

// --- db/: the opaque handle + its lifecycle ---------------------------------

// `AppDatabase` exposes no queryable shape; `AppDrizzle` and `internal()` are
// intentionally absent from this surface.
export { createDb, closeDb, pingDb } from "./db/handle";
export type { AppDatabase, CreateDbOptions } from "./db/handle";

// Programmatic, idempotent app-schema migration for composition roots. The
// graphile_worker schema stays graphile-owned. `ensureAppSchema` is the boot
// boundary: apply, or, under MERGEBRIEF_AUTO_MIGRATE=false, check the ledger
// read-only and refuse when behind. `checkAppSchemaWith` stays in-package.
export {
  migrateApp,
  ensureAppSchema,
  SchemaCheckErrorCodes,
  CHECKOUT_MIGRATE_COMMAND,
  IMAGE_MIGRATE_COMMAND,
  resolveMigrateCommand,
} from "./db/migrate";
export type {
  SchemaCheckError,
  SchemaCheckErrorCode,
  EnsureAppSchemaOptions,
  MigrateCommand,
} from "./db/migrate";

// Persistence env config (Zod-parsed; injectable env, never reads process.env).
// `ResolveDsnOptions` carries the DATABASE_URL_FILE reader + warning sink;
// composition roots pass their logger's `warn`.
export {
  AUDIT_RETENTION_FLOOR_DAYS,
  PR_RETENTION_FLOOR_DAYS,
  ConfigErrorCodes,
  loadConfig,
} from "./db/config";
export type {
  PersistenceConfig,
  ConfigError,
  ConfigErrorCode,
} from "./db/config";
export type { ResolveDsnOptions } from "./db/dsn";

// --- stores/: ctx-bound + projection data access ----------------------------

// The tenant-scoped repository + the context boundary (web + worker validate
// into `TenantContext` with the exported Zod schema / parse functions).
export { createTenantRepository } from "./stores/tenant";
export { ScopeViolationError } from "./stores/scope";
export {
  parseTenantContext,
  safeParseTenantContext,
  parseScopeContext,
  safeParseScopeContext,
  isOwnerContext,
  TenantContextSchema,
  ScopeContextSchema,
} from "./stores/scope-context";
export type {
  TenantContext,
  OwnerContext,
  ScopeContext,
} from "./stores/scope-context";
export type {
  TenantRepository,
  PullRequestRepository,
  CheckpointRepository,
  PullRequestRow,
  CheckpointRow,
  PullRequestUpsertInput,
  PullRequestLifecycle,
  PullRequestStackInput,
  CheckpointSubmitInput,
  EntryCommentSwapError,
  EntryCommentSwapLost,
  EntryCommentSwapNotFound,
} from "./stores/tenant";

export { resolveUrlBoxOwner } from "./stores/url-box";
export { createInboxStore } from "./stores/inbox";
export {
  createUserSettingsStore,
  type UserSettingsStore,
} from "./stores/user-settings";
export { createInboxArchiveStore } from "./stores/inbox-archive";
// The webhook delivery seen-set and its instance-wide sweep: unscoped, read
// before any tenant write.
export {
  createWebhookDeliveryStore,
  DELIVERY_DEDUP_TTL_MS,
  digestWebhookSignature,
  sweepWebhookDeliveries,
} from "./stores/webhook-delivery";
export type {
  WebhookDelivery,
  WebhookDeliveryStore,
} from "./stores/webhook-delivery";
export type { InboxArchiveStore } from "./stores/inbox-archive";
export type {
  InboxBriefRef,
  InboxCounts,
  InboxFilters,
  InboxListInput,
  InboxPage,
  InboxRow,
  InboxStore,
} from "./stores/inbox";
export { createLiveReadStore } from "./stores/live-read";
export type {
  LiveReadBaseline,
  LiveReadDueInput,
  LiveReadFacts,
  LiveReadStamp,
  LiveReadStore,
} from "./stores/live-read";

// The Review Session surface. The factory itself is NOT exported; it is
// reachable only as `createTenantRepository(...).reviewSessions`, so a caller cannot hold
// one without a ctx.
export {
  deriveClaimState,
  PUBLISH_CLAIM_LEASE_MS,
  ReviewSessionErrorCodes,
} from "./stores/review-session";
export type {
  ClaimDraftsInput,
  ClaimStamp,
  DraftClaim,
  ReleaseClaimInput,
  SettleClaimInput,
  ReviewSessionRepository,
  ReviewSessionError,
  ReviewSessionErrorCode,
  ReviewSessionKey,
  ReviewSessionPreview,
  ReviewSessionView,
  CarriedFrom,
  ChunkReadInput,
  DispositionRow,
  DraftOperationResult,
  GroupReclassificationInput,
  NewDraft,
  PublishedDraftsInput,
  ReviewSessionSnapshot,
  ReviewSessionRow,
  ReviewDraftCommentRow,
  ReviewReadMarkRow,
  ReviewGroupReclassificationRow,
  ReviewSubmittedReviewRow,
  SessionOperationResult,
  DispositionInput,
  DispositionAnchor,
} from "./stores/review-session";

// The carry-over verdicts a read returns: evaluated in memory, materialized
// by the first write. The evaluation itself is not exported: it runs inside
// the store, including inside the materialization transaction.
export type {
  CarriedWork,
  CarriedDraftComment,
  CarriedDisposition,
} from "./stores/carry-over";

// The ArtifactStore interface: ctx-bound typed writes/reads for the six
// artifact families. Same containment: built over the opaque handle, no raw
// surface exposed.
export {
  createArtifactStore,
  InvalidArtifactBodyError,
} from "./stores/artifact-store";
export {
  ComparisonMarksBodySchema,
  HunkSpansSchema,
  type ComparisonMarksBody,
  type HunkSpans,
} from "./stores/artifact-store/schemas";
// The GenerationPartStore: a multi-call run's stored detail calls, same
// containment as the ArtifactStore.
export {
  createGenerationPartStore,
  sweepStaleGenerationParts,
} from "./stores/generation-part";
export {
  GenerationPartBodySchema,
  type GenerationPartBody,
} from "./stores/generation-part/schemas";
export {
  GenerationPartKinds,
  type GenerationPartKind,
  type GenerationPartRow,
  type GenerationPartStore,
  type GenerationPartWriteInput,
  type GenerationSpan,
} from "./stores/generation-part/types";
export type {
  ArtifactStore,
  BriefStore,
  DeltaStore,
  RevisionNarrativeStore,
  ComparisonMarksStore,
  HunkSpanStore,
  Origin,
  BriefWriteInput,
  DeltaWriteInput,
  RevisionNarrativeWriteInput,
  ComparisonMarksWriteInput,
  SpanBaseRefs,
  HunkSpanWriteInput,
  BriefRow,
  BriefSpanRow,
  ChunkLayoutRow,
  ChunkLayoutStore,
  ChunkLayoutBackfillInput,
  ComparisonSpanRow,
  DeltaSpanRow,
  NarrativeSpanRow,
  DeltaRow,
  RevisionNarrativeRow,
  ComparisonMarksRow,
  HunkSpanRow,
} from "./stores/artifact-store/types";

// A held head's stored unmet conditions, read back for the api.
export {
  parseUnmetConditions,
  type StoredUnmetConditions,
} from "./stores/unmet-conditions";
// The `generation` status-projection write helpers.
export {
  createGenerationProjection,
  GenerationErrorCodes,
  readSpendBreakdown,
} from "./stores/generation";
export { utcDayBounds, type UtcDay } from "./stores/utc-day";
export type {
  BriefClaims,
  CappedClaim,
  ChargeRunInput,
  ChargeRunOutcome,
  ClaimRunInput,
  ClaimRunOutcome,
  ClaimUnitsInput,
  ClaimUnitsOutcome,
  EntrySyncJobInput,
  ExhaustedClaim,
  GenerateJobTiming,
  PartsPlan,
  RunAttempt,
  GenerationClaim,
  RecoveryJobInput,
  GenerationProjection,
  GenerationError,
  GenerationErrorCode,
  GenerationTarget,
  GenerationRow,
  RunOutcome,
  SpendBreakdown,
  StoredBriefSettle,
  TakeoverJob,
} from "./stores/generation";

// The append-only audit emit. `AuditMetadataSchema` is the value enforcement
// for a ledger an operator may keep forever; `AuditMetadataKeys` names the
// conventional keys without restricting them. `insertAudit` (the tx-capable
// variant) stays in-package, not re-exported.
export {
  writeAudit,
  AuditClientSchema,
  AuditRequestIdSchema,
  AuditMetadataKeys,
  AuditMetadataSchema,
  AuditOperationSchema,
  AuditTargetTypeSchema,
} from "./stores/audit";
export type {
  AuditEntry,
  AuditMetadata,
  AuditMetadataKey,
  AuditLogRow,
} from "./stores/audit";

// The transactional ingest boundary: webhook trigger → PR upsert + pending
// `generation` projection + debounced graphile `generate` job, in ONE
// transaction. Calls `graphile_worker.add_job` by name; no graphile-worker
// npm dependency here.
export { createIngestRoutines } from "./stores/ingest";
// The claims a head takes between triggers, and the Entry sync's attempts.
export {
  ENTRY_SYNC_MAX_ATTEMPTS,
  MAX_GENERATION_ATTEMPTS,
} from "./stores/queue";
export type {
  IngestRoutines,
  IngestOutcome,
  RecordStateOptions,
  QueueEntrySyncInput,
  ReleaseApprovedHoldInput,
  TriggerOnDemandInput,
  GenerateEveryPushInput,
  RequeueGenerateJobInput,
  RouteToLargePoolInput,
  RequeueOutcome,
  RecheckCurrentHeadInput,
  RecheckHeadsAtShaInput,
  RecheckHeadsOutcome,
  TriggerGenerationInput,
} from "./stores/ingest";

// Purge + retention routines: the tenant-scoped deletion boundary, plus the
// instance-wide sweeps (operator settings, so they have no ctx to bind to).
export {
  createPurgeRoutines,
  sweepAuditLog,
  sweepClosedPullRequests,
} from "./stores/purge";
export type {
  PurgeRoutines,
  PurgeActor,
  InstallationPurgeCounts,
} from "./stores/purge";

// --- auth/: the PRE-tenant resolvers (they PRODUCE the tenant) --------------

// The grant boundary: ONE `github_grant` row per GitHub authorization holds
// the encrypted pair; BOTH presentation channels rotate through
// `refreshGrant`'s serialized CAS. Pre-tenant like its referents.
export { createGrantAuth, GrantAuthErrorCodes } from "./auth/grant";
export type {
  GithubGrantRow,
  GrantAuth,
  GrantAuthError,
  GrantAuthErrorCode,
  GrantCreateInput,
  GrantRefreshPatch,
  GrantRefreshRejection,
  OrphanedGrant,
  OrphanedGrantSink,
  RetiredGrant,
} from "./auth/grant";

// The `auth_session` boundary: every credential-row read and write, keyed by
// token hash or by reviewer, plus the instance-wide expiry sweep the worker
// schedules. NOT ctx-bound: a session holds no installation, and the
// request's repository names the tenant.
export { createSessionAuth, sweepExpiredSessions } from "./auth/session";
export type {
  AuthSessionRow,
  SessionAuth,
  SessionCreateInput,
  SessionDeleteResult,
  SessionWithGrant,
  SessionWithGrantCreateInput,
} from "./auth/session";

// The hourly sweep's credential half: dead grants and month-old dead tokens,
// instance-wide, after the session sweep.
export { sweepDeadCredentials } from "./auth/credential-sweep";

// The API-token auth boundary: the second presentation channel's PRE-TENANT,
// hash-keyed resolver. Like `createSessionAuth` it PRODUCES the tenant, so it
// precedes `createTenantRepository` scoping.
export { createTokenAuth } from "./auth/token";
export { TokenMintErrorCodes, type TokenMintErrorCode } from "./auth/types";
export type {
  TokenAuth,
  TokenMintInput,
  TokenWithGrant,
  ApiTokenRow,
  ApiTokenMetadataRow,
  RevokedToken,
  TokenMintError,
} from "./auth/token";

// One GitHub user's whole credential set, for the revoke webhook: unscoped,
// keyed by the user, audited in its own transaction.
export { deleteUserCredentials } from "./auth/credentials";
export type { UserCredentialsDeleted } from "./auth/credentials";

// GitHub OAuth token crypto: AES-256-GCM behind the key-provider interface.
export {
  encryptToken,
  decryptToken,
  createEnvKeyProvider,
  KeyErrorCodes,
  CryptoErrorCodes,
} from "./auth/crypto";
export type {
  KeyProvider,
  KeyError,
  KeyErrorCode,
  CryptoError,
  CryptoErrorCode,
} from "./auth/crypto";
// A sealed token opens only under the grant row and column it was sealed for.
export { GrantSealedColumns } from "./auth/types";
export type { GrantSealBinding, GrantSealedColumn } from "./auth/types";
