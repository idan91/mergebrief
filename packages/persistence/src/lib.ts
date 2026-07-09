// Package entry point — the whole public surface. Note the D2b containment:
// this file re-exports the schema *metadata* (table objects), the shared
// types, the tenant repository factory, and the OPAQUE `AppDatabase` + its
// `createDb`/`closeDb` lifecycle — but NEVER the raw drizzle handle type
// (`AppDrizzle`) nor the `internal()` unwrap. A consumer can therefore build a
// connection and hand it to `forTenant`, yet cannot run an unscoped query: the
// only queryable surface is the ctx-bound repository.
export * from "./schema/index";
export * from "./types";

// The tenant-scoped repository + the context boundary (web + worker validate
// into `TenantContext` with the exported Zod schema / parse functions).
export {
  forTenant,
  parseTenantContext,
  safeParseTenantContext,
  TenantContextSchema,
  RepositoryErrorCode,
} from "./tenant";
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
} from "./tenant";

// The opaque handle + its lifecycle. `AppDatabase` exposes no queryable shape;
// `AppDrizzle` and `internal()` are intentionally absent from this surface.
export { createDb, closeDb } from "./db";
export type { AppDatabase, AppSchema } from "./db";

// The ArtifactStore seam (D6) — ctx-bound typed writes/reads for the five
// artifact families. Same containment: built over the opaque handle, no raw
// surface exposed.
export { artifactStore, ArtifactErrorCode, ComparisonMarksBodySchema } from "./artifact-store";
export type {
  ArtifactStore,
  ArtifactError,
  BriefStore,
  DeltaStore,
  DiffSnapshotStore,
  RevisionNarrativeStore,
  ComparisonMarksStore,
  Provenance,
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
} from "./artifact-store";

// The `generation` status-projection write helpers (D10).
export { generationProjection, GenerationErrorCode, sanitizeGenerationError } from "./generation";
export type {
  GenerationProjection,
  GenerationError,
  GenerationTarget,
  GenerationRow,
} from "./generation";

// The append-only audit emit (D9). `AuditMetadataKey` is the closed
// metadata-key allowlist — the PII enforcement for the un-erasable ledger.
// `insertAudit` (the tx-capable variant) stays in-package — not re-exported.
export { audit, AuditMetadataKey, AuditMetadataSchema, AuditTargetTypeSchema } from "./audit";
export type { AuditEntry, AuditMetadata, AuditLogRow } from "./audit";

// The transactional ingest seam (BRIEF-2 stage 4): webhook trigger → PR
// upsert + queued `generation` projection + debounced graphile `generate`
// job, in ONE transaction. Calls `graphile_worker.add_job` by name — no
// graphile-worker npm dependency here.
export { ingestRoutines, IngestErrorCode } from "./ingest";
export type {
  IngestRoutines,
  IngestError,
  IngestOutcome,
  TriggerGenerationInput,
} from "./ingest";

// Purge + retention routines (D5/D9/D11) — the tenant-scoped deletion seam.
export { purgeRoutines, PurgeErrorCode } from "./purge";
export type { PurgeRoutines, PurgeError, InstallationPurgeCounts } from "./purge";

// GitHub OAuth token crypto (D11) — AES-256-GCM behind the key-provider seam.
export { encryptToken, decryptToken, envKeyProvider, KeyErrorCode, CryptoErrorCode } from "./crypto";
export type { KeyProvider, KeyError, CryptoError } from "./crypto";

// The reviewer-session auth seam (BRIEF-2 stage 6, D11) — the PRE-TENANT,
// token-hash-keyed session resolver (find / delete / serialized refresh). NOT
// ctx-bound: it PRODUCES the tenant, so it precedes `forTenant` scoping.
export { sessionAuth, SessionAuthErrorCode } from "./session";
export type {
  SessionAuth,
  SessionAuthError,
  SessionRefreshPatch,
  SessionRefreshRejection,
} from "./session";

// The API-token auth seam (BRIEF-17, ADR 0016 #4 as amended) — the SECOND
// presentation channel's PRE-TENANT, hash-keyed resolver. Like `sessionAuth`
// it PRODUCES the tenant, so it precedes `forTenant` scoping.
export { tokenAuth, TokenAuthErrorCode } from "./token";
export type {
  TokenAuth,
  TokenAuthError,
  TokenMintInput,
  TokenRefreshPatch,
  TokenRefreshRejection,
  ApiTokenRow,
  ApiTokenMetadataRow,
} from "./token";

// The per-user settings seam (BRIEF-19, D14) — the SECOND non-tenant surface
// after `audit`. Keyed by GitHub user id (a person spans installations), so it
// is NOT ctx-bound and NOT reachable through `forTenant`.
export { userSettingsStore } from "./user-settings";
export type { UserSettingsStore, UserSettingsRow } from "./user-settings";

// Programmatic, idempotent app-schema migration for composition roots
// (worker/compose boot). The graphile_worker schema stays graphile-owned.
export { migrateApp } from "./migrate";

// Persistence env config (Zod-parsed; injectable env — never reads process.env).
export { loadConfig, ConfigErrorCode } from "./config";
export type { PersistenceConfig, ConfigError } from "./config";
