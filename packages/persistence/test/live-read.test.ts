// The live read's storage side: which rows are due, what a read writes
// back, and how an unreachable row is marked.
import { describe, expect, it } from "vitest";
import {
  createIngestRoutines,
  createLiveReadStore,
  createTenantRepository,
  type AppDatabase,
  type LiveReadFacts,
  type OwnerContext,
  type ScopeContext,
  type TenantContext,
} from "../src/index";
import {
  isInstallationId,
  isPullRequestRowId,
  isRepoId,
  isReviewerId,
  type PullRequestRowId,
  type RepoId,
  type ReviewerId,
} from "../src/types";
import { PrStates } from "types/pull-requests";
import { brandWith, registerSharedPglite } from "./helpers";

const shared = registerSharedPglite();

const OWNER_A: ReviewerId = brandWith(isReviewerId, 501n);
const OWNER_B: ReviewerId = brandWith(isReviewerId, 502n);
const REPO: RepoId = brandWith(isRepoId, 777n);
const CTX_A: OwnerContext = { ownerUserId: OWNER_A };
const CTX_B: OwnerContext = { ownerUserId: OWNER_B };
const OTHER_REPO: RepoId = brandWith(isRepoId, 778n);
const TENANT: TenantContext = {
  installationId: brandWith(isInstallationId, 9001n),
};

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
  ctx: ScopeContext,
  prNumber: number,
  repoId: RepoId = REPO,
): Promise<PullRequestRowId> {
  const row = await createTenantRepository(handle, ctx).pullRequests.upsert({
    repoId,
    prNumber,
    repoSlug: "acme/widgets",
    state: PrStates.OPEN,
  });
  return brandWith(isPullRequestRowId, row.id);
}

describe("createLiveReadStore.listDue", () => {
  it("lists never-read rows first, then the oldest read, under the limit", async () => {
    const handle = shared.handle;
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
    const handle = shared.handle;
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

  it("lists an installation's rows in the given repositories only", async () => {
    const handle = shared.handle;
    const store = createLiveReadStore(handle, TENANT);
    const readable = await seedOpen(handle, TENANT, 1);
    await seedOpen(handle, TENANT, 2, OTHER_REPO);
    await seedOpen(handle, CTX_A, 3);

    const due = await store.listDue({
      now: NOW,
      staleMs: FIVE_MINUTES_MS,
      limit: 10,
      repoIds: [REPO],
    });
    const none = await store.listDue({
      now: NOW,
      staleMs: FIVE_MINUTES_MS,
      limit: 10,
      repoIds: [],
    });

    expect(due.map((row) => row.id)).toEqual([readable]);
    expect(none).toEqual([]);
  });

  it("lists an installation's open rows only", async () => {
    const handle = shared.handle;
    const open = await seedOpen(handle, TENANT, 1);
    await createIngestRoutines(handle, TENANT).recordState({
      repoId: REPO,
      prNumber: 2,
      repoSlug: "acme/widgets",
      state: PrStates.CLOSED,
      closedAt: minutesAgo(5),
    });

    const due = await createLiveReadStore(handle, TENANT).listDue({
      now: NOW,
      staleMs: FIVE_MINUTES_MS,
      limit: 10,
      repoIds: [REPO],
    });

    expect(due.map((row) => row.id)).toEqual([open]);
  });

  it("sees the owner's rows only", async () => {
    const handle = shared.handle;
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
    const handle = shared.handle;
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

    const reopenedAt = minutesAgo(-1);
    const reopened = stubFacts({
      title: "reopened",
      draft: true,
      headSha: "b".repeat(40),
      githubUpdatedAt: reopenedAt,
    });
    const row = unwrap(await store.record(id, reopened));

    expect(row.state).toBe(PrStates.OPEN);
    expect(row.closedAt).toBeNull();
    expect(row.title).toBe("reopened");
    expect(row.draft).toBe(true);
    expect(row.githubHeadSha).toBe("b".repeat(40));
    expect(row.githubReadAt).toEqual(NOW);
    expect(row.githubUpdatedAt).toEqual(reopenedAt);
    expect(row.githubUnreachableAt).toBeNull();
  });

  it("writes the author GitHub names and keeps it when the account is gone", async () => {
    const handle = shared.handle;
    const store = createLiveReadStore(handle, CTX_A);
    const id = await seedOpen(handle, CTX_A, 1);

    const named = unwrap(
      await store.record(id, stubFacts({ authorLogin: "octocat" })),
    );
    const gone = unwrap(await store.record(id, stubFacts()));

    expect(named.authorLogin).toBe("octocat");
    expect(gone.authorLogin).toBe("octocat");
  });

  it("keeps a newer webhook's facts and takes only the read stamp", async () => {
    const handle = shared.handle;
    const store = createLiveReadStore(handle, TENANT);
    const id = await seedOpen(handle, TENANT, 1);
    await createTenantRepository(handle, TENANT).pullRequests.upsert({
      repoId: REPO,
      prNumber: 1,
      repoSlug: "acme/widgets",
      state: PrStates.OPEN,
      draft: false,
      githubUpdatedAt: NOW,
    });

    const laterRead = minutesAgo(-1);
    const olderSnapshot = minutesAgo(10);
    const staleFacts = stubFacts({
      draft: true,
      readAt: laterRead,
      githubUpdatedAt: olderSnapshot,
    });
    const stale = unwrap(await store.record(id, staleFacts));

    expect(stale.draft).toBe(false);
    expect(stale.githubUpdatedAt).toEqual(NOW);
    expect(stale.githubReadAt).toEqual(laterRead);
  });

  it("keeps a later read's facts against an earlier read landing last", async () => {
    const handle = shared.handle;
    const store = createLiveReadStore(handle, TENANT);
    const id = await seedOpen(handle, TENANT, 1);
    const laterRead = stubFacts({ draft: false, readAt: minutesAgo(-1) });
    unwrap(await store.record(id, laterRead));

    const earlierRead = stubFacts({ draft: true, readAt: minutesAgo(1) });
    const row = unwrap(await store.record(id, earlierRead));

    expect(row.draft).toBe(false);
    expect(row.githubReadAt).toEqual(minutesAgo(-1));
  });

  it("never writes an installation row's github_updated_at", async () => {
    const handle = shared.handle;
    const id = await seedOpen(handle, TENANT, 1);
    const store = createLiveReadStore(handle, TENANT);
    const facts = stubFacts({ draft: true });

    const row = unwrap(await store.record(id, facts));

    expect(row.draft).toBe(true);
    expect(row.githubUpdatedAt).toBeNull();
  });

  it("reopens a closed row only on a strictly newer read", async () => {
    const handle = shared.handle;
    const id = await seedOpen(handle, TENANT, 1);
    const closedAt = minutesAgo(1);
    const ingest = createIngestRoutines(handle, TENANT);
    await ingest.recordState({
      repoId: REPO,
      prNumber: 1,
      repoSlug: "acme/widgets",
      state: PrStates.CLOSED,
      closedAt,
      githubUpdatedAt: NOW,
    });
    const store = createLiveReadStore(handle, TENANT);

    const sameSecondOpen = stubFacts();
    const sameSecond = unwrap(await store.record(id, sameSecondOpen));
    const laterOpen = stubFacts({ githubUpdatedAt: minutesAgo(-1) });
    const reopened = unwrap(await store.record(id, laterOpen));

    expect(sameSecond.state).toBe(PrStates.CLOSED);
    expect(sameSecond.closedAt).toEqual(closedAt);
    expect(reopened.state).toBe(PrStates.OPEN);
  });

  it("keeps a merged row against an equal-timestamp open snapshot", async () => {
    const handle = shared.handle;
    const store = createLiveReadStore(handle, TENANT);
    const id = await seedOpen(handle, TENANT, 1);
    const closedAt = minutesAgo(1);
    const merged = stubFacts({
      lifecycle: { state: PrStates.MERGED, closedAt },
    });
    unwrap(await store.record(id, merged));

    const laterRead = minutesAgo(-1);
    const openSnapshot = stubFacts({ readAt: laterRead });
    const row = unwrap(await store.record(id, openSnapshot));

    expect(row.state).toBe(PrStates.MERGED);
    expect(row.closedAt).toEqual(closedAt);
    expect(row.githubReadAt).toEqual(laterRead);
  });

  it("keeps a webhook merge against an equal-timestamp open live read", async () => {
    const handle = shared.handle;
    const id = await seedOpen(handle, TENANT, 1);
    const closedAt = minutesAgo(1);
    const ingest = createIngestRoutines(handle, TENANT);
    await ingest.recordState({
      repoId: REPO,
      prNumber: 1,
      repoSlug: "acme/widgets",
      state: PrStates.MERGED,
      closedAt,
      githubUpdatedAt: NOW,
    });
    const store = createLiveReadStore(handle, TENANT);

    const delayedOpen = stubFacts({ readAt: minutesAgo(-1) });
    const row = unwrap(await store.record(id, delayedOpen));

    expect(row.state).toBe(PrStates.MERGED);
    expect(row.closedAt).toEqual(closedAt);
  });

  it("keeps a webhook's facts against a same-second read that raced it", async () => {
    const handle = shared.handle;
    const id = await seedOpen(handle, TENANT, 1);
    const store = createLiveReadStore(handle, TENANT);
    const earlierSnapshot = stubFacts({
      draft: true,
      readAt: minutesAgo(5),
      githubUpdatedAt: minutesAgo(5),
    });
    const planned = unwrap(await store.record(id, earlierSnapshot));
    const ingest = createIngestRoutines(handle, TENANT);
    await ingest.recordState({
      repoId: REPO,
      prNumber: 1,
      repoSlug: "acme/widgets",
      state: PrStates.OPEN,
      draft: false,
      githubUpdatedAt: NOW,
    });

    const racedRead = stubFacts({ draft: true, readAt: minutesAgo(-1) });
    const row = unwrap(await store.record(id, racedRead, planned));

    expect(row.draft).toBe(false);
    expect(row.githubReadAt).toEqual(minutesAgo(-1));
  });

  it("keeps a webhook's facts when the planned row already held its time", async () => {
    const handle = shared.handle;
    const id = await seedOpen(handle, TENANT, 1);
    const ingest = createIngestRoutines(handle, TENANT);
    const webhookState = {
      repoId: REPO,
      prNumber: 1,
      repoSlug: "acme/widgets",
      state: PrStates.OPEN,
      githubUpdatedAt: NOW,
    };
    const first = await ingest.recordState({ ...webhookState, draft: true });
    const planned = first.pullRequest;
    await ingest.recordState({ ...webhookState, draft: false });
    const store = createLiveReadStore(handle, TENANT);

    const heldRead = stubFacts({ draft: true, readAt: minutesAgo(-1) });
    const row = unwrap(await store.record(id, heldRead, planned));

    expect(row.draft).toBe(false);
    expect(row.githubHeadSha).toBeNull();
  });

  it("moves row_version on every live-read write", async () => {
    const handle = shared.handle;
    const id = await seedOpen(handle, CTX_A, 1);
    const store = createLiveReadStore(handle, CTX_A);
    const facts = stubFacts();
    const nextRead = minutesAgo(-1);
    const lastRead = minutesAgo(-2);

    const recorded = await store.record(id, facts);
    const attempted = await store.stampAttempt(id, nextRead);
    const unreachable = await store.markUnreachable(id, lastRead);
    const versions = [recorded, attempted, unreachable];

    expect(versions.map((row) => row?.rowVersion)).toEqual([1, 2, 3]);
  });

  it("repairs a row whose time the worker advanced without its facts", async () => {
    const handle = shared.handle;
    const id = await seedOpen(handle, TENANT, 1);
    const ingest = createIngestRoutines(handle, TENANT);
    await ingest.recordState({
      repoId: REPO,
      prNumber: 1,
      repoSlug: "acme/widgets",
      state: PrStates.OPEN,
      draft: true,
      githubUpdatedAt: minutesAgo(5),
    });
    const { pullRequests } = createTenantRepository(handle, TENANT);
    const planned = unwrap(await pullRequests.advanceGithubUpdatedAt(id, NOW));
    const store = createLiveReadStore(handle, TENANT);

    const sameVersion = stubFacts({ readAt: minutesAgo(-1) });
    const row = unwrap(await store.record(id, sameVersion, planned));

    expect(row.draft).toBe(false);
    expect(row.githubHeadSha).toBe(HEAD);
  });

  it("writes an installation row's facts from a strictly newer read", async () => {
    const handle = shared.handle;
    const id = await seedOpen(handle, TENANT, 1);
    const ingest = createIngestRoutines(handle, TENANT);
    await ingest.recordState({
      repoId: REPO,
      prNumber: 1,
      repoSlug: "acme/widgets",
      state: PrStates.OPEN,
      draft: true,
      githubUpdatedAt: NOW,
    });
    const store = createLiveReadStore(handle, TENANT);

    const newerRead = stubFacts({ githubUpdatedAt: minutesAgo(-1) });
    const row = unwrap(await store.record(id, newerRead));

    expect(row.draft).toBe(false);
  });

  it("refuses another owner's row", async () => {
    const handle = shared.handle;
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
    const handle = shared.handle;
    const store = createLiveReadStore(handle, CTX_A);
    const id = await seedOpen(handle, CTX_A, 1);
    unwrap(await store.markUnreachable(id, minutesAgo(10)));

    const row = unwrap(await store.stampAttempt(id, NOW));

    expect(row.githubReadAt).toEqual(NOW);
    expect(row.githubUnreachableAt).toEqual(minutesAgo(10));
    expect(row.githubHeadSha).toBeNull();
  });

  it("refuses another owner's row", async () => {
    const handle = shared.handle;
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
    const handle = shared.handle;
    const store = createLiveReadStore(handle, CTX_A);
    const id = await seedOpen(handle, CTX_A, 1);

    unwrap(await store.markUnreachable(id, minutesAgo(10)));
    const row = unwrap(await store.markUnreachable(id, NOW));

    expect(row.githubUnreachableAt).toEqual(minutesAgo(10));
    expect(row.githubReadAt).toEqual(NOW);
  });

  it("a paste stamp clears the mark", async () => {
    const handle = shared.handle;
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

  it("a stale unreachable mark leaves a row a later read cleared", async () => {
    const handle = shared.handle;
    const store = createLiveReadStore(handle, CTX_A);
    const id = await seedOpen(handle, CTX_A, 1);
    unwrap(await store.record(id, stubFacts({ readAt: NOW })));

    const row = unwrap(await store.markUnreachable(id, minutesAgo(5)));

    expect(row.githubUnreachableAt).toBeNull();
    expect(row.githubReadAt).toEqual(NOW);
  });

  it("a stale unreachable mark leaves a paste's clear standing", async () => {
    const handle = shared.handle;
    const store = createLiveReadStore(handle, CTX_A);
    const id = await seedOpen(handle, CTX_A, 1);
    unwrap(await store.markUnreachable(id, minutesAgo(10)));
    await createTenantRepository(handle, CTX_A).pullRequests.upsert({
      repoId: REPO,
      prNumber: 1,
      repoSlug: "acme/widgets",
      state: PrStates.OPEN,
      liveRead: { readAt: NOW, headSha: HEAD },
    });

    const row = unwrap(await store.markUnreachable(id, minutesAgo(5)));

    expect(row.githubUnreachableAt).toBeNull();
    expect(row.githubReadAt).toEqual(NOW);
  });
});
