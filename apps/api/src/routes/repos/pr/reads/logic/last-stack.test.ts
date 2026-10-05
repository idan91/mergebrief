import type { Logger } from "logging";
import type { PullRequestRow, TenantRepository } from "persistence";
import { PrStates } from "types/pull-requests";
import { describe, expect, it, vi } from "vitest";
import { recordResolvedStack, shapeRecordedStack } from "./last-stack";

const RECORDED_AT = new Date("2026-09-19T12:00:00.000Z");
const NOW = new Date("2026-09-24T12:00:00.000Z");
const STORED = {
  members: [
    { number: 6, title: "PR 6" },
    { number: 7, title: "PR 7" },
    { number: 8, title: "PR 8" },
  ],
  index: 2,
};
const RESOLVED = { members: STORED.members.slice(1), index: 1 };
const GROWN = {
  members: [...STORED.members.slice(1), { number: 9, title: "PR 9" }],
  index: 1,
};

function stubRow(overrides: Partial<PullRequestRow>): PullRequestRow {
  return {
    id: 1n,
    state: PrStates.MERGED,
    stack: null,
    stackReadAt: null,
    ...overrides,
  } as PullRequestRow;
}

function stubDeps(ok: boolean) {
  const recordStack = vi.fn(async () =>
    ok
      ? { ok: true as const, value: stubRow({}) }
      : {
          ok: false as const,
          error: { code: "not-found" as const, message: "gone" },
        },
  );
  const warn = vi.fn();
  const log: Logger = {
    error: vi.fn(),
    warn,
    info: vi.fn(),
    debug: vi.fn(),
    child: () => log,
  };
  const tenant = {
    pullRequests: { recordStack },
  } as unknown as TenantRepository;
  return { deps: { tenant, log }, recordStack, warn };
}

describe("recordResolvedStack", () => {
  it("dates a landed fold with the read time", async () => {
    const { deps, recordStack } = stubDeps(true);
    const row = stubRow({ stack: STORED, stackReadAt: RECORDED_AT });

    const record = await recordResolvedStack(deps, row, GROWN, NOW);

    expect(recordStack).toHaveBeenCalledTimes(1);
    expect(record).toEqual({
      stack: { members: [STORED.members[0], ...GROWN.members], index: 2 },
      readAt: NOW,
    });
  });

  it("hands back the prior record when the fold fails to land", async () => {
    const { deps, warn } = stubDeps(false);
    const row = stubRow({ stack: STORED, stackReadAt: RECORDED_AT });

    const record = await recordResolvedStack(deps, row, GROWN, NOW);

    expect(record).toEqual({ stack: STORED, readAt: RECORDED_AT });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("hands back the undated resolve when nothing was ever recorded", async () => {
    const { deps } = stubDeps(false);

    const record = await recordResolvedStack(deps, stubRow({}), RESOLVED, NOW);

    expect(record).toEqual({ stack: RESOLVED });
    expect(shapeRecordedStack(record)).toEqual({ stack: RESOLVED });
  });

  it("skips the write when the fold changes nothing", async () => {
    const { deps, recordStack } = stubDeps(true);
    const row = stubRow({ stack: STORED, stackReadAt: RECORDED_AT });

    const record = await recordResolvedStack(deps, row, RESOLVED, NOW);

    expect(recordStack).not.toHaveBeenCalled();
    expect(shapeRecordedStack(record)).toEqual({
      stack: STORED,
      asOf: RECORDED_AT.toISOString(),
    });
  });
});
