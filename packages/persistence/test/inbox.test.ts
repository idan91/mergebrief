// The Inbox list over a two-installation fixture plus the viewer's own url
// rows: every review state, the fold under both sorts, the shadowed url
// row, each filter, and a page past the end.
import { sql } from "drizzle-orm";
import {
  InboxArchivedFilters,
  InboxAuthorFilters,
  InboxGenerationFilters,
  InboxReviewStates,
  InboxSorts,
  InboxStatuses,
  type InboxReviewState,
  type InboxSort,
  InboxLayouts,
  InboxSortDirections,
} from "types/inbox";
import { GenerationStatuses, type GenerationStatus, type Mutable } from "types";
import { describe, expect, it } from "vitest";
import {
  createArtifactStore,
  createInboxStore,
  createTenantRepository,
  isOwnerContext,
  type AppDatabase,
  type InboxFilters,
  type InboxListInput,
  type PullRequestLifecycle,
  type PullRequestUpsertInput,
  type ScopeContext,
} from "../src/index";
import { internal } from "../src/db/handle";
import { brief } from "../src/schema/brief";
import { generation } from "../src/schema/generation";
import { reviewSubmittedReview } from "../src/schema/review-submitted-review";
import {
  GenerationKinds,
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
import {
  DEFAULT_INBOX_FILTERS,
  brandWith,
  makeInboxListInput,
  registerSharedPglite,
  type InboxReach,
} from "./helpers";
import { STORED_BODY_VERSION } from "brief-core/artifact";

const shared = registerSharedPglite();

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
const EARLIER = new Date("2026-09-01T00:00:00Z");
const LATER = new Date("2026-09-02T00:00:00Z");

interface SeedRow {
  readonly ctx: ScopeContext;
  readonly repoId: RepoId;
  readonly prNumber: number;
  readonly author?: string;
  readonly draft?: boolean;
  readonly lifecycle?: PullRequestLifecycle;
  readonly updatedAt?: Date;
  readonly createdAt?: Date;
  readonly githubHeadSha?: string;
}

async function seedRow(
  handle: AppDatabase,
  seed: SeedRow,
): Promise<PullRequestRowId> {
  const lifecycle: PullRequestLifecycle = seed.lifecycle ?? {
    state: PrStates.OPEN,
  };
  const input: Mutable<PullRequestUpsertInput> = {
    repoId: seed.repoId,
    prNumber: seed.prNumber,
    repoSlug: `org/repo-${seed.repoId}`,
    title: `PR ${seed.prNumber}`,
    authorLogin: seed.author ?? "someone",
    draft: seed.draft ?? false,
    githubUpdatedAt: seed.updatedAt ?? new Date("2026-09-01T00:00:00Z"),
    ...lifecycle,
  };
  if (seed.createdAt !== undefined) {
    input.githubCreatedAt = seed.createdAt;
  }
  const pullRequests = createTenantRepository(handle, seed.ctx).pullRequests;
  const row = await pullRequests.upsert(input);
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
    bodyVersion: STORED_BODY_VERSION,
    body: JSON.stringify({ changeGroups: [], chunks: [] }),
    usedGroupIds: [],
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

async function seedCheckpoint(
  handle: AppDatabase,
  ctx: ScopeContext,
  pullRequestId: PullRequestRowId,
  reviewerId: ReviewerId,
  lastSubmittedSha: string,
  submittedAt = EARLIER,
): Promise<void> {
  await createTenantRepository(handle, ctx).checkpoints.upsertOnSubmit({
    pullRequestId,
    reviewerId,
    reviewerLogin: "reviewer",
    lastSubmittedSha,
    submittedAt,
  });
}

async function stampSubmittedReviews(
  handle: AppDatabase,
  createdAt: Date,
): Promise<void> {
  await internal(handle).update(reviewSubmittedReview).set({ createdAt });
}

const HELD_CONDITIONS = JSON.stringify([
  { kind: "ready-for-review", source: "instance" },
]);

/** One brief-kind projection row; a later trigger time makes it the head the row shows. */
async function seedGeneration(
  handle: AppDatabase,
  ctx: ScopeContext,
  pullRequestId: PullRequestRowId,
  headSha: string,
  status: GenerationStatus,
  triggeredAt = EARLIER,
): Promise<void> {
  const held = status === GenerationStatuses.HELD;
  await internal(handle)
    .insert(generation)
    .values({
      installationId: isOwnerContext(ctx) ? null : ctx.installationId,
      pullRequestId,
      kind: GenerationKinds.BRIEF,
      headSha,
      baselineSha: null,
      status,
      unmetConditions: held ? HELD_CONDITIONS : null,
      triggeredAt,
    });
}

const DEFAULT_FILTERS = DEFAULT_INBOX_FILTERS;
const ARCHIVED_ONLY: InboxFilters = {
  ...DEFAULT_FILTERS,
  archived: InboxArchivedFilters.ONLY,
};

const HELD_ONLY: InboxFilters = {
  ...DEFAULT_FILTERS,
  generation: InboxGenerationFilters.HELD,
};

const REACH: InboxReach = {
  installationIds: [ACME, OCTO],
  allowedRepoIds: [REPO_A, REPO_B],
  ownerUserId: VIEWER,
  reviewerId: VIEWER,
};

function makeListInput(overrides?: Partial<InboxListInput>): InboxListInput {
  return makeInboxListInput(REACH, {
    reviewerLogin: VIEWER_LOGIN,
    ...overrides,
  });
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
    const handle = shared.handle;
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
    await seedBrief(handle, CTX_ACME, done, "h3");
    await seedCheckpoint(handle, CTX_ACME, done, VIEWER, "h3");
    const moved = await seedRow(handle, {
      ctx: CTX_OCTO,
      repoId: REPO_B,
      prNumber: 4,
    });
    await seedBrief(
      handle,
      CTX_OCTO,
      moved,
      "h4a",
      new Date("2026-08-01T00:00:00Z"),
    );
    await seedCheckpoint(handle, CTX_OCTO, moved, VIEWER, "h4a");
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
    await seedBrief(handle, CTX_OCTO, someoneElse, "h6");
    await seedCheckpoint(handle, CTX_OCTO, someoneElse, OTHER, "h6");
    await seedRow(handle, { ctx: CTX_ACME, repoId: REPO_A, prNumber: 7 });
    const reviewedTwice = await seedRow(handle, {
      ctx: CTX_OCTO,
      repoId: REPO_B,
      prNumber: 8,
    });
    await seedBrief(
      handle,
      CTX_OCTO,
      reviewedTwice,
      "h8a",
      new Date("2026-08-01T00:00:00Z"),
    );
    await seedBrief(
      handle,
      CTX_OCTO,
      reviewedTwice,
      "h8b",
      new Date("2026-08-02T00:00:00Z"),
    );
    await seedCheckpoint(handle, CTX_OCTO, reviewedTwice, VIEWER, "h8b");
    const movedAndBegun = await seedRow(handle, {
      ctx: CTX_OCTO,
      repoId: REPO_B,
      prNumber: 9,
    });
    await seedBrief(
      handle,
      CTX_OCTO,
      movedAndBegun,
      "h9a",
      new Date("2026-08-01T00:00:00Z"),
    );
    await seedCheckpoint(handle, CTX_OCTO, movedAndBegun, VIEWER, "h9a");
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
    const pasted = await seedRow(handle, {
      ctx: CTX_OWNER,
      repoId: REPO_A,
      prNumber: 10,
    });
    await openSession(
      handle,
      CTX_OWNER,
      await seedBrief(handle, CTX_OWNER, pasted, "h10"),
      VIEWER,
      true,
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
    expect(stateOf(10)).toBe(InboxReviewStates.REVIEWED);
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
      reviewed: 3,
      updated: 2,
    });
    expect(page.total).toBe(10);
  });

  it("marks a row behind when GitHub reports a head past the brief", async () => {
    const handle = shared.handle;
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

describe("createInboxStore.list, the checkpoint", () => {
  async function readState(
    handle: AppDatabase,
  ): Promise<InboxReviewState | null | undefined> {
    const page = await createInboxStore(handle).list(makeListInput());
    return page.items[0]?.reviewState;
  }

  it("reads reviewed from a checkpoint at the latest brief head", async () => {
    const handle = shared.handle;
    const prId = await seedRow(handle, {
      ctx: CTX_ACME,
      repoId: REPO_A,
      prNumber: 1,
    });
    await seedBrief(handle, CTX_ACME, prId, "h1");
    await seedCheckpoint(handle, CTX_ACME, prId, VIEWER, "h1");

    expect(await readState(handle)).toBe(InboxReviewStates.REVIEWED);
  });

  it("reads updated from a checkpoint at an older head", async () => {
    const handle = shared.handle;
    const prId = await seedRow(handle, {
      ctx: CTX_ACME,
      repoId: REPO_A,
      prNumber: 1,
    });
    await seedBrief(handle, CTX_ACME, prId, "h1");
    await seedBrief(handle, CTX_ACME, prId, "h2");
    await seedCheckpoint(handle, CTX_ACME, prId, VIEWER, "h1");

    expect(await readState(handle)).toBe(InboxReviewStates.UPDATED);
  });

  it("counts a review submitted on GitHub as reviewed", async () => {
    const handle = shared.handle;
    const prId = await seedRow(handle, {
      ctx: CTX_ACME,
      repoId: REPO_A,
      prNumber: 1,
      githubHeadSha: "h1",
    });
    await seedCheckpoint(handle, CTX_ACME, prId, VIEWER, "h1");

    const page = await createInboxStore(handle).list(makeListInput());

    expect(page.items[0]?.reviewState).toBe(InboxReviewStates.REVIEWED);
    expect(page.counts.reviewed).toBe(1);
  });

  it("a checkpoint past the latest brief head reads reviewed", async () => {
    const handle = shared.handle;
    const prId = await seedRow(handle, {
      ctx: CTX_ACME,
      repoId: REPO_A,
      prNumber: 1,
      githubHeadSha: "h2",
    });
    await seedBrief(handle, CTX_ACME, prId, "h1");
    await seedCheckpoint(handle, CTX_ACME, prId, VIEWER, "h2");

    expect(await readState(handle)).toBe(InboxReviewStates.REVIEWED);
  });

  it("reads reviewed from a submit before its checkpoint lands", async () => {
    const handle = shared.handle;
    const prId = await seedRow(handle, {
      ctx: CTX_ACME,
      repoId: REPO_A,
      prNumber: 1,
    });
    const briefId = await seedBrief(handle, CTX_ACME, prId, "h1");
    await openSession(handle, CTX_ACME, briefId, VIEWER, true);

    expect(await readState(handle)).toBe(InboxReviewStates.REVIEWED);
  });

  async function seedSubmitAndCheckpoint(
    handle: AppDatabase,
    submittedAt: Date,
    checkpointAt: Date,
  ): Promise<void> {
    const prId = await seedRow(handle, {
      ctx: CTX_ACME,
      repoId: REPO_A,
      prNumber: 1,
    });
    await seedBrief(handle, CTX_ACME, prId, "h1");
    const latest = await seedBrief(handle, CTX_ACME, prId, "h2");
    await openSession(handle, CTX_ACME, latest, VIEWER, true);
    await stampSubmittedReviews(handle, submittedAt);
    await seedCheckpoint(handle, CTX_ACME, prId, VIEWER, "h1", checkpointAt);
  }

  it("a submit newer than an older checkpoint reads reviewed", async () => {
    const handle = shared.handle;
    await seedSubmitAndCheckpoint(handle, LATER, EARLIER);

    const page = await createInboxStore(handle).list(makeListInput());

    expect(page.items[0]?.reviewState).toBe(InboxReviewStates.REVIEWED);
    expect(page.counts.reviewed).toBe(1);
    expect(page.counts.updated).toBe(0);
  });

  it("a checkpoint newer than the submit reads from the checkpoint", async () => {
    const handle = shared.handle;
    await seedSubmitAndCheckpoint(handle, EARLIER, LATER);

    expect(await readState(handle)).toBe(InboxReviewStates.UPDATED);
  });

  it("a checkpoint at the submit's time wins the tie", async () => {
    const handle = shared.handle;
    await seedSubmitAndCheckpoint(handle, EARLIER, EARLIER);

    expect(await readState(handle)).toBe(InboxReviewStates.UPDATED);
  });
});

describe("createInboxStore.list, the latest brief", () => {
  it("is the newest head even when an older head was written last", async () => {
    const handle = shared.handle;
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
    const handle = shared.handle;
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
    const handle = shared.handle;
    await seedFoldFixture(handle);

    expect(await listNumbers(handle, { sort: InboxSorts.UPDATED })).toEqual([
      4, 3, 2, 1,
    ]);
  });

  it("the mixed layout is one list in the sort's order", async () => {
    const handle = shared.handle;
    await seedFoldFixture(handle);

    expect(
      await listNumbers(handle, {
        sort: InboxSorts.UPDATED,
        layout: InboxLayouts.MIXED,
      }),
    ).toEqual([1, 4, 3, 2]);
  });

  it("keeps the fold under the generated sort", async () => {
    const handle = shared.handle;
    await seedFoldFixture(handle);

    expect(await listNumbers(handle, { sort: InboxSorts.GENERATED })).toEqual([
      2, 4, 3, 1,
    ]);
  });

  it("a draft or a merged row sits below the fold whatever its state", async () => {
    const handle = shared.handle;
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

describe("createInboxStore.list, the created sort and the direction", () => {
  const makeSeptemberDay = (dayOfMonth: number): Date =>
    new Date(`2026-09-${String(dayOfMonth).padStart(2, "0")}T00:00:00Z`);
  const MIXED_BY_CREATED: Partial<InboxListInput> = {
    sort: InboxSorts.CREATED,
    layout: InboxLayouts.MIXED,
  };

  /** Created 1 newest, then 3, then 2; 4 has no creation time. Updated 2 newest, then 4, 3, 1. */
  async function seedCreatedFixture(handle: AppDatabase): Promise<void> {
    const rows = [
      {
        prNumber: 1,
        createdAt: makeSeptemberDay(3),
        updatedAt: makeSeptemberDay(1),
      },
      {
        prNumber: 2,
        createdAt: makeSeptemberDay(1),
        updatedAt: makeSeptemberDay(9),
      },
      {
        prNumber: 3,
        createdAt: makeSeptemberDay(2),
        updatedAt: makeSeptemberDay(5),
      },
      { prNumber: 4, updatedAt: makeSeptemberDay(7) },
    ];
    for (const row of rows) {
      await seedRow(handle, { ctx: CTX_ACME, repoId: REPO_A, ...row });
    }
  }

  it("lists the newest created pull request first", async () => {
    const handle = shared.handle;
    await seedCreatedFixture(handle);

    expect(await listNumbers(handle, MIXED_BY_CREATED)).toEqual([1, 3, 2, 4]);
  });

  it("ascending lists the oldest created first, the unknown still last", async () => {
    const handle = shared.handle;
    await seedCreatedFixture(handle);

    expect(
      await listNumbers(handle, {
        ...MIXED_BY_CREATED,
        direction: InboxSortDirections.ASCENDING,
      }),
    ).toEqual([2, 3, 1, 4]);
  });

  it("the direction turns the update sort too", async () => {
    const handle = shared.handle;
    await seedCreatedFixture(handle);

    expect(
      await listNumbers(handle, {
        sort: InboxSorts.UPDATED,
        layout: InboxLayouts.MIXED,
        direction: InboxSortDirections.ASCENDING,
      }),
    ).toEqual([1, 3, 4, 2]);
  });

  it("the fold stays first whichever way the sort runs", async () => {
    const handle = shared.handle;
    const reviewed = await seedRow(handle, {
      ctx: CTX_ACME,
      repoId: REPO_A,
      prNumber: 1,
      createdAt: makeSeptemberDay(1),
    });
    const reviewedBrief = await seedBrief(handle, CTX_ACME, reviewed, "h1");
    await openSession(handle, CTX_ACME, reviewedBrief, VIEWER, true);
    for (const prNumber of [2, 3]) {
      const fresh = await seedRow(handle, {
        ctx: CTX_ACME,
        repoId: REPO_A,
        prNumber,
        createdAt: makeSeptemberDay(prNumber),
      });
      await seedBrief(handle, CTX_ACME, fresh, `h${prNumber}`);
    }

    const ascending = await listNumbers(handle, {
      sort: InboxSorts.CREATED,
      direction: InboxSortDirections.ASCENDING,
    });
    const descending = await listNumbers(handle, { sort: InboxSorts.CREATED });

    expect(ascending).toEqual([2, 3, 1]);
    expect(descending).toEqual([3, 2, 1]);
  });

  it("rows created at one instant page in a stable order", async () => {
    const handle = shared.handle;
    for (const prNumber of [1, 2, 3]) {
      await seedRow(handle, {
        ctx: CTX_ACME,
        repoId: REPO_A,
        prNumber,
        createdAt: makeSeptemberDay(1),
      });
    }
    const ascending: Partial<InboxListInput> = {
      ...MIXED_BY_CREATED,
      direction: InboxSortDirections.ASCENDING,
      pageSize: 2,
    };

    const first = await listNumbers(handle, { ...ascending, page: 1 });
    const second = await listNumbers(handle, { ...ascending, page: 2 });

    expect([...first, ...second]).toEqual([1, 2, 3]);
  });
});

describe("createInboxStore.list, visibility", () => {
  it("hides an installation row in a repository the viewer cannot read", async () => {
    const handle = shared.handle;
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
    const handle = shared.handle;
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
    const handle = shared.handle;
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
    const handle = shared.handle;
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
    const handle = shared.handle;
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
    const handle = shared.handle;
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
    const handle = shared.handle;
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
    const handle = shared.handle;
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
    const handle = shared.handle;
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
    const handle = shared.handle;
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
    await seedBrief(handle, CTX_OCTO, reviewed, "h6");
    await seedCheckpoint(handle, CTX_OCTO, reviewed, VIEWER, "h6");
  }

  it("a row with no author is nobody's own and shows under others", async () => {
    const handle = shared.handle;
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
    const handle = shared.handle;
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
    const handle = shared.handle;
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
    const handle = shared.handle;
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
    const handle = shared.handle;
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
    const handle = shared.handle;
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

describe("createInboxStore.list, held heads", () => {
  it("the held view lists only rows whose newest head is held", async () => {
    const handle = shared.handle;
    const held = await seedRow(handle, {
      ctx: CTX_ACME,
      repoId: REPO_A,
      prNumber: 1,
    });
    await seedGeneration(handle, CTX_ACME, held, "h1", GenerationStatuses.HELD);
    const done = await seedRow(handle, {
      ctx: CTX_ACME,
      repoId: REPO_A,
      prNumber: 2,
    });
    await seedGeneration(
      handle,
      CTX_ACME,
      done,
      "h2",
      GenerationStatuses.SUCCEEDED,
    );
    const moved = await seedRow(handle, {
      ctx: CTX_OCTO,
      repoId: REPO_B,
      prNumber: 3,
    });
    await seedGeneration(
      handle,
      CTX_OCTO,
      moved,
      "h3a",
      GenerationStatuses.HELD,
    );
    await seedGeneration(
      handle,
      CTX_OCTO,
      moved,
      "h3b",
      GenerationStatuses.PENDING,
      LATER,
    );
    const pasted = await seedRow(handle, {
      ctx: CTX_OWNER,
      repoId: REPO_B,
      prNumber: 4,
    });
    await seedGeneration(
      handle,
      CTX_OWNER,
      pasted,
      "h4",
      GenerationStatuses.HELD,
    );
    await seedRow(handle, { ctx: CTX_ACME, repoId: REPO_A, prNumber: 5 });
    const store = createInboxStore(handle);

    const inbox = await store.list(makeListInput());
    const view = await store.list(makeListInput({ filters: HELD_ONLY }));

    expect(inbox.total).toBe(5);
    expect(inbox.heldTotal).toBe(2);
    expect(view.items.map((item) => item.pullRequest.prNumber)).toEqual([4, 1]);
    expect(view.total).toBe(2);
    expect(view.heldTotal).toBe(2);
    expect(view.counts).toEqual(inbox.counts);
  });

  it("the held total follows the filters and skips a merged pull request", async () => {
    const handle = shared.handle;
    const open = await seedRow(handle, {
      ctx: CTX_ACME,
      repoId: REPO_A,
      prNumber: 1,
    });
    const merged = await seedRow(handle, {
      ctx: CTX_ACME,
      repoId: REPO_A,
      prNumber: 2,
      lifecycle: { state: PrStates.MERGED, closedAt: new Date() },
    });
    const archived = await seedRow(handle, {
      ctx: CTX_ACME,
      repoId: REPO_A,
      prNumber: 3,
    });
    for (const [prId, head] of [
      [open, "h1"],
      [merged, "h2"],
      [archived, "h3"],
    ] as const) {
      await seedGeneration(
        handle,
        CTX_ACME,
        prId,
        head,
        GenerationStatuses.HELD,
      );
    }
    await createTenantRepository(handle, CTX_ACME).archives.set(
      archived,
      VIEWER,
    );
    const store = createInboxStore(handle);
    const everyStatus: InboxFilters = {
      ...HELD_ONLY,
      statuses: Object.values(InboxStatuses),
    };

    const inbox = await store.list(makeListInput({ filters: HELD_ONLY }));
    const widened = await store.list(makeListInput({ filters: everyStatus }));
    const archive = await store.list(
      makeListInput({
        filters: { ...HELD_ONLY, archived: ARCHIVED_ONLY.archived },
      }),
    );

    expect(inbox.items.map((item) => item.pullRequest.prNumber)).toEqual([1]);
    expect(inbox.heldTotal).toBe(1);
    expect(widened.items.map((item) => item.pullRequest.prNumber)).toEqual([1]);
    expect(widened.heldTotal).toBe(1);
    expect(archive.items.map((item) => item.pullRequest.prNumber)).toEqual([3]);
    expect(archive.heldTotal).toBe(1);
  });

  it("never lists or counts a held row outside the viewer's reach", async () => {
    const handle = shared.handle;
    const unreadable = await seedRow(handle, {
      ctx: CTX_ACME,
      repoId: REPO_B,
      prNumber: 1,
    });
    await seedGeneration(
      handle,
      CTX_ACME,
      unreadable,
      "h1",
      GenerationStatuses.HELD,
    );
    const othersPaste = await seedRow(handle, {
      ctx: { ownerUserId: OTHER },
      repoId: REPO_A,
      prNumber: 2,
    });
    await seedGeneration(
      handle,
      { ownerUserId: OTHER },
      othersPaste,
      "h2",
      GenerationStatuses.HELD,
    );
    const store = createInboxStore(handle);
    const reach = { allowedRepoIds: [REPO_A] };

    const inbox = await store.list(makeListInput(reach));
    const view = await store.list(
      makeListInput({ ...reach, filters: HELD_ONLY }),
    );

    expect(inbox.heldTotal).toBe(0);
    expect(view.items).toEqual([]);
    expect(view.total).toBe(0);
  });
});

describe("createInboxStore.list, pages", () => {
  it("refuses a page or page size that is not a whole number of at least 1", async () => {
    const handle = shared.handle;
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
    const handle = shared.handle;
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
    const handle = shared.handle;
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
    const handle = shared.handle;
    await seedRow(handle, { ctx: CTX_ACME, repoId: REPO_A, prNumber: 1 });
    await seedRow(handle, { ctx: CTX_OWNER, repoId: REPO_B, prNumber: 2 });

    expect(await listNumbers(handle, { installationIds: [], sort })).toEqual([
      2,
    ]);
  });
});
