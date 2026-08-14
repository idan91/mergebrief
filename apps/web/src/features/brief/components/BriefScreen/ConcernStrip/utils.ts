import { Concerns, type Concern, type ConcernRollup } from "../../../types";

export interface ConcernShare {
  concern: Concern;
  added: number;
  deleted: number;
  /** Rounded share of the attributed changed-line total, 0–100. */
  percent: number;
}

/**
 * Vocabulary-ordered shares of the attributed total. The wire guarantees
 * neither rollup order nor per-concern uniqueness, so ordering re-derives
 * here and duplicate entries accumulate.
 */
export function concernShares(rollup: ConcernRollup[]): ConcernShare[] {
  const total = rollup.reduce(
    (sum, entry) => sum + entry.added + entry.deleted,
    0,
  );
  const byConcern = new Map<Concern, { added: number; deleted: number }>();
  for (const entry of rollup) {
    const current = byConcern.get(entry.concern) ?? { added: 0, deleted: 0 };
    current.added += entry.added;
    current.deleted += entry.deleted;
    byConcern.set(entry.concern, current);
  }
  return Object.values(Concerns).flatMap((concern) => {
    const entry = byConcern.get(concern);
    if (entry === undefined) return [];
    const touched = entry.added + entry.deleted;
    return [
      {
        concern,
        added: entry.added,
        deleted: entry.deleted,
        percent: total === 0 ? 0 : Math.round((touched / total) * 100),
      },
    ];
  });
}
