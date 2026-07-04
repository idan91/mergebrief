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
