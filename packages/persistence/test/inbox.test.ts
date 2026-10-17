// The Inbox list over a two-installation fixture plus the viewer's own url
// rows: every review state, the fold under both sorts, the shadowed url
// row, each filter, and a page past the end.
import { sql } from "drizzle-orm";
import {
  InboxArchivedFilters,
  InboxAuthorFilters,
  InboxReviewStates,
  InboxSorts,
  InboxStatuses,
  type InboxReviewState,
  type InboxSort,
  InboxLayouts,
} from "types/inbox";
import { describe, expect, it } from "vitest";
import {
  createArtifactStore,
  createInboxStore,
  createTenantRepository,
  type AppDatabase,
  type InboxFilters,
  type InboxListInput,
  type PullRequestLifecycle,
  type ScopeContext,
} from "../src/index";
import { internal } from "../src/db/handle";
import { brief } from "../src/schema/brief";
import {
  isBriefRowId,
  isInstallationId,
  isPullRequestRowId,
  isRepoId,
  isReviewerId,
  type BriefRowId,
  type InstallationId,
  type PullRequestRowId,
  type RepoId,
  type ReviewerId,
} from "../src/types";
import { PrStates } from "types/pull-requests";
import { brandWith, freshDatabase } from "./helpers";

const ACME: InstallationId = brandWith(isInstallationId, 10n);
const OCTO: InstallationId = brandWith(isInstallationId, 20n);
const VIEWER: ReviewerId = brandWith(isReviewerId, 501n);
const OTHER: ReviewerId = brandWith(isReviewerId, 502n);
const VIEWER_LOGIN = "octocat";
const REPO_A: RepoId = brandWith(isRepoId, 100n);
const REPO_B: RepoId = brandWith(isRepoId, 200n);

const CTX_ACME: ScopeContext = { installationId: ACME };
const CTX_OCTO: ScopeContext = { installationId: OCTO };
const CTX_OWNER: ScopeContext = { ownerUserId: VIEWER };

interface SeedRow {
  readonly ctx: ScopeContext;
  readonly repoId: RepoId;
  readonly prNumber: number;
  readonly author?: string;
  readonly draft?: boolean;
  readonly lifecycle?: PullRequestLifecycle;
  readonly updatedAt?: Date;
  readonly githubHeadSha?: string;
}

async function seedRow(
  handle: AppDatabase,
  seed: SeedRow,
): Promise<PullRequestRowId> {
  const lifecycle: PullRequestLifecycle = seed.lifecycle ?? {
    state: PrStates.OPEN,
  };
  const row = await createTenantRepository(
    handle,
    seed.ctx,
  ).pullRequests.upsert({
    repoId: seed.repoId,
    prNumber: seed.prNumber,
    repoSlug: `org/repo-${seed.repoId}`,
    title: `PR ${seed.prNumber}`,
    authorLogin: seed.author ?? "someone",
    draft: seed.draft ?? false,
    githubUpdatedAt: seed.updatedAt ?? new Date("2026-09-01T00:00:00Z"),
    ...lifecycle,
  });
  if (seed.githubHeadSha !== undefined) {
    await internal(handle).execute(
      sql`update pull_request set github_head_sha = ${seed.githubHeadSha} where id = ${row.id}`,
    );
  }
  return brandWith(isPullRequestRowId, row.id);
}

async function seedBrief(
  handle: AppDatabase,
  ctx: ScopeContext,
  pullRequestId: PullRequestRowId,
  headSha: string,
  createdAt?: Date,
  baseSha = "base",
): Promise<BriefRowId> {
  const store = createArtifactStore(handle, ctx);
  const prior = await store.briefs.listForPullRequest(pullRequestId);
  const headIndex = (prior.at(-1)?.headIndex ?? 0) + 1;
  const written = await store.briefs.write({
    pullRequestId,
    baseSha,
    headSha,
    headIndex,
    commitCount: 1,
    provider: "stub",
    model: "stub",
    effort: "low",
    body: JSON.stringify({ changeGroups: [], chunks: [] }),
  });
  if (createdAt !== undefined) {
    await internal(handle)
      .update(brief)
      .set({ createdAt })
      .where(sql`${brief.id} = ${written.id}`);
  }
  return brandWith(isBriefRowId, written.id);
}

async function openSession(
  handle: AppDatabase,
  ctx: ScopeContext,
  briefId: BriefRowId,
  reviewerId: ReviewerId,
  submit = false,
): Promise<void> {
  const sessions = createTenantRepository(handle, ctx).reviewSessions;
  const key = { briefId, reviewerId };
  const published = submit
    ? { draftIds: [], githubReviewId: 77n }
    : { draftIds: [] };
  const result = await sessions.recordPublishedDrafts(key, published);
  if (!result.ok) {
    throw new Error(`session seed failed: ${result.error.code}`);
  }
}

const DEFAULT_FILTERS: InboxFilters = {
  statuses: [InboxStatuses.OPEN, InboxStatuses.DRAFT],
  author: InboxAuthorFilters.ALL,
  archived: InboxArchivedFilters.HIDE,
};
const ARCHIVED_ONLY: InboxFilters = {
  ...DEFAULT_FILTERS,
  archived: InboxArchivedFilters.ONLY,
};

function makeListInput(overrides?: Partial<InboxListInput>): InboxListInput {
  return {
    installationIds: [ACME, OCTO],
    allowedRepoIds: [REPO_A, REPO_B],
    ownerUserId: VIEWER,
    reviewerId: VIEWER,
    reviewerLogin: VIEWER_LOGIN,
    filters: DEFAULT_FILTERS,
    sort: InboxSorts.UPDATED,
    layout: InboxLayouts.FOLDED,
    page: 1,
    pageSize: 25,
    ...overrides,
  };
}

async function listNumbers(
  handle: AppDatabase,
  overrides?: Partial<InboxListInput>,
): Promise<number[]> {
  const page = await createInboxStore(handle).list(makeListInput(overrides));
  return page.items.map((item) => item.pullRequest.prNumber);
}

describe("createInboxStore.list, review state", () => {
  it("derives every state against the latest brief", async () => {
    const handle = await freshDatabase();
    const fresh = await seedRow(handle, {
      ctx: CTX_ACME,
      repoId: REPO_A,
      prNumber: 1,
    });
    await seedBrief(handle, CTX_ACME, fresh, "h1");
    const begun = await seedRow(handle, {
      ctx: CTX_ACME,
      repoId: REPO_A,
      prNumber: 2,
    });
    await openSession(
      handle,
      CTX_ACME,
      await seedBrief(handle, CTX_ACME, begun, "h2"),
      VIEWER,
    );
    const done = await seedRow(handle, {
      ctx: CTX_ACME,
      repoId: REPO_A,
      prNumber: 3,
    });
    await openSession(
      handle,
      CTX_ACME,
      await seedBrief(handle, CTX_ACME, done, "h3"),
      VIEWER,
      true,
    );
    const moved = await seedRow(handle, {
      ctx: CTX_OCTO,
      repoId: REPO_B,
      prNumber: 4,
    });
    const older = await seedBrief(
      handle,
      CTX_OCTO,
      moved,
      "h4a",
      new Date("2026-08-01T00:00:00Z"),
    );
    await openSession(handle, CTX_OCTO, older, VIEWER, true);
    await seedBrief(
      handle,
      CTX_OCTO,
      moved,
      "h4b",
      new Date("2026-08-02T00:00:00Z"),
    );
    const mine = await seedRow(handle, {
      ctx: CTX_OCTO,
      repoId: REPO_B,
      prNumber: 5,
      author: VIEWER_LOGIN,
    });
    await seedBrief(handle, CTX_OCTO, mine, "h5");
    const someoneElse = await seedRow(handle, {
      ctx: CTX_OCTO,
      repoId: REPO_B,
      prNumber: 6,
    });
    await openSession(
      handle,
      CTX_OCTO,
      await seedBrief(handle, CTX_OCTO, someoneElse, "h6"),
      OTHER,
      true,
    );
    await seedRow(handle, { ctx: CTX_ACME, repoId: REPO_A, prNumber: 7 });
    const reviewedTwice = await seedRow(handle, {
      ctx: CTX_OCTO,
      repoId: REPO_B,
      prNumber: 8,
    });
    await openSession(
      handle,
      CTX_OCTO,
      await seedBrief(
        handle,
        CTX_OCTO,
        reviewedTwice,
        "h8a",
        new Date("2026-08-01T00:00:00Z"),
      ),
      VIEWER,
      true,
    );
    await openSession(
      handle,
      CTX_OCTO,
      await seedBrief(
        handle,
        CTX_OCTO,
        reviewedTwice,
        "h8b",
        new Date("2026-08-02T00:00:00Z"),
      ),
      VIEWER,
      true,
    );
    const movedAndBegun = await seedRow(handle, {
      ctx: CTX_OCTO,
      repoId: REPO_B,
      prNumber: 9,
    });
    await openSession(
      handle,
      CTX_OCTO,
      await seedBrief(
        handle,
        CTX_OCTO,
        movedAndBegun,
        "h9a",
        new Date("2026-08-01T00:00:00Z"),
      ),
      VIEWER,
      true,
    );
    await openSession(
      handle,
      CTX_OCTO,
      await seedBrief(
        handle,
        CTX_OCTO,
        movedAndBegun,
        "h9b",
        new Date("2026-08-02T00:00:00Z"),
      ),
      VIEWER,
    );
    await createTenantRepository(handle, CTX_ACME).pullRequests.recordStack(
      fresh,
      { stack: { members: [], index: 1 }, readAt: new Date() },
    );

    const page = await createInboxStore(handle).list(makeListInput());

    const byNumber = new Map(
      page.items.map((item) => [item.pullRequest.prNumber, item]),
    );
    const stateOf = (n: number): InboxReviewState | null | undefined =>
      byNumber.get(n)?.reviewState;
    expect(stateOf(1)).toBe(InboxReviewStates.NEW);
    expect(stateOf(2)).toBe(InboxReviewStates.IN_PROGRESS);
    expect(stateOf(3)).toBe(InboxReviewStates.REVIEWED);
    expect(stateOf(4)).toBe(InboxReviewStates.UPDATED);
    expect(stateOf(5)).toBeNull();
    expect(byNumber.get(5)?.viewerIsAuthor).toBe(true);
    expect(stateOf(6)).toBe(InboxReviewStates.NEW);
    expect(stateOf(7)).toBe(InboxReviewStates.NEW);
    expect(byNumber.get(7)?.latestBrief).toBeUndefined();
    expect(stateOf(8)).toBe(InboxReviewStates.REVIEWED);
    expect(stateOf(9)).toBe(InboxReviewStates.UPDATED);
    const latest = byNumber.get(1)?.latestBrief;
    expect(typeof latest?.id).toBe("bigint");
    expect(latest?.createdAt).toBeInstanceOf(Date);
    expect(byNumber.get(1)?.pullRequest.stack).toEqual({
      members: [],
      index: 1,
    });
    expect(byNumber.get(2)?.pullRequest.stack).toBeNull();
    expect(page.counts).toEqual({
      new: 3,
      inProgress: 1,
      reviewed: 2,
      updated: 2,
    });
    expect(page.total).toBe(9);
  });

  it("marks a row behind when GitHub reports a head past the brief", async () => {
    const handle = await freshDatabase();
    const behind = await seedRow(handle, {
      ctx: CTX_ACME,
      repoId: REPO_A,
      prNumber: 1,
      githubHeadSha: "newer",
    });
    await seedBrief(handle, CTX_ACME, behind, "h1");
    const current = await seedRow(handle, {
      ctx: CTX_ACME,
      repoId: REPO_A,
      prNumber: 2,
      githubHeadSha: "h2",
    });
    await seedBrief(handle, CTX_ACME, current, "h2");

    const page = await createInboxStore(handle).list(makeListInput());

    const flags = page.items.map((item) => [
      item.pullRequest.prNumber,
      item.behind,
    ]);
    expect(flags).toEqual(
      expect.arrayContaining([
        [1, true],
        [2, false],
      ]),
    );
  });
});

describe("createInboxStore.list, the latest brief", () => {
  it("is the newest head even when an older head was written last", async () => {
    const handle = await freshDatabase();
    const prId = await seedRow(handle, {
      ctx: CTX_ACME,
      repoId: REPO_A,
      prNumber: 1,
    });
    await seedBrief(
      handle,
      CTX_ACME,
      prId,
      "head-1",
      new Date("2026-09-02T00:00:00Z"),
    );
    await seedBrief(
      handle,
      CTX_ACME,
      prId,
      "head-2",
      new Date("2026-09-01T00:00:00Z"),
    );

    const page = await createInboxStore(handle).list(makeListInput());

    expect(page.items[0]?.latestBrief?.headSha).toBe("head-2");
  });

  it("archives at the newest head even when an older one was written last", async () => {
    const handle = await freshDatabase();
    const prId = await seedRow(handle, {
      ctx: CTX_ACME,
      repoId: REPO_A,
      prNumber: 1,
    });
    await seedBrief(
      handle,
      CTX_ACME,
      prId,
      "head-1",
      new Date("2026-09-02T00:00:00Z"),
    );
    await seedBrief(
      handle,
      CTX_ACME,
      prId,
      "head-2",
      new Date("2026-09-01T00:00:00Z"),
    );

    await createTenantRepository(handle, CTX_ACME).archives.set(prId, VIEWER);

    expect(await listNumbers(handle)).toEqual([]);
    expect(await listNumbers(handle, { filters: ARCHIVED_ONLY })).toEqual([1]);
  });
});

describe("createInboxStore.list, fold and sort", () => {
  async function seedFoldFixture(handle: AppDatabase): Promise<void> {
    const at = (day: number): Date =>
      new Date(`2026-09-${String(day).padStart(2, "0")}T00:00:00Z`);
    // Reviewed and newest by update: sinks below the fold.
    const reviewed = await seedRow(handle, {
      ctx: CTX_ACME,
      repoId: REPO_A,
      prNumber: 1,
      updatedAt: at(9),
    });
    await openSession(
      handle,
      CTX_ACME,
      await seedBrief(handle, CTX_ACME, reviewed, "h1", at(1)),
      VIEWER,
      true,
    );
    // New, updated on day 5, brief generated day 8.
    const newLater = await seedRow(handle, {
      ctx: CTX_ACME,
      repoId: REPO_A,
      prNumber: 2,
      updatedAt: at(5),
    });
    await seedBrief(handle, CTX_ACME, newLater, "h2", at(8));
    // New, updated on day 7, brief generated day 3.
    const newEarlier = await seedRow(handle, {
      ctx: CTX_OCTO,
      repoId: REPO_B,
      prNumber: 3,
      updatedAt: at(7),
    });
    await seedBrief(handle, CTX_OCTO, newEarlier, "h3", at(3));
    // In progress, updated day 8: still the reviewer's work, above the fold.
    const begun = await seedRow(handle, {
      ctx: CTX_OCTO,
      repoId: REPO_B,
      prNumber: 4,
      updatedAt: at(8),
    });
    await openSession(
      handle,
      CTX_OCTO,
      await seedBrief(handle, CTX_OCTO, begun, "h4", at(6)),
      VIEWER,
    );
  }

  it("puts rows that need the viewer first, then the rest, by update", async () => {
    const handle = await freshDatabase();
    await seedFoldFixture(handle);

    expect(await listNumbers(handle, { sort: InboxSorts.UPDATED })).toEqual([
      4, 3, 2, 1,
    ]);
  });

  it("the mixed layout is one list in the sort's order", async () => {
    const handle = await freshDatabase();
    await seedFoldFixture(handle);

    expect(
      await listNumbers(handle, {
        sort: InboxSorts.UPDATED,
        layout: InboxLayouts.MIXED,
      }),
    ).toEqual([1, 4, 3, 2]);
  });

  it("keeps the fold under the generated sort", async () => {
    const handle = await freshDatabase();
    await seedFoldFixture(handle);

    expect(await listNumbers(handle, { sort: InboxSorts.GENERATED })).toEqual([
      2, 4, 3, 1,
    ]);
  });

  it("a draft or a merged row sits below the fold whatever its state", async () => {
    const handle = await freshDatabase();
    await seedFoldFixture(handle);
    await seedRow(handle, {
      ctx: CTX_ACME,
      repoId: REPO_A,
      prNumber: 5,
      draft: true,
      updatedAt: new Date("2026-09-20T00:00:00Z"),
    });
    await seedRow(handle, {
      ctx: CTX_ACME,
      repoId: REPO_A,
      prNumber: 6,
      lifecycle: {
        state: PrStates.MERGED,
        closedAt: new Date("2026-09-20T00:00:00Z"),
      },
      updatedAt: new Date("2026-09-20T00:00:00Z"),
    });
    const everyStatus = Object.values(InboxStatuses);

    const page = await createInboxStore(handle).list(
      makeListInput({ filters: { ...DEFAULT_FILTERS, statuses: everyStatus } }),
    );

    expect(page.items.map((item) => item.pullRequest.prNumber)).toEqual([
      4, 3, 2, 6, 5, 1,
    ]);
    expect(page.counts.new).toBe(2);
  });
});

describe("createInboxStore.list, visibility", () => {
  it("hides an installation row in a repository the viewer cannot read", async () => {
    const handle = await freshDatabase();
    await seedRow(handle, { ctx: CTX_ACME, repoId: REPO_A, prNumber: 1 });
    await seedRow(handle, { ctx: CTX_ACME, repoId: REPO_B, prNumber: 2 });
    await seedRow(handle, { ctx: CTX_OWNER, repoId: REPO_B, prNumber: 2 });

    const page = await createInboxStore(handle).list(
      makeListInput({ allowedRepoIds: [REPO_A] }),
    );

    expect(
      page.items.map((item) => [
        item.pullRequest.prNumber,
        item.pullRequest.source,
      ]),
    ).toEqual([
      [2, "url"],
      [1, "installation"],
    ]);
    expect(page.counts.new).toBe(2);
  });

  it("an archived row leaves the page, counts, total and repositories", async () => {
    const handle = await freshDatabase();
    const archived = await seedRow(handle, {
      ctx: CTX_ACME,
      repoId: REPO_A,
      prNumber: 1,
    });
    await seedRow(handle, { ctx: CTX_OCTO, repoId: REPO_B, prNumber: 2 });
    await createTenantRepository(handle, CTX_ACME).archives.set(
      archived,
      VIEWER,
    );

    const page = await createInboxStore(handle).list(makeListInput());

    expect(page.items.map((item) => item.pullRequest.prNumber)).toEqual([2]);
    expect(page.total).toBe(1);
    expect(page.counts.new).toBe(1);
    expect(page.repositories.map((repo) => repo.repoId)).toEqual([REPO_B]);
    expect(page.archivedTotal).toBe(1);
  });

  it("a newer brief lifts the archive", async () => {
    const handle = await freshDatabase();
    const prId = await seedRow(handle, {
      ctx: CTX_ACME,
      repoId: REPO_A,
      prNumber: 1,
    });
    await seedBrief(
      handle,
      CTX_ACME,
      prId,
      "head-1",
      new Date("2026-09-01T00:00:00Z"),
    );
    await createTenantRepository(handle, CTX_ACME).archives.set(prId, VIEWER);
    expect(await listNumbers(handle)).toEqual([]);

    await seedBrief(handle, CTX_ACME, prId, "head-2");

    expect(await listNumbers(handle)).toEqual([1]);
    expect(await listNumbers(handle, { filters: ARCHIVED_ONLY })).toEqual([]);
  });

  it("the archived view lists only archived rows and totals them", async () => {
    const handle = await freshDatabase();
    const archived = await seedRow(handle, {
      ctx: CTX_ACME,
      repoId: REPO_A,
      prNumber: 1,
    });
    await seedRow(handle, { ctx: CTX_ACME, repoId: REPO_A, prNumber: 2 });
    await createTenantRepository(handle, CTX_ACME).archives.set(
      archived,
      VIEWER,
    );

    const page = await createInboxStore(handle).list(
      makeListInput({ filters: ARCHIVED_ONLY }),
    );

    expect(page.items.map((item) => item.pullRequest.prNumber)).toEqual([1]);
    expect(page.total).toBe(1);
    expect(page.archivedTotal).toBe(1);
  });

  it("a brief at the same head, a retarget, keeps the archive", async () => {
    const handle = await freshDatabase();
    const prId = await seedRow(handle, {
      ctx: CTX_ACME,
      repoId: REPO_A,
      prNumber: 1,
    });
    await seedBrief(
      handle,
      CTX_ACME,
      prId,
      "head-1",
      new Date("2026-09-01T00:00:00Z"),
    );
    await createTenantRepository(handle, CTX_ACME).archives.set(prId, VIEWER);

    await seedBrief(handle, CTX_ACME, prId, "head-1", undefined, "base-2");

    expect(await listNumbers(handle)).toEqual([]);
    expect(await listNumbers(handle, { filters: ARCHIVED_ONLY })).toEqual([1]);
  });

  it("the counts never include an archived row, in either view", async () => {
    const handle = await freshDatabase();
    const archived = await seedRow(handle, {
      ctx: CTX_ACME,
      repoId: REPO_A,
      prNumber: 1,
    });
    await seedRow(handle, { ctx: CTX_ACME, repoId: REPO_A, prNumber: 2 });
    await createTenantRepository(handle, CTX_ACME).archives.set(
      archived,
      VIEWER,
    );
    const store = createInboxStore(handle);

    const inbox = await store.list(makeListInput());
    const view = await store.list(makeListInput({ filters: ARCHIVED_ONLY }));

    expect(inbox.counts).toEqual(view.counts);
    expect(view.counts.new).toBe(1);
    expect(view.total).toBe(1);
    expect(view.repositories.map((repo) => repo.repoId)).toEqual([REPO_A]);
  });

  it("the archived total ignores the other filters", async () => {
    const handle = await freshDatabase();
    const open = await seedRow(handle, {
      ctx: CTX_ACME,
      repoId: REPO_A,
      prNumber: 1,
    });
    const merged = await seedRow(handle, {
      ctx: CTX_ACME,
      repoId: REPO_A,
      prNumber: 2,
      lifecycle: {
        state: PrStates.MERGED,
        closedAt: new Date(),
      },
    });
    const archives = createTenantRepository(handle, CTX_ACME).archives;
    await archives.set(open, VIEWER);
    await archives.set(merged, VIEWER);

    const page = await createInboxStore(handle).list(makeListInput());
    const view = await createInboxStore(handle).list(
      makeListInput({ filters: ARCHIVED_ONLY }),
    );

    expect(page.total).toBe(0);
    expect(page.repositories).toEqual([]);
    expect(page.archivedTotal).toBe(2);
    expect(view.total).toBe(1);
    expect(view.archivedTotal).toBe(2);
  });

  it("another reviewer's archive does not touch the viewer's list", async () => {
    const handle = await freshDatabase();
    const prId = await seedRow(handle, {
      ctx: CTX_ACME,
      repoId: REPO_A,
      prNumber: 1,
    });
    await createTenantRepository(handle, CTX_ACME).archives.set(prId, OTHER);

    expect(await listNumbers(handle)).toEqual([1]);
    expect(await listNumbers(handle, { filters: ARCHIVED_ONLY })).toEqual([]);
  });

  it("hides a url row shadowed by a visible installation row", async () => {
    const handle = await freshDatabase();
    await seedRow(handle, { ctx: CTX_ACME, repoId: REPO_A, prNumber: 1 });
    await seedRow(handle, { ctx: CTX_OWNER, repoId: REPO_A, prNumber: 1 });
    await seedRow(handle, { ctx: CTX_OWNER, repoId: REPO_B, prNumber: 2 });

    const both = await createInboxStore(handle).list(makeListInput());
    expect(
      both.items.map((item) => [
        item.pullRequest.prNumber,
        item.pullRequest.source,
      ]),
    ).toEqual([
      [2, "url"],
      [1, "installation"],
    ]);

    const noAcme = await createInboxStore(handle).list(
      makeListInput({ installationIds: [OCTO] }),
    );
    expect(
      noAcme.items.map((item) => [
        item.pullRequest.prNumber,
        item.pullRequest.source,
      ]),
    ).toEqual([
      [2, "url"],
      [1, "url"],
    ]);
  });

  it("shows another owner's url rows to nobody else", async () => {
    const handle = await freshDatabase();
    await seedRow(handle, {
      ctx: { ownerUserId: OTHER },
      repoId: REPO_A,
      prNumber: 1,
    });

    expect(await listNumbers(handle, { installationIds: [] })).toEqual([]);
  });
});

describe("createInboxStore.list, filters", () => {
  async function seedFilterFixture(handle: AppDatabase): Promise<void> {
    await seedRow(handle, { ctx: CTX_ACME, repoId: REPO_A, prNumber: 1 });
    await seedRow(handle, {
      ctx: CTX_ACME,
      repoId: REPO_A,
      prNumber: 2,
      draft: true,
    });
    await seedRow(handle, {
      ctx: CTX_ACME,
      repoId: REPO_A,
      prNumber: 3,
      lifecycle: {
        state: PrStates.MERGED,
        closedAt: new Date(),
      },
    });
    await seedRow(handle, {
      ctx: CTX_OCTO,
      repoId: REPO_B,
      prNumber: 4,
      lifecycle: {
        state: PrStates.CLOSED,
        closedAt: new Date(),
      },
    });
    const mine = await seedRow(handle, {
      ctx: CTX_OCTO,
      repoId: REPO_B,
      prNumber: 5,
      author: VIEWER_LOGIN,
    });
    await seedBrief(handle, CTX_OCTO, mine, "h5");
    const reviewed = await seedRow(handle, {
      ctx: CTX_OCTO,
      repoId: REPO_B,
      prNumber: 6,
    });
    await openSession(
      handle,
      CTX_OCTO,
      await seedBrief(handle, CTX_OCTO, reviewed, "h6"),
      VIEWER,
      true,
    );
  }

  it("a row with no author is nobody's own and shows under others", async () => {
    const handle = await freshDatabase();
    await seedRow(handle, { ctx: CTX_ACME, repoId: REPO_A, prNumber: 1 });
    await internal(handle).execute(
      sql`update pull_request set author_login = null`,
    );

    const page = await createInboxStore(handle).list(
      makeListInput({
        filters: { ...DEFAULT_FILTERS, author: InboxAuthorFilters.OTHERS },
      }),
    );

    expect(page.items.map((item) => item.viewerIsAuthor)).toEqual([false]);
  });

  it("status defaults to open and draft; merged and closed opt in", async () => {
    const handle = await freshDatabase();
    await seedFilterFixture(handle);

    // The open new row leads; the reviewed one, the viewer's own and the draft sink.
    expect(await listNumbers(handle)).toEqual([1, 6, 5, 2]);
    expect(
      await listNumbers(handle, {
        filters: {
          ...DEFAULT_FILTERS,
          statuses: [InboxStatuses.MERGED, InboxStatuses.CLOSED],
        },
      }),
    ).toEqual([4, 3]);
    expect(
      await listNumbers(handle, {
        filters: { ...DEFAULT_FILTERS, statuses: [] },
      }),
    ).toHaveLength(6);
  });

  it("narrows by repository, review state, author and installation", async () => {
    const handle = await freshDatabase();
    await seedFilterFixture(handle);
    const filtered = (filters: Partial<InboxFilters>) =>
      listNumbers(handle, { filters: { ...DEFAULT_FILTERS, ...filters } });

    expect(await filtered({ repoIds: [REPO_A] })).toEqual([1, 2]);
    expect(
      await filtered({ reviewStates: [InboxReviewStates.REVIEWED] }),
    ).toEqual([6]);
    expect(await filtered({ author: InboxAuthorFilters.MINE })).toEqual([5]);
    expect(await filtered({ author: InboxAuthorFilters.OTHERS })).toEqual([
      1, 6, 2,
    ]);
    expect(await filtered({ installationIds: [OCTO] })).toEqual([6, 5]);
  });

  it("counts open rows that are not drafts, whatever the filters", async () => {
    const handle = await freshDatabase();
    await seedFilterFixture(handle);

    const page = await createInboxStore(handle).list(
      makeListInput({ filters: { ...DEFAULT_FILTERS, repoIds: [REPO_A] } }),
    );

    expect(page.total).toBe(2);
    expect(page.counts).toEqual({
      new: 1,
      inProgress: 0,
      reviewed: 1,
      updated: 0,
    });
  });

  it("names every viewable repository once, whatever the filters", async () => {
    const handle = await freshDatabase();
    await seedFilterFixture(handle);

    const page = await createInboxStore(handle).list(
      makeListInput({ filters: { ...DEFAULT_FILTERS, repoIds: [REPO_A] } }),
    );

    expect(page.repositories).toEqual([
      { repoId: REPO_A, repoSlug: `org/repo-${REPO_A}` },
      { repoId: REPO_B, repoSlug: `org/repo-${REPO_B}` },
    ]);
  });

  it("a repository named by one row and not another keeps its name", async () => {
    const handle = await freshDatabase();
    await seedFilterFixture(handle);
    await createTenantRepository(handle, CTX_ACME).pullRequests.upsert({
      repoId: REPO_A,
      prNumber: 99,
      title: "PR 99",
      state: PrStates.OPEN,
    });

    const page = await createInboxStore(handle).list(makeListInput());

    expect(
      page.repositories.find((repository) => repository.repoId === REPO_A),
    ).toEqual({ repoId: REPO_A, repoSlug: `org/repo-${REPO_A}` });
  });
});

describe("createInboxStore.list, pages", () => {
  it("refuses a page or page size that is not a whole number of at least 1", async () => {
    const handle = await freshDatabase();
    const store = createInboxStore(handle);

    await expect(store.list(makeListInput({ page: 0 }))).rejects.toThrow(
      "whole pages",
    );
    await expect(store.list(makeListInput({ page: 1.5 }))).rejects.toThrow(
      "whole pages",
    );
    await expect(store.list(makeListInput({ pageSize: 0 }))).rejects.toThrow(
      "whole pages",
    );
  });

  it("narrowing to an installation keeps the viewer's own url rows", async () => {
    const handle = await freshDatabase();
    await seedRow(handle, { ctx: CTX_ACME, repoId: REPO_A, prNumber: 1 });
    await seedRow(handle, { ctx: CTX_OCTO, repoId: REPO_B, prNumber: 2 });
    await seedRow(handle, { ctx: CTX_OWNER, repoId: REPO_B, prNumber: 3 });

    expect(
      await listNumbers(handle, {
        filters: { ...DEFAULT_FILTERS, installationIds: [ACME] },
      }),
    ).toEqual([3, 1]);
  });

  it("a page past the end is empty and carries the true total", async () => {
    const handle = await freshDatabase();
    for (const prNumber of [1, 2, 3]) {
      await seedRow(handle, { ctx: CTX_ACME, repoId: REPO_A, prNumber });
    }

    const second = await createInboxStore(handle).list(
      makeListInput({ page: 2, pageSize: 2 }),
    );
    const past = await createInboxStore(handle).list(
      makeListInput({ page: 5, pageSize: 2 }),
    );

    expect(second.items.map((item) => item.pullRequest.prNumber)).toEqual([1]);
    expect(second.total).toBe(3);
    expect(past.items).toEqual([]);
    expect(past.total).toBe(3);
    expect(past.page).toBe(5);
  });
});

const SORTS: readonly InboxSort[] = Object.values(InboxSorts);
describe("createInboxStore.list, an empty reach", () => {
  it.each(SORTS)("lists only the viewer's url rows under %s", async (sort) => {
    const handle = await freshDatabase();
    await seedRow(handle, { ctx: CTX_ACME, repoId: REPO_A, prNumber: 1 });
    await seedRow(handle, { ctx: CTX_OWNER, repoId: REPO_B, prNumber: 2 });

    expect(await listNumbers(handle, { installationIds: [], sort })).toEqual([
      2,
    ]);
  });
});
