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
