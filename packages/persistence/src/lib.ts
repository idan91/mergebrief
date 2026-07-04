// Package entry point — the whole public surface. Note the D2b containment:
// this file re-exports the schema *metadata* (table objects), the shared
// types, the tenant repository factory, and the OPAQUE `AppDatabase` + its
// `createDb`/`closeDb` lifecycle — but NEVER the raw drizzle handle type
// (`AppDrizzle`) nor the `internal()` unwrap. A consumer can therefore build a
// connection and hand it to `forTenant`, yet cannot run an unscoped query: the
// only queryable surface is the ctx-bound repository.
export * from "./schema/index.js";
export * from "./types.js";

// The tenant-scoped repository + the context boundary (web + worker validate
// into `TenantContext` with the exported Zod schema / parse functions).
export {
  forTenant,
  parseTenantContext,
  safeParseTenantContext,
  TenantContextSchema,
  RepositoryErrorCode,
} from "./tenant.js";
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
  PullRequestStatePatch,
  CheckpointSubmitInput,
  SessionCreateInput,
} from "./tenant.js";

// The opaque handle + its lifecycle. `AppDatabase` exposes no queryable shape;
// `AppDrizzle` and `internal()` are intentionally absent from this surface.
export { createDb, closeDb } from "./db.js";
export type { AppDatabase, AppSchema } from "./db.js";

// The ArtifactStore seam (D6) — ctx-bound typed writes/reads for the five
// artifact families. Same containment: built over the opaque handle, no raw
// surface exposed.
export { artifactStore, ArtifactErrorCode, ComparisonMarksBodySchema } from "./artifact-store.js";
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
  DeltaRow,
  DiffSnapshotRow,
  RevisionNarrativeRow,
  ComparisonMarksRow,
} from "./artifact-store.js";

// The `generation` status-projection write helpers (D10).
export { generationProjection, GenerationErrorCode, sanitizeGenerationError } from "./generation.js";
export type {
  GenerationProjection,
  GenerationError,
  GenerationTarget,
  GenerationRow,
} from "./generation.js";

// The append-only audit emit (D9). `AuditMetadataKey` is the closed
// metadata-key allowlist — the PII enforcement for the un-erasable ledger.
export { audit, AuditMetadataKey, AuditMetadataSchema } from "./audit.js";
export type { AuditEntry, AuditMetadata, AuditLogRow } from "./audit.js";
