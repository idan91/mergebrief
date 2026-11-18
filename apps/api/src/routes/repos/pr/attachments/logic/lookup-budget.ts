// One fixed window per viewer, counted in this process only. A refused spend
// charges nothing, so the window keeps its start and count.
import type { CommittedLookupBudget, CommittedLookupSpend } from "../types";

export function spendCommittedLookups(
  budget: CommittedLookupBudget,
  reviewerId: string,
  cost: number,
  now: number,
): CommittedLookupSpend {
  const { limits, windows } = budget;
  const open = windows.get(reviewerId, now);
  const startedAt = open?.startedAt ?? now;
  const lookups = (open?.lookups ?? 0) + cost;
  if (lookups > limits.maxLookups) {
    return { ok: false, error: undefined };
  }

  const spent = { startedAt, lookups };
  windows.set(reviewerId, spent, startedAt + limits.windowMs, now);
  return { ok: true, value: spent };
}
