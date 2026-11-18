/**
 * Union of a mapped type's value types. Pair with an `as const` object map:
 *   const Status = { PENDING: "pending" } as const;
 *   type Status = ValueOf<typeof Status>;
 */
export type ValueOf<T> = T[keyof T];

export type Mutable<T> = { -readonly [K in keyof T]: T[K] };

type SameKeys<A, B> = [keyof A] extends [keyof B]
  ? [keyof B] extends [keyof A]
    ? true
    : false
  : false;

/**
 * Exact type equality for hand-rolled wire mirrors in `apps/web`.
 * `true satisfies Equals<Mirror, Source>` is the cross-package gate CI's
 * per-package path filtering cannot provide. Pin nested interfaces too; the
 * key-set half is top-level only.
 */
export type Equals<A, B> = [A] extends [B]
  ? [B] extends [A]
    ? SameKeys<A, B>
    : false
  : false;

export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export type Brand<K, T> = K & { readonly __brand: T };

export type MaybePromise<T> = T | Promise<T>;
