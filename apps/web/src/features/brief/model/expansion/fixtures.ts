import { type RowRef, RowRefKinds } from "./types";

/** Row refs in order: a number is that base row, `expanded` is spliced context. */
export function makeRowRefs(
  entries: readonly (number | typeof RowRefKinds.EXPANDED)[],
): RowRef[] {
  return entries.map((entry) =>
    entry === RowRefKinds.EXPANDED
      ? { kind: RowRefKinds.EXPANDED }
      : { kind: RowRefKinds.BASE, baseIndex: entry },
  );
}
