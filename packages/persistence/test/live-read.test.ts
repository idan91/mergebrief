// The live read's storage side: which url rows are due, what a read writes
// back, and how an unreachable row is marked. Owner-scoped throughout.
import { describe, expect, it } from "vitest";
import {
  createLiveReadStore,
  createTenantRepository,
  type AppDatabase,
  type LiveReadFacts,
  type OwnerContext,
} from "../src/index";
import {
  isPullRequestRowId,
  isRepoId,
  isReviewerId,
  type PullRequestRowId,
  type RepoId,
  type ReviewerId,
} from "../src/types";
import { PrStates } from "types/pull-requests";
import { brandWith, freshDatabase } from "./helpers";

const OWNER_A: ReviewerId = brandWith(isReviewerId, 501n);
const OWNER_B: ReviewerId = brandWith(isReviewerId, 502n);
const REPO: RepoId = brandWith(isRepoId, 777n);
const CTX_A: OwnerContext = { ownerUserId: OWNER_A };
const CTX_B: OwnerContext = { ownerUserId: OWNER_B };

const NOW = new Date("2026-09-20T12:00:00Z");
const FIVE_MINUTES_MS = 5 * 60 * 1000;
const HEAD = "a".repeat(40);

function minutesAgo(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * 60 * 1000);
}

function unwrap<T>(row: T | undefined): T {
  if (row === undefined) {
    throw new Error("expected a row, got undefined");
  }
  return row;
}

function stubFacts(overrides?: Partial<LiveReadFacts>): LiveReadFacts {
  return {
    readAt: NOW,
    headSha: HEAD,
    repoSlug: "acme/widgets",
    title: "live title",
    draft: false,
    githubUpdatedAt: NOW,
    lifecycle: { state: PrStates.OPEN },
    ...overrides,
  };
}

async function seedOpen(
  handle: AppDatabase,
  ctx: OwnerContext,
  prNumber: number,
): Promise<PullRequestRowId> {
  const row = await createTenantRepository(handle, ctx).pullRequests.upsert({
    repoId: REPO,
    prNumber,
    repoSlug: "acme/widgets",
    state: PrStates.OPEN,
  });
  return brandWith(isPullRequestRowId, row.id);
}

describe("createLiveReadStore.listDue", () => {
  it("lists never-read rows first, then the oldest read, under the limit", async () => {
    const handle = await freshDatabase();
    const store = createLiveReadStore(handle, CTX_A);
    const neverRead = await seedOpen(handle, CTX_A, 1);
    const readLongAgo = await seedOpen(handle, CTX_A, 2);
    const readJustNow = await seedOpen(handle, CTX_A, 3);
    unwrap(
      await store.record(readLongAgo, stubFacts({ readAt: minutesAgo(10) })),
    );
    unwrap(
      await store.record(readJustNow, stubFacts({ readAt: minutesAgo(1) })),
    );

    const due = await store.listDue({
      now: NOW,
      staleMs: FIVE_MINUTES_MS,
      limit: 10,
    });
    expect(due.map((row) => row.id)).toEqual([neverRead, readLongAgo]);

    const capped = await store.listDue({
      now: NOW,
      staleMs: FIVE_MINUTES_MS,
      limit: 1,
    });
    expect(capped.map((row) => row.id)).toEqual([neverRead]);
  });

  it("a merged row is never due; a closed one is", async () => {
    const handle = await freshDatabase();
    const store = createLiveReadStore(handle, CTX_A);
    const merged = await seedOpen(handle, CTX_A, 1);
    const closed = await seedOpen(handle, CTX_A, 2);
    unwrap(
      await store.record(
        merged,
        stubFacts({
          readAt: minutesAgo(10),
          lifecycle: {
            state: PrStates.MERGED,
            closedAt: minutesAgo(30),
          },
        }),
      ),
    );
    unwrap(
      await store.record(
        closed,
        stubFacts({
          readAt: minutesAgo(10),
          lifecycle: {
            state: PrStates.CLOSED,
            closedAt: minutesAgo(30),
          },
        }),
      ),
    );

    const due = await store.listDue({
      now: NOW,
      staleMs: FIVE_MINUTES_MS,
      limit: 10,
    });
    expect(due.map((row) => row.id)).toEqual([closed]);
  });

  it("sees the owner's rows only", async () => {
    const handle = await freshDatabase();
    await seedOpen(handle, CTX_A, 1);

    const due = await createLiveReadStore(handle, CTX_B).listDue({
      now: NOW,
      staleMs: FIVE_MINUTES_MS,
      limit: 10,
    });
    expect(due).toEqual([]);
  });
});

describe("createLiveReadStore.record", () => {
  it("writes the read facts and a live open beats a stored closed", async () => {
    const handle = await freshDatabase();
    const store = createLiveReadStore(handle, CTX_A);
    const id = await seedOpen(handle, CTX_A, 1);
    unwrap(
      await store.record(
        id,
        stubFacts({
          lifecycle: {
            state: PrStates.CLOSED,
            closedAt: minutesAgo(30),
          },
        }),
      ),
    );
    unwrap(await store.markUnreachable(id, minutesAgo(3)));

    const row = unwrap(
      await store.record(
        id,
        stubFacts({ title: "reopened", draft: true, headSha: "b".repeat(40) }),
      ),
    );

    expect(row.state).toBe(PrStates.OPEN);
    expect(row.closedAt).toBeNull();
    expect(row.title).toBe("reopened");
    expect(row.draft).toBe(true);
    expect(row.githubHeadSha).toBe("b".repeat(40));
    expect(row.githubReadAt).toEqual(NOW);
    expect(row.githubUpdatedAt).toEqual(NOW);
    expect(row.githubUnreachableAt).toBeNull();
  });

  it("writes the author GitHub names and keeps it when the account is gone", async () => {
    const handle = await freshDatabase();
    const store = createLiveReadStore(handle, CTX_A);
    const id = await seedOpen(handle, CTX_A, 1);

    const named = unwrap(
      await store.record(id, stubFacts({ authorLogin: "octocat" })),
    );
    const gone = unwrap(await store.record(id, stubFacts()));

    expect(named.authorLogin).toBe("octocat");
    expect(gone.authorLogin).toBe("octocat");
  });

  it("refuses another owner's row", async () => {
    const handle = await freshDatabase();
    const id = await seedOpen(handle, CTX_A, 1);

    const result = await createLiveReadStore(handle, CTX_B).record(
      id,
      stubFacts(),
    );
    expect(result).toBeUndefined();
  });
});

describe("createLiveReadStore.stampAttempt", () => {
  it("stamps the read and leaves the facts and the mark alone", async () => {
    const handle = await freshDatabase();
    const store = createLiveReadStore(handle, CTX_A);
    const id = await seedOpen(handle, CTX_A, 1);
    unwrap(await store.markUnreachable(id, minutesAgo(10)));

    const row = unwrap(await store.stampAttempt(id, NOW));

    expect(row.githubReadAt).toEqual(NOW);
    expect(row.githubUnreachableAt).toEqual(minutesAgo(10));
    expect(row.githubHeadSha).toBeNull();
  });

  it("refuses another owner's row", async () => {
    const handle = await freshDatabase();
    const id = await seedOpen(handle, CTX_A, 1);

    const result = await createLiveReadStore(handle, CTX_B).stampAttempt(
      id,
      NOW,
    );

    expect(result).toBeUndefined();
  });
});

describe("createLiveReadStore.markUnreachable", () => {
  it("keeps the first sighting and stamps every read", async () => {
    const handle = await freshDatabase();
    const store = createLiveReadStore(handle, CTX_A);
    const id = await seedOpen(handle, CTX_A, 1);

    unwrap(await store.markUnreachable(id, minutesAgo(10)));
    const row = unwrap(await store.markUnreachable(id, NOW));

    expect(row.githubUnreachableAt).toEqual(minutesAgo(10));
    expect(row.githubReadAt).toEqual(NOW);
  });

  it("a paste stamp clears the mark", async () => {
    const handle = await freshDatabase();
    const store = createLiveReadStore(handle, CTX_A);
    const id = await seedOpen(handle, CTX_A, 1);
    unwrap(await store.markUnreachable(id, minutesAgo(10)));

    const row = await createTenantRepository(handle, CTX_A).pullRequests.upsert(
      {
        repoId: REPO,
        prNumber: 1,
        repoSlug: "acme/widgets",
        state: PrStates.OPEN,
        liveRead: { readAt: NOW, headSha: HEAD },
      },
    );

    expect(row.id).toBe(id);
    expect(row.githubUnreachableAt).toBeNull();
    expect(row.githubReadAt).toEqual(NOW);
    expect(row.githubHeadSha).toBe(HEAD);
  });
});
