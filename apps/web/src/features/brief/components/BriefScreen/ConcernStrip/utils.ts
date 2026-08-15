import { Concerns, type Concern, type ConcernRollup } from "../../../types";

export interface ConcernShare {
  concern: Concern;
  added: number;
  deleted: number;
  /** Apportioned share of the attributed changed-line total, 0–100. */
  percent: number;
}

/**
 * Vocabulary-ordered shares of the attributed total. The wire guarantees
 * neither rollup order nor per-concern uniqueness, so ordering re-derives
 * here and duplicate entries accumulate. Percents apportion by largest
 * remainder, so they always sum to exactly 100 (independent rounding can
 * drift to 99 or 101).
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
  const shares = Object.values(Concerns).flatMap((concern) => {
    const entry = byConcern.get(concern);
    if (entry === undefined) return [];
    const exact =
      total === 0 ? 0 : ((entry.added + entry.deleted) / total) * 100;
    return [
      {
        concern,
        added: entry.added,
        deleted: entry.deleted,
        percent: Math.floor(exact),
        remainder: exact - Math.floor(exact),
      },
    ];
  });
  if (total > 0) {
    let leftover = 100 - shares.reduce((sum, share) => sum + share.percent, 0);
    const byRemainder = shares
      .map((share, index) => ({ remainder: share.remainder, index }))
      .toSorted((a, b) => b.remainder - a.remainder);
    for (const { index } of byRemainder) {
      if (leftover === 0) break;
      const share = shares[index];
      if (share === undefined) continue;
      share.percent += 1;
      leftover -= 1;
    }
  }
  return shares.map(({ remainder: _remainder, ...share }) => share);
}
