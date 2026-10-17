// Purge and retention tests over PGlite, proving the deletion boundary: a PR
// purge cascades the 7 child tables while sparing the no-FK audit ledger and
// auth_session, a cross-tenant purge deletes nothing, and the instance-wide
// retention sweep reads only the close time. Seeds go through a RAW drizzle
// handle over the same PGlite.
import { and, eq, sql } from "drizzle-orm";
import { type PgliteDatabase, drizzle } from "drizzle-orm/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { type AppDatabase, fromDrizzle } from "../src/db/handle";
import {
  apiToken,
  auditLog,
  authSession,
  brief,
  checkpoint,
  comparisonMarks,
  delta,
  disposition,
  generation,
  githubGrant,
  hunkSpan,
  pullRequest,
  reviewDraftComment,
  reviewGroupReclassification,
  reviewReadMark,
  reviewSession,
  reviewSubmittedReview,
  revisionNarrative,
} from "../src/schema/index";
import {
  createPurgeRoutines,
  sweepClosedPullRequests,
} from "../src/stores/purge";
import type { TenantContext } from "../src/stores/scope-context";
import {
  AuditOutcomes,
  GenerationKinds,
  isInstallationId,
  isRepoId,
  isReviewerId,
  type GrantRowId,
  type InstallationId,
  type PullRequestRowId,
  type RepoId,
  type ReviewerId,
} from "../src/types";
import {
  ChangeGroupCategories,
  DiffSides,
  DispositionDecisions,
  GenerationStatuses,
  type PrState,
  PrStates,
  PullRequestSources,
  AccessLevels,
} from "types";
import { brandWith, freshPglite } from "./helpers";

/** Seed one grant row so secret-bearing referents can link it. */
async function insertGrant(db: Db): Promise<GrantRowId> {
  const rows = await db
    .insert(githubGrant)
    .values({
      ghTokenCiphertext: "ct",
      ghRefreshTokenCiphertext: "rct",
      keyRef: "SESSION_KEY_V1",
      refreshExpiresAt: new Date("2027-01-01T00:00:00Z"),
    })
    .returning({ id: githubGrant.id });
  const row = rows[0];
  if (row === undefined) {
    throw new Error("grant insert returned no row");
  }
  return row.id;
}

type Db = PgliteDatabase;

interface Pair {
  readonly raw: Db;
  readonly handle: AppDatabase;
}

async function freshPair(): Promise<Pair> {
  const raw = drizzle(await freshPglite());
  return { raw, handle: fromDrizzle(raw) };
}

const TENANT_A: InstallationId = brandWith(isInstallationId, 1000n);
const TENANT_B: InstallationId = brandWith(isInstallationId, 2000n);
const REPO: RepoId = brandWith(isRepoId, 777n);
const REPO_OTHER: RepoId = brandWith(isRepoId, 888n);
const REVIEWER: ReviewerId = brandWith(isReviewerId, 31337n);
const CTX_A: TenantContext = { installationId: TENANT_A };

const BASE_SHA = "a".repeat(40);
const HEAD_SHA = "b".repeat(40);
const PREV_HEAD_SHA = "c".repeat(40);
const CHECKPOINT_SHA = "d".repeat(40);
const ORIGIN = {
  provider: "anthropic",
  model: "claude-fable-5",
  effort: "high",
} as const;

function artifact(body: string): {
  readonly body: string;
  readonly byteSize: number;
} {
  return { body, byteSize: Buffer.byteLength(body, "utf8") };
}

interface PrSeed {
  readonly installationId: InstallationId;
  readonly repoId?: RepoId;
  readonly prNumber?: number;
  readonly state?: PrState;
  readonly closedAt?: Date;
}

async function insertPr(db: Db, seed: PrSeed): Promise<PullRequestRowId> {
  // Lifecycle-consistent defaults: a seed with a close time is a closed PR
  // (the open-retention-shape CHECK forbids open with a close time).
  const closed = seed.closedAt !== undefined;
  const rows = await db
    .insert(pullRequest)
    .values({
      installationId: seed.installationId,
      repoId: seed.repoId ?? REPO,
      prNumber: seed.prNumber ?? 7,
      repoSlug: "acme/widgets",
      state: seed.state ?? (closed ? PrStates.CLOSED : PrStates.OPEN),
      closedAt: seed.closedAt,
    })
    .returning({ id: pullRequest.id });
  const row = rows[0];
  if (row === undefined) {
    throw new Error("pull_request insert returned no row");
  }
  return row.id;
}

/** One row in every per-PR child table + the two non-PR tables, for a tenant. */
async function seedFullGraph(
  db: Db,
  installationId: InstallationId,
  pullRequestId: PullRequestRowId,
): Promise<void> {
  const briefRows = await db
    .insert(brief)
    .values({
      installationId,
      pullRequestId,
      baseSha: BASE_SHA,
      headSha: HEAD_SHA,
      headIndex: 1,
      commitCount: 3,
      ...ORIGIN,
      ...artifact('{"brief":true}'),
      usedGroupIds: [],
    })
    .returning({ id: brief.id });
  const briefRow = briefRows[0];
  if (briefRow === undefined) {
    throw new Error("brief insert returned no row");
  }

  const sessionRows = await db
    .insert(reviewSession)
    .values({ installationId, briefId: briefRow.id, reviewerId: REVIEWER })
    .returning({ id: reviewSession.id });
  const sessionRow = sessionRows[0];
  if (sessionRow === undefined) {
    throw new Error("review_session insert returned no row");
  }
  const reviewSessionId = sessionRow.id;
  await db.insert(reviewDraftComment).values({
    installationId,
    reviewSessionId,
    filePath: "src/index.ts",
    side: DiffSides.NEW,
    startLine: 10,
    endLine: 12,
    body: "free-text reviewer content",
  });
  await db.insert(reviewReadMark).values({
    installationId,
    reviewSessionId,
    chunkId: "chunk-1",
  });
  await db.insert(reviewGroupReclassification).values({
    installationId,
    reviewSessionId,
    changeGroupId: "group-1",
    category: ChangeGroupCategories.BUGFIX,
  });
  await db.insert(reviewSubmittedReview).values({
    installationId,
    reviewSessionId,
    githubReviewId: 909n,
  });
  await db.insert(disposition).values({
    installationId,
    reviewSessionId,
    filePath: "src/index.ts",
    attribute: "sql-injection",
    regionStart: 10,
    regionEnd: 20,
    decision: DispositionDecisions.DISMISSED,
    reason: "false positive",
    decidedAt: new Date(),
  });

  await db.insert(delta).values({
    installationId,
    pullRequestId,
    baselineSha: CHECKPOINT_SHA,
    headSha: HEAD_SHA,
    ...ORIGIN,
    ...artifact('{"delta":true}'),
  });
  await db.insert(revisionNarrative).values({
    installationId,
    pullRequestId,
    briefId: briefRow.id,
    prevHeadSha: PREV_HEAD_SHA,
    headSha: HEAD_SHA,
    ...ORIGIN,
    ...artifact('{"narrative":true}'),
  });
  await db.insert(comparisonMarks).values({
    installationId,
    pullRequestId,
    baselineSha: PREV_HEAD_SHA,
    headSha: HEAD_SHA,
    ...artifact('{"files":[]}'),
  });
  await db.insert(checkpoint).values({
    installationId,
    pullRequestId,
    reviewerId: REVIEWER,
    reviewerLogin: "octocat",
    lastSubmittedSha: CHECKPOINT_SHA,
    submittedAt: new Date(),
  });
  await db.insert(hunkSpan).values({
    installationId,
    pullRequestId,
    baselineSha: PREV_HEAD_SHA,
    headSha: HEAD_SHA,
    spans: "[]",
  });
  await db.insert(generation).values({
    installationId,
    pullRequestId,
    kind: GenerationKinds.BRIEF,
    headSha: HEAD_SHA,
    baselineSha: null,
    status: GenerationStatuses.SUCCEEDED,
  });
  // A pre-existing (non-delete) audit row, proves audit_log is retained.
  await db.insert(auditLog).values({
    installationId,
    actorType: "app",
    operation: "generate",
    outcome: AuditOutcomes.OK,
    targetType: "pull_request",
    targetId: pullRequestId,
    metadata: { kind: "brief" },
  });
  // The one non-PR table, must survive a PR-scoped purge.
  await db.insert(authSession).values({
    sessionTokenHash: `sha256:${installationId}:${pullRequestId}`,
    reviewerId: REVIEWER,
    reviewerLogin: "octocat",
    grantId: await insertGrant(db),
    expiresAt: new Date(Date.now() + 3_600_000),
  });
}

async function countChildTables(
  db: Db,
  pullRequestId: PullRequestRowId,
): Promise<number> {
  const tables = [brief, delta, revisionNarrative, comparisonMarks, hunkSpan];
  let total = 0;
  for (const table of tables) {
    const rows = await db
      .select({ id: table.id })
      .from(table)
      .where(eq(table.pullRequestId, pullRequestId));
    total += rows.length;
  }
  for (const table of [checkpoint, generation]) {
    const rows = await db
      .select({ id: table.id })
      .from(table)
      .where(eq(table.pullRequestId, pullRequestId));
    total += rows.length;
  }
  return total;
}

/**
 * The Review Session graph, which hangs off `brief` rather than off
 * `pull_request`, so the PR cascade only reaches it through two hops.
 * `review_draft_comment` is the only new table holding free-text content.
 */
async function countSessionTables(
  db: Db,
  installationId: InstallationId,
): Promise<number> {
  const tables = [
    reviewSession,
    reviewDraftComment,
    reviewReadMark,
    reviewGroupReclassification,
    reviewSubmittedReview,
    disposition,
  ];
  const counts = await Promise.all(
    tables.map(
      async (table) =>
        (
          await db
            .select({ id: table.id })
            .from(table)
            .where(eq(table.installationId, installationId))
        ).length,
    ),
  );
  return counts.reduce((total, count) => total + count, 0);
}

async function deleteAudits(db: Db, installationId: InstallationId) {
  return db
    .select({
      id: auditLog.id,
      targetType: auditLog.targetType,
      targetId: auditLog.targetId,
    })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.installationId, installationId),
        eq(auditLog.operation, "delete"),
      ),
    );
}

describe("createPurgeRoutines.purgePullRequest, cascade + no-FK audit survival", () => {
  let pair: Pair;
  let prId: PullRequestRowId;

  beforeEach(async () => {
    pair = await freshPair();
    prId = await insertPr(pair.raw, { installationId: TENANT_A });
    await seedFullGraph(pair.raw, TENANT_A, prId);
  });

  it("erases the 7 per-PR child tables and spares audit_log and auth_session", async () => {
    expect(await countChildTables(pair.raw, prId)).toBe(7);
    expect(await countSessionTables(pair.raw, TENANT_A)).toBe(6);

    const result = await createPurgeRoutines(
      pair.handle,
      CTX_A,
    ).purgePullRequest(prId);
    expect(result).toBe(true);

    // Every per-PR child gone by FK cascade, including the Review Session
    // graph, which the cascade reaches through `brief`.
    expect(await countChildTables(pair.raw, prId)).toBe(0);
    expect(await countSessionTables(pair.raw, TENANT_A)).toBe(0);
    expect(
      await pair.raw.select({ id: pullRequest.id }).from(pullRequest),
    ).toHaveLength(0);

    // Survivors: the non-PR session and the whole audit ledger.
    expect(
      await pair.raw.select({ id: authSession.id }).from(authSession),
    ).toHaveLength(1);

    // The appended `delete` row EXISTS after the purge, proving audit_log has
    // no FK to the row it records (it outlives the cascade).
    const deletes = await deleteAudits(pair.raw, TENANT_A);
    expect(deletes).toHaveLength(1);
    expect(deletes[0]?.targetType).toBe("pull_request");
    expect(deletes[0]?.targetId).toBe(prId);
    // The pre-existing `generate` row is also retained (2 audit rows total).
    expect(
      await pair.raw.select({ id: auditLog.id }).from(auditLog),
    ).toHaveLength(2);
  });

  it("names the reviewer on the audit row when an actor is given", async () => {
    const actor = { reviewerId: brandWith(isReviewerId, 4242n) };

    const result = await createPurgeRoutines(
      pair.handle,
      CTX_A,
    ).purgePullRequest(prId, actor);
    expect(result).toBe(true);

    const rows = await pair.raw
      .select({ actorType: auditLog.actorType, actorId: auditLog.actorId })
      .from(auditLog)
      .where(eq(auditLog.operation, "delete"));
    expect(rows).toEqual([{ actorType: "reviewer", actorId: 4242n }]);
  });

  it("writes the app as the actor when no actor is given", async () => {
    await createPurgeRoutines(pair.handle, CTX_A).purgePullRequest(prId);

    const rows = await pair.raw
      .select({ actorType: auditLog.actorType, actorId: auditLog.actorId })
      .from(auditLog)
      .where(eq(auditLog.operation, "delete"));
    expect(rows).toEqual([{ actorType: "app", actorId: null }]);
  });

  it("refuses a cross-tenant PR and deletes nothing", async () => {
    // Tenant B calls purge on tenant A's PR.
    const result = await createPurgeRoutines(pair.handle, {
      installationId: TENANT_B,
    }).purgePullRequest(prId);
    expect(result).toBe(false);

    // Nothing deleted, and no spurious audit entry under either tenant.
    expect(await countChildTables(pair.raw, prId)).toBe(7);
    expect(
      await pair.raw.select({ id: pullRequest.id }).from(pullRequest),
    ).toHaveLength(1);
    expect(await deleteAudits(pair.raw, TENANT_A)).toHaveLength(0);
    expect(await deleteAudits(pair.raw, TENANT_B)).toHaveLength(0);
  });
});

describe("createPurgeRoutines.purgeRepos, set-based multi-repo purge", () => {
  it("purges every named repo in one tx with one audit entry per repo", async () => {
    const { raw, handle } = await freshPair();
    const a1 = await insertPr(raw, {
      installationId: TENANT_A,
      repoId: REPO,
      prNumber: 1,
    });
    const a2 = await insertPr(raw, {
      installationId: TENANT_A,
      repoId: REPO,
      prNumber: 2,
    });
    const other = await insertPr(raw, {
      installationId: TENANT_A,
      repoId: REPO_OTHER,
      prNumber: 3,
    });
    await seedFullGraph(raw, TENANT_A, a1);

    // REPO holds two PRs; a third repo (never seeded) still gets its own
    // count-0 audit entry.
    const emptyRepo: RepoId = brandWith(isRepoId, 999n);
    const count = await createPurgeRoutines(handle, CTX_A).purgeRepos([
      REPO,
      emptyRepo,
      REPO,
    ]);
    expect(count).toBe(2);

    // Only REPO_OTHER's PR survives; REPO's children cascaded.
    const remaining = await raw
      .select({ id: pullRequest.id })
      .from(pullRequest);
    expect(remaining.map((r) => r.id)).toEqual([other]);
    expect(await countChildTables(raw, a1)).toBe(0);
    void a2;

    // One delete audit per unique requested repo (REPO count 2, emptyRepo 0).
    const deletes = await deleteAudits(raw, TENANT_A);
    expect(deletes).toHaveLength(2);
    expect(deletes.every((d) => d.targetType === "repo")).toBe(true);
  });

  it("empty repo list is a no-op with no transaction and no audit", async () => {
    const { raw, handle } = await freshPair();
    const count = await createPurgeRoutines(handle, CTX_A).purgeRepos([]);
    expect(count).toBe(0);
    expect(await deleteAudits(raw, TENANT_A)).toHaveLength(0);
  });
});

describe("createPurgeRoutines.purgeInstallation, tenant-isolated offboarding", () => {
  it("removes tenant A's rows only, leaving tenant B and audit_log intact", async () => {
    const { raw, handle } = await freshPair();
    const aPr = await insertPr(raw, { installationId: TENANT_A, prNumber: 1 });
    const bPr = await insertPr(raw, { installationId: TENANT_B, prNumber: 1 });
    await seedFullGraph(raw, TENANT_A, aPr);
    await seedFullGraph(raw, TENANT_B, bPr);
    // Sessions and API tokens bind no installation and outlive the tenant.
    await raw.insert(apiToken).values({
      tokenHash: "e".repeat(64),
      userId: REVIEWER,
      name: "ci-token",
      scope: AccessLevels.EXTERNAL_WRITE,
      grantId: await insertGrant(raw),
      expiresAt: null,
    });

    const counts = await createPurgeRoutines(handle, CTX_A).purgeInstallation();
    expect(counts).toEqual({ pullRequests: 1 });

    const prs = await raw.select({ id: pullRequest.id }).from(pullRequest);
    expect(prs.map((r) => r.id)).toEqual([bPr]);
    const sessions = await raw.select({ id: authSession.id }).from(authSession);
    expect(sessions).toHaveLength(2);
    const tokens = await raw.select({ id: apiToken.id }).from(apiToken);
    expect(tokens).toHaveLength(1);
    // Both session grants and the token's grant remain.
    expect(
      await raw.select({ id: githubGrant.id }).from(githubGrant),
    ).toHaveLength(3);

    // Tenant B's child graph is intact; A's Review Session graph is gone.
    expect(await countChildTables(raw, bPr)).toBe(7);
    expect(await countSessionTables(raw, TENANT_A)).toBe(0);
    expect(await countSessionTables(raw, TENANT_B)).toBe(6);

    // audit_log retained: both pre-existing generate rows + the new A delete.
    expect(await raw.select({ id: auditLog.id }).from(auditLog)).toHaveLength(
      3,
    );
    const aDeletes = await deleteAudits(raw, TENANT_A);
    expect(aDeletes).toHaveLength(1);
    expect(aDeletes[0]?.targetType).toBe("installation");
    expect(aDeletes[0]?.targetId).toBe(TENANT_A);
    expect(await deleteAudits(raw, TENANT_B)).toHaveLength(0);
  });
});

const OWNER: ReviewerId = brandWith(isReviewerId, 501n);
const OTHER_OWNER: ReviewerId = brandWith(isReviewerId, 502n);
const SWEEP_NOW = new Date("2026-08-01T00:00:00Z");
const RETENTION_DAYS = 30;
/** Just past the window at `SWEEP_NOW`; `insideWindow` is just inside it. */
const PAST_WINDOW = new Date("2026-07-01T00:00:00Z");
const INSIDE_WINDOW = new Date("2026-07-03T00:00:00Z");
/** One more than a sweep batch, so the backlog takes two transactions. */
const BACKLOG = 501;

interface OwnerPrSeed {
  readonly ownerUserId: ReviewerId;
  readonly prNumber: number;
  readonly closedAt: Date;
}

async function insertOwnerPr(
  db: Db,
  seed: OwnerPrSeed,
): Promise<PullRequestRowId> {
  const rows = await db
    .insert(pullRequest)
    .values({
      installationId: null,
      ownerUserId: seed.ownerUserId,
      source: PullRequestSources.URL,
      repoId: REPO,
      prNumber: seed.prNumber,
      repoSlug: "acme/widgets",
      state: PrStates.MERGED,
      closedAt: seed.closedAt,
    })
    .returning({ id: pullRequest.id });
  const row = rows[0];
  if (row === undefined) {
    throw new Error("pull_request insert returned no row");
  }
  return row.id;
}

async function readPrNumbers(db: Db): Promise<number[]> {
  const rows = await db
    .select({ prNumber: pullRequest.prNumber })
    .from(pullRequest)
    .orderBy(pullRequest.prNumber);
  return rows.map((row) => row.prNumber);
}

async function readSweepAudits(db: Db) {
  return db
    .select({
      installationId: auditLog.installationId,
      source: auditLog.source,
      actorType: auditLog.actorType,
      actorId: auditLog.actorId,
      targetType: auditLog.targetType,
      targetId: auditLog.targetId,
      metadata: auditLog.metadata,
    })
    .from(auditLog)
    .where(eq(auditLog.operation, "delete"))
    .orderBy(auditLog.id);
}

describe("sweepClosedPullRequests, instance-wide retention", () => {
  it("deletes a pull request closed before the window with its children", async () => {
    const { raw, handle } = await freshPair();
    const swept = await insertPr(raw, {
      installationId: TENANT_A,
      prNumber: 1,
      closedAt: PAST_WINDOW,
    });
    await seedFullGraph(raw, TENANT_A, swept);
    expect(await countChildTables(raw, swept)).toBe(7);

    expect(
      await sweepClosedPullRequests(handle, RETENTION_DAYS, SWEEP_NOW),
    ).toBe(1);

    expect(await readPrNumbers(raw)).toEqual([]);
    expect(await countChildTables(raw, swept)).toBe(0);
    expect(await countSessionTables(raw, TENANT_A)).toBe(0);
    expect(
      await raw.select({ id: authSession.id }).from(authSession),
    ).toHaveLength(1);
  });

  it("keeps an open row, a row inside the window, and sweeps a merged one", async () => {
    const { raw, handle } = await freshPair();
    await insertPr(raw, { installationId: TENANT_A, prNumber: 1 });
    await insertPr(raw, {
      installationId: TENANT_A,
      prNumber: 2,
      closedAt: INSIDE_WINDOW,
    });
    await insertPr(raw, {
      installationId: TENANT_A,
      prNumber: 3,
      state: PrStates.MERGED,
      closedAt: PAST_WINDOW,
    });

    expect(
      await sweepClosedPullRequests(handle, RETENTION_DAYS, SWEEP_NOW),
    ).toBe(1);

    expect(await readPrNumbers(raw)).toEqual([1, 2]);
  });

  it("sweeps url-box owner rows past the window too", async () => {
    const { raw, handle } = await freshPair();
    await insertOwnerPr(raw, {
      ownerUserId: OWNER,
      prNumber: 1,
      closedAt: PAST_WINDOW,
    });
    await insertOwnerPr(raw, {
      ownerUserId: OWNER,
      prNumber: 2,
      closedAt: INSIDE_WINDOW,
    });

    expect(
      await sweepClosedPullRequests(handle, RETENTION_DAYS, SWEEP_NOW),
    ).toBe(1);

    expect(await readPrNumbers(raw)).toEqual([2]);
  });

  it("records one system delete entry per installation and per owner swept", async () => {
    const { raw, handle } = await freshPair();
    await insertPr(raw, {
      installationId: TENANT_A,
      prNumber: 1,
      closedAt: PAST_WINDOW,
    });
    await insertPr(raw, {
      installationId: TENANT_A,
      prNumber: 2,
      closedAt: PAST_WINDOW,
    });
    await insertPr(raw, {
      installationId: TENANT_B,
      prNumber: 3,
      closedAt: PAST_WINDOW,
    });
    await insertPr(raw, {
      installationId: TENANT_B,
      prNumber: 4,
      closedAt: INSIDE_WINDOW,
    });
    await insertOwnerPr(raw, {
      ownerUserId: OWNER,
      prNumber: 5,
      closedAt: PAST_WINDOW,
    });
    await insertOwnerPr(raw, {
      ownerUserId: OTHER_OWNER,
      prNumber: 6,
      closedAt: PAST_WINDOW,
    });
    await insertOwnerPr(raw, {
      ownerUserId: OTHER_OWNER,
      prNumber: 7,
      closedAt: PAST_WINDOW,
    });

    expect(
      await sweepClosedPullRequests(handle, RETENTION_DAYS, SWEEP_NOW),
    ).toBe(6);

    const audits = await readSweepAudits(raw);
    expect(audits).toHaveLength(4);
    for (const entry of audits) {
      expect(entry).toMatchObject({
        actorType: "system",
        actorId: null,
        targetType: "pull_request",
        targetId: null,
      });
    }
    const byScope = audits.map((entry) => [
      entry.source,
      entry.installationId,
      entry.metadata,
    ]);
    expect(byScope).toEqual(
      expect.arrayContaining([
        [PullRequestSources.INSTALLATION, TENANT_A, { count: 2 }],
        [PullRequestSources.INSTALLATION, TENANT_B, { count: 1 }],
        [PullRequestSources.URL, null, { count: 1 }],
        [PullRequestSources.URL, null, { count: 2 }],
      ]),
    );
  });

  it("writes no audit entry when nothing is past the window", async () => {
    const { raw, handle } = await freshPair();
    await insertPr(raw, {
      installationId: TENANT_A,
      prNumber: 1,
      closedAt: INSIDE_WINDOW,
    });

    expect(
      await sweepClosedPullRequests(handle, RETENTION_DAYS, SWEEP_NOW),
    ).toBe(0);

    expect(await readSweepAudits(raw)).toHaveLength(0);
    expect(await readPrNumbers(raw)).toEqual([1]);
  });

  it("deletes nothing when retention is unset", async () => {
    const { raw, handle } = await freshPair();
    await insertPr(raw, {
      installationId: TENANT_A,
      prNumber: 1,
      closedAt: new Date("2020-01-01T00:00:00Z"),
    });

    expect(await sweepClosedPullRequests(handle, null, SWEEP_NOW)).toBe(0);

    expect(await readPrNumbers(raw)).toEqual([1]);
    expect(await readSweepAudits(raw)).toHaveLength(0);
  });

  it("refuses a window under the floor without deleting", async () => {
    const { raw, handle } = await freshPair();
    await insertPr(raw, {
      installationId: TENANT_A,
      prNumber: 1,
      closedAt: new Date("2020-01-01T00:00:00Z"),
    });

    await expect(sweepClosedPullRequests(handle, 0, SWEEP_NOW)).rejects.toThrow(
      /at least 1/,
    );
    await expect(
      sweepClosedPullRequests(handle, 1.5, SWEEP_NOW),
    ).rejects.toThrow(/whole number/);

    expect(await readPrNumbers(raw)).toEqual([1]);
  });

  it("sweeps a backlog larger than one batch in a single call", async () => {
    const { raw, handle } = await freshPair();
    await raw.execute(
      sql`insert into pull_request (installation_id, repo_id, pr_number, state, closed_at)
          select ${TENANT_A}, ${REPO}, n, 'closed', ${PAST_WINDOW}
          from generate_series(1, ${BACKLOG}) as n`,
    );

    expect(
      await sweepClosedPullRequests(handle, RETENTION_DAYS, SWEEP_NOW),
    ).toBe(BACKLOG);

    expect(await readPrNumbers(raw)).toEqual([]);
    const audits = await readSweepAudits(raw);
    const counted = audits.reduce((total, entry) => {
      const count = entry.metadata;
      const isCount =
        typeof count === "object" && count !== null && "count" in count;
      return (
        total + (isCount && typeof count.count === "number" ? count.count : 0)
      );
    }, 0);
    expect(counted).toBe(BACKLOG);
  });
});
