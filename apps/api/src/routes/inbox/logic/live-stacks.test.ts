import type { OpenPullRequest } from "brief-core/pr-stack";
import type { RepositoryRef } from "github";
import type { Logger } from "logging";
import {
  isPullRequestRowId,
  isRepoId,
  type InboxRow,
  type RepoId,
} from "persistence";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTtlCache } from "../../ttl-cache";
import { INBOX_OPEN_PULLS_CACHE_TTL_MS } from "../consts";
import {
  readLiveStacks,
  type LiveStacksDeps,
  type LiveStacksInput,
} from "./live-stacks";

const log: Logger = {
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  child: () => log,
};

function brand<T extends bigint>(
  value: bigint,
  guard: (v: bigint) => v is T,
): T {
  if (!guard(value)) {
    throw new Error("unbrandable fixture value");
  }
  return value;
}

function makeRow(
  id: bigint,
  repoId: bigint,
  prNumber: number,
  overrides: {
    installationId?: bigint | null;
    githubUnreachableAt?: Date | null;
  } = {},
): InboxRow {
  const pullRequest = {
    id: brand(id, isPullRequestRowId),
    repoId: brand(repoId, isRepoId),
    repoSlug: `o/r${repoId}`,
    prNumber,
    installationId:
      overrides.installationId === undefined ? 10n : overrides.installationId,
    githubUnreachableAt: overrides.githubUnreachableAt ?? null,
  };
  return { pullRequest } as unknown as InboxRow;
}

function makeOpen(number: number, head: string, base: string): OpenPullRequest {
  const repo = { owner: "o", repo: "r" };
  return {
    number,
    title: `PR ${number}`,
    headRef: head,
    baseRef: base,
    headRepo: repo,
    baseRepo: repo,
  };
}

/** What one list read answers with, in the order the reads are made. */
type ReadAnswer =
  | { readonly open: readonly OpenPullRequest[]; readonly delayMs?: number }
  | { readonly refuse: "not-found" | "unavailable" }
  | { readonly tokenDead: true }
  | { readonly throws: true };

/** A list reader answering from `answers` in call order, the last one repeating. */
function stubListOpenPulls(...answers: readonly ReadAnswer[]) {
  let calls = 0;
  return vi.fn(async (target: RepositoryRef) => {
    const answer = answers[Math.min(calls, answers.length - 1)];
    calls += 1;
    if (answer === undefined || "throws" in answer) {
      throw new Error(`boom ${target.owner}/${target.repo}`);
    }
    if ("tokenDead" in answer) {
      return {
        ok: false as const,
        error: { kind: "token-unreadable" as const },
      };
    }
    if ("refuse" in answer) {
      return {
        ok: false as const,
        error: { code: answer.refuse, message: "no" },
      };
    }
    await new Promise((resolve) => setTimeout(resolve, answer.delayMs ?? 0));
    return { ok: true as const, value: answer.open };
  });
}

type ListStub = ReturnType<typeof stubListOpenPulls>;

function makeDeps(listOpenPulls: ListStub): LiveStacksDeps {
  return {
    listOpenPulls: listOpenPulls as unknown as LiveStacksDeps["listOpenPulls"],
    openPullsCache: createTtlCache(10),
    log,
  };
}

function makeInput(
  rows: readonly InboxRow[],
  overrides: Partial<LiveStacksInput> = {},
): LiveStacksInput {
  const repoNames = new Map<RepoId, { fullName: string }>(
    rows.map((row) => [
      row.pullRequest.repoId,
      { fullName: `o/r${row.pullRequest.repoId}` },
    ]),
  );
  return { sessionTokenHash: "hash", rows, repoNames, ...overrides };
}

function waitFor(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

describe("readLiveStacks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("places every listed row from one list per repository", async () => {
    const open = [makeOpen(7, "one", "main"), makeOpen(8, "two", "one")];
    const listOpenPulls = stubListOpenPulls({ open });
    const rows = [
      makeRow(1n, 100n, 7),
      makeRow(2n, 100n, 8),
      makeRow(3n, 100n, 3),
    ];

    const stacks = await readLiveStacks(
      makeDeps(listOpenPulls),
      makeInput(rows),
    );

    expect(listOpenPulls).toHaveBeenCalledTimes(1);
    expect(stacks.get(rows[0]!.pullRequest.id)).toEqual({ index: 1, size: 2 });
    expect(stacks.get(rows[1]!.pullRequest.id)).toEqual({ index: 2, size: 2 });
    expect(stacks.has(rows[2]!.pullRequest.id)).toBe(false);
  });

  it("serves what answered by the budget, the rest keep their snapshots", async () => {
    const listOpenPulls = stubListOpenPulls({
      open: [makeOpen(7, "one", "main")],
      delayMs: 200,
    });
    const rows = [makeRow(1n, 100n, 7)];

    const started = Date.now();
    const stacks = await readLiveStacks(
      makeDeps(listOpenPulls),
      makeInput(rows, { budgetMs: 30 }),
    );

    expect(Date.now() - started).toBeLessThan(150);
    expect(stacks.size).toBe(0);
  });

  it("a list late for one load still places the next from the cache", async () => {
    const listOpenPulls = stubListOpenPulls({
      open: [makeOpen(7, "one", "main"), makeOpen(8, "two", "one")],
      delayMs: 60,
    });
    const deps = makeDeps(listOpenPulls);
    const rows = [makeRow(1n, 100n, 8)];

    const first = await readLiveStacks(deps, makeInput(rows, { budgetMs: 10 }));
    await waitFor(120);
    const second = await readLiveStacks(deps, makeInput(rows));

    expect(first.size).toBe(0);
    expect(second.get(rows[0]!.pullRequest.id)).toEqual({ index: 2, size: 2 });
    expect(listOpenPulls).toHaveBeenCalledTimes(1);
  });

  it("a list slower than the cache window is cached from when it landed", async () => {
    const listOpenPulls = stubListOpenPulls({
      open: [makeOpen(7, "one", "main")],
    });
    const deps = makeDeps(listOpenPulls);
    const rows = [makeRow(1n, 100n, 7)];
    const asked = Date.now();
    const landed = asked + INBOX_OPEN_PULLS_CACHE_TTL_MS + 1_000;
    const clock = vi.spyOn(Date, "now");
    clock.mockReturnValueOnce(asked).mockReturnValue(landed);

    await readLiveStacks(deps, makeInput(rows));
    clock.mockReturnValue(landed + 1_000);
    await readLiveStacks(deps, makeInput(rows));
    clock.mockRestore();

    expect(listOpenPulls).toHaveBeenCalledTimes(1);
  });

  it("reads a repository's list once inside the cache window", async () => {
    const listOpenPulls = stubListOpenPulls({
      open: [makeOpen(7, "one", "main")],
    });
    const deps = makeDeps(listOpenPulls);
    const rows = [makeRow(1n, 100n, 7)];

    await readLiveStacks(deps, makeInput(rows));
    await readLiveStacks(deps, makeInput(rows));

    expect(listOpenPulls).toHaveBeenCalledTimes(1);
  });

  it("one refused list leaves the other repositories placed", async () => {
    const listOpenPulls = stubListOpenPulls(
      { refuse: "not-found" },
      { open: [makeOpen(7, "one", "main"), makeOpen(8, "two", "one")] },
    );
    const rows = [makeRow(1n, 100n, 8), makeRow(2n, 200n, 8)];

    const stacks = await readLiveStacks(
      makeDeps(listOpenPulls),
      makeInput(rows),
    );

    expect(stacks.has(rows[0]!.pullRequest.id)).toBe(false);
    expect(stacks.get(rows[1]!.pullRequest.id)).toEqual({ index: 2, size: 2 });
  });

  it("a denial holds for the cache window and logs below warn", async () => {
    const listOpenPulls = stubListOpenPulls({ refuse: "not-found" });
    const deps = makeDeps(listOpenPulls);
    const rows = [makeRow(1n, 100n, 8)];

    await readLiveStacks(deps, makeInput(rows));
    await readLiveStacks(deps, makeInput(rows));

    expect(listOpenPulls).toHaveBeenCalledTimes(1);
    expect(log.warn).not.toHaveBeenCalled();
    expect(log.debug).toHaveBeenCalledWith(
      "open list denied to the viewer, no live stacks for the repo",
      { repoId: "100", code: "not-found" },
    );
  });

  it("an outage is read again next time and warns", async () => {
    const listOpenPulls = stubListOpenPulls({ refuse: "unavailable" });
    const deps = makeDeps(listOpenPulls);
    const rows = [makeRow(1n, 100n, 8)];

    await readLiveStacks(deps, makeInput(rows));
    await readLiveStacks(deps, makeInput(rows));

    expect(listOpenPulls).toHaveBeenCalledTimes(2);
    expect(log.warn).toHaveBeenCalledWith(
      "open list failed, no live stacks for the repo",
      { repoId: "100", code: "unavailable" },
    );
  });

  it("a read that throws keeps that repository's snapshots and the page", async () => {
    const listOpenPulls = stubListOpenPulls(
      { throws: true },
      { open: [makeOpen(7, "one", "main"), makeOpen(8, "two", "one")] },
    );
    const rows = [makeRow(1n, 100n, 8), makeRow(2n, 200n, 8)];

    const stacks = await readLiveStacks(
      makeDeps(listOpenPulls),
      makeInput(rows),
    );

    expect(stacks.has(rows[0]!.pullRequest.id)).toBe(false);
    expect(stacks.get(rows[1]!.pullRequest.id)).toEqual({ index: 2, size: 2 });
  });

  it("a url row outside every installation is read under its own label", async () => {
    const listOpenPulls = stubListOpenPulls({
      open: [makeOpen(7, "one", "main"), makeOpen(8, "two", "one")],
    });
    const rows = [
      makeRow(1n, 100n, 8, { installationId: null }),
      makeRow(2n, 200n, 8),
    ];

    const stacks = await readLiveStacks(
      makeDeps(listOpenPulls),
      makeInput(rows, { repoNames: new Map() }),
    );

    expect(listOpenPulls).toHaveBeenCalledTimes(1);
    expect(listOpenPulls).toHaveBeenCalledWith({ owner: "o", repo: "r100" });
    expect(stacks.get(rows[0]!.pullRequest.id)).toEqual({ index: 2, size: 2 });
    expect(stacks.has(rows[1]!.pullRequest.id)).toBe(false);
  });

  it("the installation walk's name wins over a url row's label", async () => {
    const listOpenPulls = stubListOpenPulls({
      open: [makeOpen(7, "one", "main"), makeOpen(8, "two", "one")],
    });
    const rows = [makeRow(1n, 100n, 8, { installationId: null })];
    const repoNames = new Map<RepoId, { fullName: string }>([
      [rows[0]!.pullRequest.repoId, { fullName: "acme/renamed" }],
    ]);

    await readLiveStacks(
      makeDeps(listOpenPulls),
      makeInput(rows, { repoNames }),
    );

    expect(listOpenPulls).toHaveBeenCalledWith({
      owner: "acme",
      repo: "renamed",
    });
  });

  it("an unreachable url row lends no label, so nothing is read for it", async () => {
    const listOpenPulls = stubListOpenPulls({ open: [] });
    const rows = [
      makeRow(1n, 100n, 8, {
        installationId: null,
        githubUnreachableAt: new Date("2026-09-21T00:00:00Z"),
      }),
    ];

    const stacks = await readLiveStacks(
      makeDeps(listOpenPulls),
      makeInput(rows, { repoNames: new Map() }),
    );

    expect(listOpenPulls).not.toHaveBeenCalled();
    expect(stacks.size).toBe(0);
  });

  it("an unreadable token halts the remaining repositories after one warn", async () => {
    const listOpenPulls = stubListOpenPulls({ tokenDead: true });
    const rows = [
      makeRow(1n, 100n, 8),
      makeRow(2n, 200n, 8),
      makeRow(3n, 300n, 8),
      makeRow(4n, 400n, 8),
      makeRow(5n, 500n, 8),
    ];

    const stacks = await readLiveStacks(
      makeDeps(listOpenPulls),
      makeInput(rows),
    );

    expect(stacks.size).toBe(0);
    expect(listOpenPulls.mock.calls.length).toBeLessThanOrEqual(3);
    expect(log.warn).toHaveBeenCalledWith(
      "viewer token unreadable, no live stack for any row",
      { repoId: "100", code: "token-unreadable" },
    );
  });
});
