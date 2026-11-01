import { describe, expect, it } from "vitest";
import { createTtlCache } from "../../../../ttl-cache";
import type { CommittedLookupBudget, CommittedLookupWindow } from "../types";
import { spendCommittedLookups } from "./lookup-budget";

const WINDOW_MS = 60_000;
const START = 1_000_000;
const VIEWER = "42";

function makeBudget(maxEntries = 10): CommittedLookupBudget {
  return {
    limits: { maxLookups: 3, windowMs: WINDOW_MS },
    windows: createTtlCache<CommittedLookupWindow>(maxEntries),
  };
}

describe("spendCommittedLookups", () => {
  it("spends lookups up to the limit, then refuses", () => {
    const budget = makeBudget();

    expect(spendCommittedLookups(budget, VIEWER, 2, START).ok).toBe(true);
    expect(spendCommittedLookups(budget, VIEWER, 1, START + 1)).toEqual({
      ok: true,
      value: { startedAt: START, lookups: 3 },
    });
    expect(spendCommittedLookups(budget, VIEWER, 1, START + 2).ok).toBe(false);
  });

  it("refuses a cost that would pass the limit and spends nothing", () => {
    const budget = makeBudget();
    spendCommittedLookups(budget, VIEWER, 2, START);

    expect(spendCommittedLookups(budget, VIEWER, 2, START).ok).toBe(false);
    expect(spendCommittedLookups(budget, VIEWER, 1, START)).toEqual({
      ok: true,
      value: { startedAt: START, lookups: 3 },
    });
  });

  it("starts a fresh window once the first one has ended", () => {
    const budget = makeBudget();
    spendCommittedLookups(budget, VIEWER, 3, START);

    expect(
      spendCommittedLookups(budget, VIEWER, 1, START + WINDOW_MS - 1).ok,
    ).toBe(false);
    expect(spendCommittedLookups(budget, VIEWER, 1, START + WINDOW_MS)).toEqual(
      { ok: true, value: { startedAt: START + WINDOW_MS, lookups: 1 } },
    );
  });

  it("counts two viewers apart", () => {
    const budget = makeBudget();
    spendCommittedLookups(budget, VIEWER, 3, START);

    expect(spendCommittedLookups(budget, "43", 3, START).ok).toBe(true);
    expect(spendCommittedLookups(budget, VIEWER, 1, START).ok).toBe(false);
  });
});
