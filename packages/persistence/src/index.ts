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
  UncoveredWorks,
  GenerationKinds,
  ClaimOutcomes,
  ChargeOutcomes,
  AuditActorTypes,
  AuditChannels,
  AuditOutcomes,
  ClaimStates,
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
  UncoveredWork,
  GenerationKind,
  GenerationFailure,
  ClaimOutcome,
  ChargeOutcome,
  AuditChannel,
  AuditOutcome,
  ClaimState,
  DraftAnchor,
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
export { createTenantRepository, RepositoryErrorCodes } from "./stores/tenant";
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
  SessionRepository,
  RepositoryError,
  RepositoryErrorCode,
  PullRequestRow,
  CheckpointRow,
  AuthSessionRow,
  PullRequestUpsertInput,
  PullRequestLifecycle,
  PullRequestStatePatch,
  PullRequestStackInput,
  CheckpointSubmitInput,
  SessionCreateInput,
} from "./stores/tenant";

// The one unscoped read: which owner holds the url-box row at these PR
// coordinates (instance visibility). Returns an owner to bind a ctx to,
// never a row.
export { resolveUrlBoxOwner } from "./stores/url-box";
export { createInboxStore } from "./stores/inbox";
export {
  createUserSettingsStore,
  type UserSettingsStore,
} from "./stores/user-settings";
export {
  createInboxArchiveStore,
  InboxArchiveErrorCodes,
} from "./stores/inbox-archive";
export type {
  InboxArchiveError,
  InboxArchiveErrorCode,
  InboxArchiveStore,
} from "./stores/inbox-archive";
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
  ArtifactErrorCodes,
  ComparisonMarksBodySchema,
  HunkSpansSchema,
} from "./stores/artifact-store";
export type {
  ArtifactStore,
  ArtifactError,
  ArtifactErrorCode,
  BriefStore,
  DeltaStore,
  DiffSnapshotStore,
  RevisionNarrativeStore,
  ComparisonMarksStore,
  HunkSpanStore,
  Origin,
  BriefWriteInput,
  DeltaWriteInput,
  DiffSnapshotWriteInput,
  RevisionNarrativeWriteInput,
  ComparisonMarksWriteInput,
  ComparisonMarksBody,
  HunkSpanWriteInput,
  HunkSpans,
  BriefRow,
  BriefSpanRow,
  ComparisonSpanRow,
  NarrativeSpanRow,
  DeltaRow,
  DiffSnapshotRow,
  RevisionNarrativeRow,
  ComparisonMarksRow,
  HunkSpanRow,
} from "./stores/artifact-store";

// The `generation` status-projection write helpers.
export {
  createGenerationProjection,
  GenerationErrorCodes,
} from "./stores/generation";
export type {
  ChargeRunInput,
  ChargeRunOutcome,
  ClaimRunInput,
  ClaimRunOutcome,
  GenerateJobTiming,
  GenerationClaim,
  RecoveryJobInput,
  GenerationProjection,
  GenerationError,
  GenerationErrorCode,
  GenerationTarget,
  GenerationRow,
  RunOutcome,
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
export { createIngestRoutines, IngestErrorCodes } from "./stores/ingest";
// The recovery job's task name, which the worker registers, and the claims a head takes between triggers.
export {
  MAX_GENERATION_ATTEMPTS,
  RECOVER_GENERATION_TASK,
} from "./stores/queue";
export type {
  IngestRoutines,
  IngestError,
  IngestErrorCode,
  IngestOutcome,
  RecordStateOptions,
  RequeueGenerateJobInput,
  RequeueOutcome,
  TriggerGenerationInput,
} from "./stores/ingest";

// Purge + retention routines: the tenant-scoped deletion boundary, plus the
// instance-wide audit sweep (an operator setting, so it has no ctx to bind to).
export {
  createPurgeRoutines,
  PurgeErrorCodes,
  sweepAuditLog,
} from "./stores/purge";
export type {
  PurgeRoutines,
  PurgeActor,
  PurgeError,
  PurgeErrorCode,
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
} from "./auth/grant";

// The `auth_session` boundary: the PRE-TENANT, token-hash-keyed
// session resolver (find / delete / expiry mirror). NOT ctx-bound: it names
// the reviewer, and the request's repository names the tenant.
export { createSessionAuth } from "./auth/session";
export type { SessionAuth, SessionWithGrant } from "./auth/session";

// The API-token auth boundary: the second presentation channel's PRE-TENANT,
// hash-keyed resolver. Like `createSessionAuth` it PRODUCES the tenant, so it
// precedes `createTenantRepository` scoping.
export { createTokenAuth, TokenAuthErrorCodes } from "./auth/token";
export type {
  TokenAuth,
  TokenAuthError,
  TokenAuthErrorCode,
  TokenMintInput,
  TokenWithGrant,
  ApiTokenRow,
  ApiTokenMetadataRow,
} from "./auth/token";

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
