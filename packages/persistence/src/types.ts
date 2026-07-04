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

/**
 * Discriminated union for expected failures (purge target missing, decrypt
 * failure, artifact absent, ...). Reserve `throw` for programmer errors.
 */
export type Result<T, E> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };
