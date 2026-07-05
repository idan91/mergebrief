/**
 * Union of a mapped type's value types. Used instead of `enum` for closed
 * vocabularies: pair with an `as const` object map, e.g.
 *   const Status = { PENDING: "pending", NOT_STARTED: "not-started" } as const;
 *   type Status = ValueOf<typeof Status>;
 *
 * Mirrors `packages/persistence/src/types.ts` — kept local (not imported at
 * runtime from `persistence`) so this package has no runtime dependency on
 * the DB layer.
 */
export type ValueOf<T> = T[keyof T];

/**
 * Discriminated union for expected failures (bad/missing env, ...). Reserve
 * `throw` for programmer errors. Mirrors `persistence`'s `Result` exactly.
 */
export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };
