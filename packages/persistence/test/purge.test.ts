// Purge + retention tests (PGlite). Prove the deletion boundary: a PR purge
// cascades all 8 per-PR child tables while sparing the no-FK audit ledger
// (an appended `delete` row proves survival) and the non-PR auth_session;
// cross-tenant purge is a Result `notFound` with nothing deleted;
// installation purge is tenant-isolated with audit_log retained; the retention
// sweep removes only expired, non-null, in-tenant rows; `setRetention(null)`
// makes a PR unsweepable; and the session TTL sweep respects the tenant and
// emits NO audit entry.
//
// Seeds via a RAW drizzle handle (so tables with no store — e.g. disposition —
// can be populated) over the SAME PGlite the ctx-bound `purgeRoutines` runs on
// (`fromDrizzle` wraps it as the opaque handle).
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
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
  diffSnapshot,
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
import * as schema from "../src/schema/index";
import { PurgeErrorCode, purgeRoutines } from "../src/stores/purge";
import type { TenantContext } from "../src/stores/tenant";
import {
  AuditOutcome,
  DispositionDecision,
  ChangeGroupCategory,
  DraftCommentSide,
  GenerationKind,
  GenerationStatus,
  isInstallationId,
  isRepoId,
  isReviewerId,
  PrState,
  WriteClassification,
  type GrantRowId,
  type InstallationId,
  type PullRequestRowId,
  type RepoId,
  type ReviewerId,
} from "../src/types";
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
  if (row === undefined) throw new Error("grant insert returned no row");
  return row.id;
}

type Db = ReturnType<typeof drizzle<typeof schema>>;

interface Pair {
  readonly raw: Db;
  readonly handle: AppDatabase;
}

async function freshPair(): Promise<Pair> {
  const raw = drizzle(await freshPglite(), { schema });
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

/** Ascending bigint comparator — `Array#sort`'s default coerces to string. */
function bigIntAsc(a: bigint, b: bigint): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

interface PrSeed {
  readonly installationId: InstallationId;
  readonly repoId?: RepoId;
  readonly prNumber?: number;
  readonly state?: PrState;
  readonly closedAt?: Date;
  readonly purgeAfter?: Date;
}

async function insertPr(db: Db, seed: PrSeed): Promise<PullRequestRowId> {
  // Lifecycle-consistent defaults: a seed armed for the sweep must be a
  // closed PR (the 0002 open-retention-shape CHECK forbids open+armed).
  const armed = seed.purgeAfter !== undefined || seed.closedAt !== undefined;
  const rows = await db
    .insert(pullRequest)
    .values({
      installationId: seed.installationId,
      repoId: seed.repoId ?? REPO,
      prNumber: seed.prNumber ?? 7,
      repoSlug: "acme/widgets",
      state: seed.state ?? (armed ? PrState.CLOSED : PrState.OPEN),
      closedAt:
        seed.closedAt ?? (armed ? new Date("2026-07-01T00:00:00Z") : undefined),
      purgeAfter: seed.purgeAfter,
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
    side: DraftCommentSide.NEW,
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
    category: ChangeGroupCategory.BUGFIX,
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
    decision: DispositionDecision.DISMISSED,
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
  await db.insert(diffSnapshot).values({
    installationId,
    pullRequestId,
    sha: CHECKPOINT_SHA,
    ...artifact("diff --git a/x b/x"),
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
    kind: GenerationKind.BRIEF,
    headSha: HEAD_SHA,
    baselineSha: null,
    status: GenerationStatus.SUCCEEDED,
  });
  // A pre-existing (non-delete) audit row — proves audit_log is retained.
  await db.insert(auditLog).values({
    installationId,
    actorType: "app",
    operation: "generate",
    outcome: AuditOutcome.OK,
    targetType: "pull_request",
    targetId: pullRequestId,
    metadata: { kind: "brief" },
  });
  // The one non-PR table — must survive a PR-scoped purge.
  await db.insert(authSession).values({
    installationId,
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
  const tables = [
    brief,
    delta,
    diffSnapshot,
    revisionNarrative,
    comparisonMarks,
    hunkSpan,
  ];
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
 * `pull_request` — so the PR cascade only reaches it through two hops.
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

describe("purgeRoutines.purgePullRequest — cascade + no-FK audit survival", () => {
  let pair: Pair;
  let prId: PullRequestRowId;

  beforeEach(async () => {
    pair = await freshPair();
    prId = await insertPr(pair.raw, { installationId: TENANT_A });
    await seedFullGraph(pair.raw, TENANT_A, prId);
  });

  it("erases all 8 per-PR child tables, spares audit_log + auth_session, appends a delete row", async () => {
    expect(await countChildTables(pair.raw, prId)).toBe(8);
    expect(await countSessionTables(pair.raw, TENANT_A)).toBe(6);

    const result = await purgeRoutines(pair.handle, CTX_A).purgePullRequest(
      prId,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected purge success");
    expect(result.value).toBe(1);

    // Every per-PR child gone by FK cascade — including the Review Session
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

    // The appended `delete` row EXISTS after the purge — proving audit_log has
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

  it("rejects a cross-tenant PR with notFound and deletes nothing", async () => {
    // Tenant B calls purge on tenant A's PR.
    const result = await purgeRoutines(pair.handle, {
      installationId: TENANT_B,
    }).purgePullRequest(prId);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected notFound");
    expect(result.error.code).toBe(PurgeErrorCode.NOT_FOUND);

    // Nothing deleted, and no spurious audit entry under either tenant.
    expect(await countChildTables(pair.raw, prId)).toBe(8);
    expect(
      await pair.raw.select({ id: pullRequest.id }).from(pullRequest),
    ).toHaveLength(1);
    expect(await deleteAudits(pair.raw, TENANT_A)).toHaveLength(0);
    expect(await deleteAudits(pair.raw, TENANT_B)).toHaveLength(0);
  });
});

describe("purgeRoutines.purgeRepo — scoped predicate-delete", () => {
  it("purges only the named repo's PRs and returns the count", async () => {
    const { raw, handle } = await freshPair();
    const pr1 = await insertPr(raw, {
      installationId: TENANT_A,
      repoId: REPO,
      prNumber: 1,
    });
    const pr2 = await insertPr(raw, {
      installationId: TENANT_A,
      repoId: REPO,
      prNumber: 2,
    });
    const other = await insertPr(raw, {
      installationId: TENANT_A,
      repoId: REPO_OTHER,
      prNumber: 3,
    });
    await seedFullGraph(raw, TENANT_A, pr1);

    const count = await purgeRoutines(handle, CTX_A).purgeRepo(REPO);
    expect(count).toBe(2);

    const remaining = await raw
      .select({ id: pullRequest.id })
      .from(pullRequest);
    expect(remaining.map((r) => r.id)).toEqual([other]);
    // pr1's children cascaded away.
    expect(await countChildTables(raw, pr1)).toBe(0);
    void pr2;

    const deletes = await deleteAudits(raw, TENANT_A);
    expect(deletes).toHaveLength(1);
    expect(deletes[0]?.targetType).toBe("repo");
  });
});

describe("purgeRoutines.purgeRepos — set-based multi-repo purge", () => {
  it("purges every named repo in one tx, one audit entry per repo, count-0 included", async () => {
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

    // REPO holds two PRs; a third repo (never seeded) contributes a count-0
    // audit entry, matching purgeRepo's emit-even-on-zero behavior.
    const emptyRepo: RepoId = brandWith(isRepoId, 999n);
    const count = await purgeRoutines(handle, CTX_A).purgeRepos([
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
    const count = await purgeRoutines(handle, CTX_A).purgeRepos([]);
    expect(count).toBe(0);
    expect(await deleteAudits(raw, TENANT_A)).toHaveLength(0);
  });
});

describe("purgeRoutines.purgeInstallation — tenant-isolated offboarding", () => {
  it("removes tenant A's PRs + sessions + api tokens only; B untouched; audit_log retained", async () => {
    const { raw, handle } = await freshPair();
    const aPr = await insertPr(raw, { installationId: TENANT_A, prNumber: 1 });
    const bPr = await insertPr(raw, { installationId: TENANT_B, prNumber: 1 });
    await seedFullGraph(raw, TENANT_A, aPr);
    await seedFullGraph(raw, TENANT_B, bPr);
    // The second non-PR secret-bearing table: installation-bound API tokens
    // must die with the tenant, like sessions.
    for (const [installationId, hash] of [
      [TENANT_A, "e".repeat(64)],
      [TENANT_B, "f".repeat(64)],
    ] as const) {
      await raw.insert(apiToken).values({
        installationId,
        tokenHash: hash,
        userId: REVIEWER,
        name: "ci-token",
        scope: WriteClassification.EXTERNAL_WRITE,
        grantId: await insertGrant(raw),
        expiresAt: null,
      });
    }

    const counts = await purgeRoutines(handle, CTX_A).purgeInstallation();
    expect(counts).toEqual({ pullRequests: 1, sessions: 1, apiTokens: 1 });

    // Tenant A fully erased (PR + session + token).
    const prs = await raw.select({ id: pullRequest.id }).from(pullRequest);
    expect(prs.map((r) => r.id)).toEqual([bPr]);
    const sessions = await raw
      .select({
        id: authSession.id,
        installationId: authSession.installationId,
      })
      .from(authSession);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.installationId).toBe(TENANT_B);
    const tokens = await raw
      .select({ id: apiToken.id, installationId: apiToken.installationId })
      .from(apiToken);
    expect(tokens).toHaveLength(1);
    expect(tokens[0]?.installationId).toBe(TENANT_B);
    // The purged referents' grants died with them; B's two remain.
    expect(
      await raw.select({ id: githubGrant.id }).from(githubGrant),
    ).toHaveLength(2);

    // Tenant B's child graph is intact; A's Review Session graph is gone.
    expect(await countChildTables(raw, bPr)).toBe(8);
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

describe("purgeRoutines.sweepExpired — retention sweep", () => {
  it("removes only expired, non-null, in-tenant rows and audits the count", async () => {
    const { raw, handle } = await freshPair();
    const now = new Date("2026-07-04T00:00:00Z");
    const past = new Date("2026-07-01T00:00:00Z");
    const future = new Date("2026-07-10T00:00:00Z");

    const expired = await insertPr(raw, {
      installationId: TENANT_A,
      prNumber: 1,
      purgeAfter: past,
    });
    const openNever = await insertPr(raw, {
      installationId: TENANT_A,
      prNumber: 2,
      // purge_after null — retention disabled / still open.
    });
    const notYet = await insertPr(raw, {
      installationId: TENANT_A,
      prNumber: 3,
      purgeAfter: future,
    });
    // Another tenant with an expired row — must be spared.
    const bExpired = await insertPr(raw, {
      installationId: TENANT_B,
      prNumber: 1,
      purgeAfter: past,
    });

    const purged = await purgeRoutines(handle, CTX_A).sweepExpired(now);
    expect(purged).toBe(1);

    const remaining = await raw
      .select({ id: pullRequest.id })
      .from(pullRequest);
    expect(remaining.map((r) => r.id).toSorted(bigIntAsc)).toEqual(
      [openNever, notYet, bExpired].toSorted(bigIntAsc),
    );
    void expired;

    const deletes = await deleteAudits(raw, TENANT_A);
    expect(deletes).toHaveLength(1);
    expect(deletes[0]?.targetType).toBe("pull_request");
    // The count is summarized in metadata; targetId is absent for a batch.
    expect(deletes[0]?.targetId).toBeNull();
    // Tenant B untouched and unaudited.
    expect(await deleteAudits(raw, TENANT_B)).toHaveLength(0);
  });

  it("emits no audit entry when the sweep erases nothing", async () => {
    const { raw, handle } = await freshPair();
    await insertPr(raw, { installationId: TENANT_A, prNumber: 1 }); // null purge_after
    const purged = await purgeRoutines(handle, CTX_A).sweepExpired(new Date());
    expect(purged).toBe(0);
    expect(await deleteAudits(raw, TENANT_A)).toHaveLength(0);
  });
});

describe("purgeRoutines.setRetention — purge_after semantics", () => {
  it("sets purge_after = closedAt + grace and stamps closed_at", async () => {
    const { raw, handle } = await freshPair();
    const closedAt = new Date("2026-07-01T00:00:00Z");
    // Seeded OPEN: setRetention itself performs the terminal transition.
    const prId = await insertPr(raw, { installationId: TENANT_A });

    const result = await purgeRoutines(handle, CTX_A).setRetention(
      prId,
      PrState.CLOSED,
      closedAt,
      7,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.value.state).toBe(PrState.CLOSED);
    expect(result.value.closedAt?.getTime()).toBe(closedAt.getTime());
    const expected = closedAt.getTime() + 7 * 24 * 60 * 60 * 1000;
    expect(result.value.purgeAfter?.getTime()).toBe(expected);
  });

  it("rejects negative and non-finite graceDays without writing", async () => {
    const { raw, handle } = await freshPair();
    const routines = purgeRoutines(handle, CTX_A);
    const prId = await insertPr(raw, { installationId: TENANT_A });
    const closedAt = new Date("2026-07-01T00:00:00Z");

    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = await routines.setRetention(
        prId,
        PrState.CLOSED,
        closedAt,
        bad,
      );
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("expected failure");
      expect(result.error.code).toBe(PurgeErrorCode.INVALID_GRACE);
    }
    const rows = await raw
      .select()
      .from(pullRequest)
      .where(eq(pullRequest.id, prId));
    expect(rows[0]?.purgeAfter).toBeNull();
    expect(rows[0]?.closedAt).toBeNull();
  });

  it("null grace disables retention — the row is never swept", async () => {
    const { raw, handle } = await freshPair();
    const routines = purgeRoutines(handle, CTX_A);
    const prId = await insertPr(raw, { installationId: TENANT_A });

    const result = await routines.setRetention(
      prId,
      PrState.MERGED,
      new Date("2026-07-01T00:00:00Z"),
      null,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.value.purgeAfter).toBeNull();

    // A sweep far in the future still cannot touch a null-purge_after row.
    const purged = await routines.sweepExpired(
      new Date("2099-01-01T00:00:00Z"),
    );
    expect(purged).toBe(0);
    expect(
      await raw.select({ id: pullRequest.id }).from(pullRequest),
    ).toHaveLength(1);
  });

  it("returns notFound for a PR outside the tenant", async () => {
    const { raw, handle } = await freshPair();
    const prId = await insertPr(raw, { installationId: TENANT_A });
    const result = await purgeRoutines(handle, {
      installationId: TENANT_B,
    }).setRetention(prId, PrState.CLOSED, new Date(), 3);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected notFound");
    expect(result.error.code).toBe(PurgeErrorCode.NOT_FOUND);
  });
});

describe("purgeRoutines.sweepExpiredSessions — TTL sweep", () => {
  it("removes only in-tenant expired sessions and emits no audit entry", async () => {
    const { raw, handle } = await freshPair();
    const now = new Date("2026-07-04T00:00:00Z");
    const expired = new Date("2026-07-01T00:00:00Z");
    const live = new Date("2026-07-10T00:00:00Z");

    async function session(
      installationId: InstallationId,
      token: string,
      expiresAt: Date,
    ): Promise<void> {
      await raw.insert(authSession).values({
        installationId,
        sessionTokenHash: token,
        reviewerId: REVIEWER,
        grantId: await insertGrant(raw),
        expiresAt,
      });
    }
    await session(TENANT_A, "a-expired", expired);
    await session(TENANT_A, "a-live", live);
    await session(TENANT_B, "b-expired", expired);

    const deleted = await purgeRoutines(handle, CTX_A).sweepExpiredSessions(
      now,
    );
    expect(deleted).toBe(1);

    const remaining = await raw
      .select({ token: authSession.sessionTokenHash })
      .from(authSession);
    expect(
      remaining.map((r) => r.token).toSorted((a, b) => a.localeCompare(b)),
    ).toEqual(["a-live", "b-expired"]);
    // The swept session's grant died with it; the live rows keep theirs.
    expect(
      await raw.select({ id: githubGrant.id }).from(githubGrant),
    ).toHaveLength(2);

    // No artifact-level audit for short-lived session churn (stated choice).
    expect(await deleteAudits(raw, TENANT_A)).toHaveLength(0);
  });
});
