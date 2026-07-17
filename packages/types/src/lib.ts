// Shared TYPE-ONLY utilities. This package is the single home for the
// utility types every workspace package used to re-declare locally.
//
// HARD INVARIANT — types only, zero runtime, zero dependencies: nothing in
// this package may emit JavaScript (no values, no functions, no classes) and
// `package.json` must never grow a dependency. That guarantee is what makes it
// safe for EVERY package to depend on — including `github`, whose no-DB-
// imports rule exists precisely to avoid runtime coupling to `persistence`.
// A type-only import graph cannot re-introduce that coupling.

/**
 * Union of a mapped type's value types. Used instead of `enum` for closed
 * vocabularies: pair with an `as const` object map, e.g.
 *   const Status = { PENDING: "pending", NOT_STARTED: "not-started" } as const;
 *   type Status = ValueOf<typeof Status>;
 */
export type ValueOf<T> = T[keyof T];

/**
 * Discriminated union for EXPECTED failures (bad env, missing row, upstream
 * refusal, ...). Reserve `throw` for programmer errors. Functions returning
 * `Result` never throw for these paths.
 */
export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

/**
 * Nominal-typing helper: brands a primitive type `K` with a unique tag `T` so
 * structurally identical values (e.g. two id `bigint`s) are not
 * interchangeable at compile time. No runtime representation — `Brand` exists
 * only in the type system. Concrete branded families (e.g. `InstallationId`)
 * and their runtime guards live with their owning domain (`persistence`),
 * NOT here; only the mechanism is shared.
 */
export type Brand<K, T> = K & { readonly __brand: T };

/**
 * `T | Promise<T>` — lets a seam accept sync and async implementations with
 * one signature (e.g. an env-backed key provider today, a KMS-backed one
 * later) while callers simply `await` either.
 */
export type MaybePromise<T> = T | Promise<T>;

/**
 * The instance-level draft-PR generation policy (BRIEF-64, ADR 0020 as
 * amended): parsed out of `mergebrief.config.yaml`'s `drafts` block by
 * `generators`' loaders, injected into the api webhook route, and echoed
 * to the FE on the pr-view response. `debounceSeconds` null = no draft
 * damping (the default — drafts enqueue with the normal window; the
 * runtime default value lives in `generators`' `DEFAULT_DRAFT_POLICY` —
 * this package is types-only).
 */
export interface DraftPolicy {
  /** Whether briefs generate for draft PRs at all. Default true. */
  readonly generate: boolean;
  /** Trailing-debounce override for draft REgenerations; null = normal window. */
  readonly debounceSeconds: number | null;
}

/**
 * The `generate` job payload — the ONE handshake between the enqueue side
 * (`persistence/src/stores/ingest.ts`, which serializes this into
 * `graphile_worker.add_job`) and the drain side (`worker`, which Zod-validates
 * the job payload back into branded ids). Snake_case because it crosses as
 * JSON in a Postgres row, and STRING ids because JSON cannot carry bigint —
 * the worker re-brands via `TenantContextSchema` / the id guards. Change this
 * shape only with BOTH sides (and their contract tests) in the same commit.
 */
export interface GenerateJobPayload {
  readonly installation_id: string;
  readonly pull_request_id: string;
  readonly head_sha: string;
}
