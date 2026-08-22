// Shared TYPE-ONLY utilities.
//
// HARD INVARIANT — types only, zero runtime, zero dependencies: nothing here
// may emit JavaScript (no values, no functions, no classes) and `package.json`
// must never grow a dependency. That is what makes it safe for EVERY package
// to depend on without re-introducing runtime coupling.

/**
 * Union of a mapped type's value types. Used instead of `enum` for closed
 * vocabularies: pair with an `as const` object map, e.g.
 *   const Status = { PENDING: "pending", NOT_STARTED: "not-started" } as const;
 *   type Status = ValueOf<typeof Status>;
 */
export type ValueOf<T> = T[keyof T];

/** Strip readonly, for building a readonly-interface value field by field. */
export type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/** Exact key-set equality — both directions, so a renamed key is caught. */
type SameKeys<A, B> = [keyof A] extends [keyof B]
  ? [keyof B] extends [keyof A]
    ? true
    : false
  : false;

/**
 * Compile-time EXACT type equality: mutual assignability AND the same key set,
 * so a renamed optional field is caught. Exists for the hand-rolled wire
 * mirrors in `apps/web` — `true satisfies Equals<Mirror, Source>` makes drift
 * on either side fail to compile, which is the cross-package gate CI's
 * per-package path filtering cannot provide.
 *
 * The key-set half is TOP-LEVEL only: pin each nested interface with its own
 * `Equals` rather than relying on the envelope's pin to see inside it.
 */
export type Equals<A, B> = [A] extends [B]
  ? [B] extends [A]
    ? SameKeys<A, B>
    : false
  : false;

/**
 * Discriminated union for EXPECTED failures (bad env, missing row, upstream
 * refusal, ...). Reserve `throw` for programmer errors. Functions returning
 * `Result` never throw for these paths.
 */
export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

/**
 * Nominal-typing helper: brands a primitive `K` with a unique tag `T` so
 * structurally identical values (e.g. two id `bigint`s) are not
 * interchangeable. Concrete branded families and their runtime guards live
 * with their owning domain; only the mechanism is shared here.
 */
export type Brand<K, T> = K & { readonly __brand: T };

/**
 * `T | Promise<T>` — lets a boundary accept sync and async implementations
 * under one signature while callers simply `await` either.
 */
export type MaybePromise<T> = T | Promise<T>;

/**
 * The instance-level draft-PR generation policy, parsed out of
 * `mergebrief.config.yaml`'s `drafts` block. The runtime default value lives
 * in `generators` — this package is types-only.
 */
export interface DraftPolicy {
  /** Whether briefs generate for draft PRs at all. Default true. */
  readonly generate: boolean;
  /** Trailing-debounce override for draft REgenerations; null = normal window. */
  readonly debounceSeconds: number | null;
}

/**
 * The `generate` job payload — the ONE handshake between the enqueue side
 * (`persistence`) and the drain side (`worker`). Snake_case because it crosses
 * as JSON in a Postgres row, and STRING ids because JSON cannot carry bigint.
 * Change this shape only with BOTH sides in the same commit.
 */
export interface GenerateJobPayload {
  readonly installation_id: string;
  readonly pull_request_id: string;
  readonly head_sha: string;
}
