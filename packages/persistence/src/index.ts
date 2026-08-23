// ENTRY POINT — the package's public surface (`package.json` `exports["."]`;
// the PGlite test harness lives on the separate `persistence/testing` subpath).
//
// Containment: this file re-exports the schema metadata, the shared types, the
// tenant repository factory, and the OPAQUE `AppDatabase` + its lifecycle —
// but NEVER the raw drizzle handle type (`AppDrizzle`) nor the `internal()`
// unwrap. The only queryable surface a consumer gets is the ctx-bound
// repository.

// --- root + schema/ — shared types + table metadata --------------------------
export * from "./schema/index";
export * from "./types";

// --- db/ — the opaque handle + its lifecycle ---------------------------------

// `AppDatabase` exposes no queryable shape; `AppDrizzle` and `internal()` are
// intentionally absent from this surface.
export { createDb, closeDb, pingDb } from "./db/handle";
export type { AppDatabase, AppSchema, CreateDbOptions } from "./db/handle";

// Programmatic, idempotent app-schema migration for composition roots. The
// graphile_worker schema stays graphile-owned. `ensureAppSchema` is the boot
// boundary: apply, or — under MERGEBRIEF_AUTO_MIGRATE=false — check the ledger
// read-only and refuse when behind. `checkAppSchemaWith` stays in-package.
export {
  migrateApp,
  ensureAppSchema,
  SchemaCheckErrorCode,
} from "./db/migrate";
export type { SchemaCheckError, EnsureAppSchemaOptions } from "./db/migrate";

// Persistence env config (Zod-parsed; injectable env — never reads process.env).
// `LoadConfigOptions` carries the DATABASE_URL_FILE reader + warning sink —
// composition roots pass their logger's `warn`.
export {
  AUDIT_RETENTION_FLOOR_DAYS,
  ConfigErrorCode,
  loadConfig,
} from "./db/config";
export type {
  PersistenceConfig,
  ConfigError,
  LoadConfigOptions,
} from "./db/config";

// --- stores/ — ctx-bound + projection data access ----------------------------

// The tenant-scoped repository + the context boundary (web + worker validate
// into `TenantContext` with the exported Zod schema / parse functions).
export {
  createTenantRepository,
  parseTenantContext,
  safeParseTenantContext,
  TenantContextSchema,
  RepositoryErrorCode,
} from "./stores/tenant";
export type {
  TenantContext,
  TenantRepository,
  PullRequestRepository,
  CheckpointRepository,
  SessionRepository,
  RepositoryError,
  PullRequestRow,
  CheckpointRow,
  AuthSessionRow,
  PullRequestUpsertInput,
  PullRequestLifecycle,
  PullRequestStatePatch,
  CheckpointSubmitInput,
  SessionCreateInput,
} from "./stores/tenant";

// The Review Session surface. The factory itself is NOT exported — it is
// reachable only as `createTenantRepository(...).reviewSessions`, so a caller cannot hold
// one without a ctx.
export { ReviewSessionErrorCode } from "./stores/review-session";
export type {
  ReviewSessionRepository,
  ReviewSessionError,
  ReviewSessionKey,
  SessionWriter,
  CarryOverQuery,
  CarryOverInputs,
  ReviewSessionView,
  CarriedFrom,
  DispositionRow,
  DraftCommentPatch,
  ReviewSessionSnapshot,
  ReviewSessionRow,
  ReviewDraftCommentRow,
  ReviewReadMarkRow,
  ReviewGroupReclassificationRow,
  ReviewSubmittedReviewRow,
  DraftCommentInput,
  ReadMarkInput,
  ReclassificationInput,
  SubmittedReviewInput,
  DispositionInput,
  DispositionAnchor,
} from "./stores/review-session";

// The carry-over verdicts a read returns — evaluated in memory, materialized
// by the first write. The evaluation itself is not exported: it runs inside
// the store, including inside the materialization transaction.
export type {
  CarriedWork,
  CarriedDraftComment,
  CarriedDisposition,
  FlagKey,
} from "./stores/carry-over";

// The ArtifactStore interface — ctx-bound typed writes/reads for the six
// artifact families. Same containment: built over the opaque handle, no raw
// surface exposed.
export {
  createArtifactStore,
  ArtifactErrorCode,
  ComparisonMarksBodySchema,
  HunkSpansSchema,
  StoredIdsSchema,
} from "./stores/artifact-store";
export type {
  ArtifactStore,
  ArtifactError,
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
  GenerationErrorCode,
} from "./stores/generation";
export type {
  GenerationProjection,
  GenerationError,
  GenerationTarget,
  GenerationRow,
} from "./stores/generation";

// The append-only audit emit. `AuditMetadataSchema` is the value enforcement
// for a ledger an operator may keep forever; `AuditMetadataKey` names the
// conventional keys without restricting them. `insertAudit` (the tx-capable
// variant) stays in-package — not re-exported.
export {
  writeAudit,
  AuditClientSchema,
  AuditRequestIdSchema,
  AuditMetadataKey,
  AuditMetadataSchema,
  AuditOperationSchema,
  AuditTargetTypeSchema,
} from "./stores/audit";
export type { AuditEntry, AuditMetadata, AuditLogRow } from "./stores/audit";

// The transactional ingest boundary: webhook trigger → PR upsert + queued
// `generation` projection + debounced graphile `generate` job, in ONE
// transaction. Calls `graphile_worker.add_job` by name — no graphile-worker
// npm dependency here.
export { createIngestRoutines, IngestErrorCode } from "./stores/ingest";
export type {
  IngestRoutines,
  IngestError,
  IngestOutcome,
  TriggerGenerationInput,
} from "./stores/ingest";

// Purge + retention routines — the tenant-scoped deletion boundary, plus the
// instance-wide audit sweep (an operator setting, so it has no ctx to bind to).
export {
  createPurgeRoutines,
  PurgeErrorCode,
  sweepAuditLog,
} from "./stores/purge";
export type {
  PurgeRoutines,
  PurgeError,
  InstallationPurgeCounts,
} from "./stores/purge";

// The per-user settings boundary — the second non-tenant surface after
// `writeAudit`. Keyed by GitHub user id (a person spans installations), so it is
// NOT ctx-bound and NOT reachable through `createTenantRepository`.
export { createUserSettingsStore } from "./stores/user-settings";
export type {
  UserSettingsStore,
  UserSettingsRow,
} from "./stores/user-settings";

// --- auth/ — the PRE-tenant resolvers (they PRODUCE the tenant) --------------

// The grant boundary — ONE `github_grant` row per GitHub authorization holds
// the encrypted pair; BOTH presentation channels rotate through
// `refreshGrant`'s serialized CAS. Pre-tenant like its referents.
export { createGrantAuth, GrantAuthErrorCode } from "./auth/grant";
export type {
  GithubGrantRow,
  GrantAuth,
  GrantAuthError,
  GrantCreateInput,
  GrantRefreshPatch,
  GrantRefreshRejection,
} from "./auth/grant";

// The `auth_session` boundary — the PRE-TENANT, token-hash-keyed
// session resolver (find / delete / expiry mirror). NOT ctx-bound: it PRODUCES
// the tenant, so it precedes `createTenantRepository` scoping.
export { createSessionAuth, SessionAuthErrorCode } from "./auth/session";
export type {
  SessionAuth,
  SessionAuthError,
  SessionWithGrant,
} from "./auth/session";

// The API-token auth boundary — the second presentation channel's PRE-TENANT,
// hash-keyed resolver. Like `createSessionAuth` it PRODUCES the tenant, so it
// precedes `createTenantRepository` scoping.
export { createTokenAuth, TokenAuthErrorCode } from "./auth/token";
export type {
  TokenAuth,
  TokenAuthError,
  TokenMintInput,
  TokenWithGrant,
  ApiTokenRow,
  ApiTokenMetadataRow,
} from "./auth/token";

// GitHub OAuth token crypto — AES-256-GCM behind the key-provider interface.
export {
  encryptToken,
  decryptToken,
  createEnvKeyProvider,
  KeyErrorCode,
  CryptoErrorCode,
} from "./auth/crypto";
export type { KeyProvider, KeyError, CryptoError } from "./auth/crypto";
