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
export { loadConfig, ConfigErrorCode } from "./db/config";
export type {
  PersistenceConfig,
  ConfigError,
  LoadConfigOptions,
} from "./db/config";

// --- stores/ — ctx-bound + projection data access ----------------------------

// The tenant-scoped repository + the context boundary (web + worker validate
// into `TenantContext` with the exported Zod schema / parse functions).
export {
  forTenant,
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
  ReviewerSessionRow,
  PullRequestUpsertInput,
  PullRequestLifecycle,
  PullRequestStatePatch,
  CheckpointSubmitInput,
  SessionCreateInput,
} from "./stores/tenant";

// The ArtifactStore interface — ctx-bound typed writes/reads for the five
// artifact families. Same containment: built over the opaque handle, no raw
// surface exposed.
export {
  artifactStore,
  ArtifactErrorCode,
  ComparisonMarksBodySchema,
} from "./stores/artifact-store";
export type {
  ArtifactStore,
  ArtifactError,
  BriefStore,
  DeltaStore,
  DiffSnapshotStore,
  RevisionNarrativeStore,
  ComparisonMarksStore,
  Origin,
  BriefWriteInput,
  DeltaWriteInput,
  DiffSnapshotWriteInput,
  RevisionNarrativeWriteInput,
  ComparisonMarksWriteInput,
  ComparisonMarksBody,
  BriefRow,
  BriefSpanRow,
  ComparisonSpanRow,
  NarrativeSpanRow,
  DeltaRow,
  DiffSnapshotRow,
  RevisionNarrativeRow,
  ComparisonMarksRow,
} from "./stores/artifact-store";

// The `generation` status-projection write helpers.
export { generationProjection, GenerationErrorCode } from "./stores/generation";
export type {
  GenerationProjection,
  GenerationError,
  GenerationTarget,
  GenerationRow,
} from "./stores/generation";

// The append-only audit emit. `AuditMetadataKey` is the closed metadata-key
// allowlist — the PII enforcement for the un-erasable ledger. `insertAudit`
// (the tx-capable variant) stays in-package — not re-exported.
export {
  audit,
  AuditMetadataKey,
  AuditMetadataSchema,
  AuditTargetTypeSchema,
} from "./stores/audit";
export type { AuditEntry, AuditMetadata, AuditLogRow } from "./stores/audit";

// The transactional ingest boundary: webhook trigger → PR upsert + queued
// `generation` projection + debounced graphile `generate` job, in ONE
// transaction. Calls `graphile_worker.add_job` by name — no graphile-worker
// npm dependency here.
export { ingestRoutines, IngestErrorCode } from "./stores/ingest";
export type {
  IngestRoutines,
  IngestError,
  IngestOutcome,
  TriggerGenerationInput,
} from "./stores/ingest";

// Purge + retention routines — the tenant-scoped deletion boundary.
export { purgeRoutines, PurgeErrorCode } from "./stores/purge";
export type {
  PurgeRoutines,
  PurgeError,
  InstallationPurgeCounts,
} from "./stores/purge";

// The per-user settings boundary — the second non-tenant surface after
// `audit`. Keyed by GitHub user id (a person spans installations), so it is
// NOT ctx-bound and NOT reachable through `forTenant`.
export { userSettingsStore } from "./stores/user-settings";
export type {
  UserSettingsStore,
  UserSettingsRow,
} from "./stores/user-settings";

// --- auth/ — the PRE-tenant resolvers (they PRODUCE the tenant) --------------

// The grant boundary — ONE `github_grant` row per GitHub authorization holds
// the encrypted pair; BOTH presentation channels rotate through
// `refreshGrant`'s serialized CAS. Pre-tenant like its referents.
export { grantAuth, GrantAuthErrorCode } from "./auth/grant";
export type {
  GithubGrantRow,
  GrantAuth,
  GrantAuthError,
  GrantCreateInput,
  GrantRefreshPatch,
  GrantRefreshRejection,
} from "./auth/grant";

// The reviewer-session auth boundary — the PRE-TENANT, token-hash-keyed
// session resolver (find / delete / expiry mirror). NOT ctx-bound: it PRODUCES
// the tenant, so it precedes `forTenant` scoping.
export { sessionAuth, SessionAuthErrorCode } from "./auth/session";
export type {
  SessionAuth,
  SessionAuthError,
  SessionWithGrant,
} from "./auth/session";

// The API-token auth boundary — the second presentation channel's PRE-TENANT,
// hash-keyed resolver. Like `sessionAuth` it PRODUCES the tenant, so it
// precedes `forTenant` scoping.
export { tokenAuth, TokenAuthErrorCode } from "./auth/token";
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
  envKeyProvider,
  KeyErrorCode,
  CryptoErrorCode,
} from "./auth/crypto";
export type { KeyProvider, KeyError, CryptoError } from "./auth/crypto";
