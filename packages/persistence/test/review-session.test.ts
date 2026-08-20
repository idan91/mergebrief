// Review Session tests. Three jobs: prove the DB-stored vocabularies and
// their CHECK constraints cannot drift apart, prove the store's session
// semantics (upsert creates, read never does), and prove tenant B can neither
// read nor write tenant A's session rows.
import type { PGlite } from "@electric-sql/pglite";
import { Categories } from "brief-core";
import { drizzle } from "drizzle-orm/pglite";
import { describe, expect, it } from "vitest";
import { fromDrizzle } from "../src/db/handle";
import { artifactStore, forTenant, ReviewSessionErrorCode } from "../src/index";
import type { AppDatabase, TenantContext } from "../src/index";
import * as schema from "../src/schema/index";
import {
  AnchorStatus,
  ChangeGroupCategory,
  DispositionCarryStatus,
  DispositionEvidenceStatus,
  DraftCommentSide,
  DraftCommentStatus,
  isInstallationId,
  isRepoId,
  isReviewerId,
  ReviewOutcome,
  type BriefRowId,
  type InstallationId,
  type RepoId,
  type ReviewerId,
} from "../src/types";
import { brandWith, expectCheckViolation, freshPglite } from "./helpers";

/**
 * The handle plus the PGlite client behind it — the raw client is how these
 * tests read `pg_constraint` and row counts the repository deliberately does
 * not expose.
 */
async function freshPair(): Promise<{ client: PGlite; handle: AppDatabase }> {
  const client = await freshPglite();
  return { client, handle: fromDrizzle(drizzle(client, { schema })) };
}

const TENANT_A: InstallationId = brandWith(isInstallationId, 1000n);
const TENANT_B: InstallationId = brandWith(isInstallationId, 2000n);
const REPO: RepoId = brandWith(isRepoId, 777n);
const REVIEWER: ReviewerId = brandWith(isReviewerId, 31337n);

const CTX_A: TenantContext = { installationId: TENANT_A };
const CTX_B: TenantContext = { installationId: TENANT_B };

/** A PR + brief in `ctx`'s tenant; returns the brief row id. */
async function seedBrief(
  handle: AppDatabase,
  ctx: TenantContext,
  prNumber = 7,
): Promise<BriefRowId> {
  const repo = forTenant(handle, ctx);
  const pr = await repo.pullRequests.upsert({
    repoId: REPO,
    prNumber,
    repoSlug: "acme/widgets",
    state: "open",
  });
  const written = await artifactStore(handle, ctx).briefs.write({
    pullRequestId: pr.id,
    baseSha: "base",
    headSha: `head-${prNumber}`,
    headIndex: 1,
    commitCount: 3,
    provider: "anthropic",
    model: "test",
    effort: "high",
    body: '{"brief":true}',
  });
  if (!written.ok) {
    throw new Error(`brief seed failed: ${written.error.message}`);
  }
  return written.value.id;
}

/** The literals a CHECK constraint accepts. */
async function checkValues(
  client: PGlite,
  constraintName: string,
): Promise<string[]> {
  const result = await client.query<{ def: string }>(
    "select pg_get_constraintdef(oid) as def from pg_constraint where conname = $1",
    [constraintName],
  );
  const def = result.rows[0]?.def;
  if (def === undefined) {
    throw new Error(`constraint ${constraintName} not found`);
  }
  return [...def.matchAll(/'([^']*)'/g)].map((match) => match[1] ?? "");
}

/** One integer count, for the "nothing was written" assertions. */
async function countRows(client: PGlite, table: string): Promise<number> {
  const result = await client.query<{ n: number }>(
    `select count(*)::int as n from ${table}`,
  );
  return result.rows[0]?.n ?? -1;
}

describe("review-session vocabularies — map and CHECK in lockstep", () => {
  it.each([
    ["review_session_review_outcome_check", ReviewOutcome],
    ["review_draft_comment_status_check", DraftCommentStatus],
    ["review_draft_comment_side_check", DraftCommentSide],
    ["review_draft_comment_anchor_status_check", AnchorStatus],
    ["review_group_reclassification_category_check", ChangeGroupCategory],
    ["disposition_carry_status_check", DispositionCarryStatus],
    ["disposition_evidence_status_check", DispositionEvidenceStatus],
  ])("%s accepts exactly its `as const` map", async (name, map) => {
    const { client } = await freshPair();
    expect((await checkValues(client, name)).toSorted()).toEqual(
      Object.values(map).toSorted(),
    );
  });

  it("mirrors brief-core's Category vocabulary exactly", () => {
    expect(Object.values(ChangeGroupCategory).toSorted()).toEqual(
      [...Categories].toSorted(),
    );
  });

  it.each([
    ["non-positive start", 0, 5],
    ["inverted range", 9, 4],
  ])("rejects a draft comment with a %s", async (_name, start, end) => {
    const { handle } = await freshPair();
    const briefId = await seedBrief(handle, CTX_A);
    const repo = forTenant(handle, CTX_A);
    const created = await repo.reviewSessions.upsert({
      briefId,
      reviewerId: REVIEWER,
    });
    if (!created.ok) throw new Error("session upsert failed");

    // The coordinates ARE the GitHub POST payload — a bad range must not reach
    // publish time, so the DB refuses it.
    await expectCheckViolation(
      repo.reviewSessions.addDraftComment({
        reviewSessionId: created.value.id,
        filePath: "src/app.ts",
        side: DraftCommentSide.NEW,
        startLine: start,
        endLine: end,
        body: "bad range",
      }),
      "review_draft_comment_line_range_shape",
    );
  });

  it("rejects a value outside the outcome vocabulary", async () => {
    const { client, handle } = await freshPair();
    const briefId = await seedBrief(handle, CTX_A);
    const created = await forTenant(handle, CTX_A).reviewSessions.upsert({
      briefId,
      reviewerId: REVIEWER,
    });
    expect(created.ok).toBe(true);

    const rejection: unknown = await client
      .exec("update review_session set review_outcome = 'lgtm'")
      .then(
        () => null,
        (error: unknown) => error,
      );
    expect(rejection).not.toBeNull();
  });
});

/**
 * `disposition` has no store yet — the carry-over writer arrives with the
 * evaluation transaction. What must hold now is the amended key: a decision is
 * unique per (session, file, attribute, region), and the SAME coordinates in a
 * second session are a second row rather than a conflict.
 */
describe("disposition — the session-owned natural key", () => {
  async function insertDisposition(
    client: PGlite,
    sessionId: bigint,
  ): Promise<void> {
    await client.query(
      `insert into disposition
         (installation_id, review_session_id, file_path, attribute,
          region_start, region_end, decision, decided_at)
       values ($1, $2, 'src/app.ts', 'sql-injection', 10, 20, 'dismissed', now())`,
      [TENANT_A.toString(), sessionId.toString()],
    );
  }

  it("rejects a second decision on the same anchor in one session", async () => {
    const { client, handle } = await freshPair();
    const briefId = await seedBrief(handle, CTX_A);
    const created = await forTenant(handle, CTX_A).reviewSessions.upsert({
      briefId,
      reviewerId: REVIEWER,
    });
    if (!created.ok) throw new Error("session upsert failed");

    await insertDisposition(client, created.value.id);
    const rejection: unknown = await insertDisposition(
      client,
      created.value.id,
    ).then(
      () => null,
      (error: unknown) => error,
    );
    expect(rejection).not.toBeNull();
    expect(await countRows(client, "disposition")).toBe(1);
  });

  it("keeps the same anchor decided in a second session", async () => {
    const { client, handle } = await freshPair();
    const repo = forTenant(handle, CTX_A);
    const first = await repo.reviewSessions.upsert({
      briefId: await seedBrief(handle, CTX_A, 7),
      reviewerId: REVIEWER,
    });
    const second = await repo.reviewSessions.upsert({
      briefId: await seedBrief(handle, CTX_A, 8),
      reviewerId: REVIEWER,
    });
    if (!first.ok || !second.ok) throw new Error("session upsert failed");

    await insertDisposition(client, first.value.id);
    await insertDisposition(client, second.value.id);
    expect(await countRows(client, "disposition")).toBe(2);
  });

  it("cascades away with the session that owns it", async () => {
    const { client, handle } = await freshPair();
    const briefId = await seedBrief(handle, CTX_A);
    const created = await forTenant(handle, CTX_A).reviewSessions.upsert({
      briefId,
      reviewerId: REVIEWER,
    });
    if (!created.ok) throw new Error("session upsert failed");

    await insertDisposition(client, created.value.id);
    await client.exec("delete from review_session");
    expect(await countRows(client, "disposition")).toBe(0);
  });
});

describe("reviewSessions — session semantics", () => {
  it("creates on first upsert and returns the same row on the second", async () => {
    const { handle } = await freshPair();
    const briefId = await seedBrief(handle, CTX_A);
    const repo = forTenant(handle, CTX_A);

    const first = await repo.reviewSessions.upsert({
      briefId,
      reviewerId: REVIEWER,
    });
    const second = await repo.reviewSessions.upsert({
      briefId,
      reviewerId: REVIEWER,
      reviewOutcome: ReviewOutcome.APPROVE,
    });

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.value.id).toBe(first.value.id);
    expect(first.value.reviewOutcome).toBe(ReviewOutcome.COMMENT);
    expect(second.value.reviewOutcome).toBe(ReviewOutcome.APPROVE);
  });

  it("leaves the stored outcome alone when the upsert omits one", async () => {
    const { handle } = await freshPair();
    const briefId = await seedBrief(handle, CTX_A);
    const repo = forTenant(handle, CTX_A);

    await repo.reviewSessions.upsert({
      briefId,
      reviewerId: REVIEWER,
      reviewOutcome: ReviewOutcome.REQUEST_CHANGES,
    });
    const again = await repo.reviewSessions.upsert({
      briefId,
      reviewerId: REVIEWER,
    });

    expect(again.ok && again.value.reviewOutcome).toBe(
      ReviewOutcome.REQUEST_CHANGES,
    );
  });

  it("reads nothing and creates nothing when no session exists", async () => {
    const { client, handle } = await freshPair();
    const briefId = await seedBrief(handle, CTX_A);
    const repo = forTenant(handle, CTX_A);

    expect(
      await repo.reviewSessions.get({ briefId, reviewerId: REVIEWER }),
    ).toBeUndefined();

    expect(await countRows(client, "review_session")).toBe(0);
  });

  it("returns the session with everything it owns", async () => {
    const { handle } = await freshPair();
    const briefId = await seedBrief(handle, CTX_A);
    const repo = forTenant(handle, CTX_A);
    const created = await repo.reviewSessions.upsert({
      briefId,
      reviewerId: REVIEWER,
    });
    if (!created.ok) throw new Error("session upsert failed");
    const reviewSessionId = created.value.id;

    await repo.reviewSessions.addDraftComment({
      reviewSessionId,
      filePath: "src/app.ts",
      side: DraftCommentSide.NEW,
      startLine: 10,
      endLine: 12,
      body: "this leaks",
      anchorStatus: AnchorStatus.MOVED,
    });
    await repo.reviewSessions.putReadMark({ reviewSessionId, chunkId: "c1" });
    await repo.reviewSessions.putReclassification({
      reviewSessionId,
      changeGroupId: "g1",
      category: ChangeGroupCategory.BUGFIX,
    });
    await repo.reviewSessions.recordSubmittedReview({
      reviewSessionId,
      githubReviewId: 909n,
    });

    const snapshot = await repo.reviewSessions.get({
      briefId,
      reviewerId: REVIEWER,
    });
    expect(snapshot?.session.id).toBe(reviewSessionId);
    expect(snapshot?.draftComments).toHaveLength(1);
    expect(snapshot?.draftComments[0]?.status).toBe(DraftCommentStatus.DRAFT);
    expect(snapshot?.draftComments[0]?.anchorStatus).toBe(AnchorStatus.MOVED);
    expect(snapshot?.readMarks).toHaveLength(1);
    expect(snapshot?.reclassifications).toHaveLength(1);
    expect(snapshot?.submittedReviews).toHaveLength(1);
  });

  it("keeps an owned list in insertion order after an in-place update", async () => {
    const { client, handle } = await freshPair();
    const briefId = await seedBrief(handle, CTX_A);
    const repo = forTenant(handle, CTX_A);
    const created = await repo.reviewSessions.upsert({
      briefId,
      reviewerId: REVIEWER,
    });
    if (!created.ok) throw new Error("session upsert failed");

    // Enough rows to fill the first heap page: an UPDATE then has to relocate
    // the tuple, and an unordered read hands the touched row back last.
    await client.exec(
      `insert into review_draft_comment (installation_id, review_session_id, file_path, side, start_line, end_line, body)
       select ${TENANT_A}, ${created.value.id}, 'src/app.ts', '${DraftCommentSide.NEW}', g, g, 'note ' || g
       from generate_series(1, 100) g`,
    );
    await client.exec(
      `update review_draft_comment set status = '${DraftCommentStatus.SUBMITTED}' where start_line = 3`,
    );

    const snapshot = await repo.reviewSessions.get({
      briefId,
      reviewerId: REVIEWER,
    });
    const ids = snapshot?.draftComments.map((row) => row.id) ?? [];
    expect(ids).toHaveLength(100);
    expect(ids).toEqual(ids.toSorted((left, right) => (left < right ? -1 : 1)));
  });

  it("keeps the per-subject writes idempotent on their natural keys", async () => {
    const { handle } = await freshPair();
    const briefId = await seedBrief(handle, CTX_A);
    const repo = forTenant(handle, CTX_A);
    const created = await repo.reviewSessions.upsert({
      briefId,
      reviewerId: REVIEWER,
    });
    if (!created.ok) throw new Error("session upsert failed");
    const reviewSessionId = created.value.id;

    await repo.reviewSessions.putReadMark({ reviewSessionId, chunkId: "c1" });
    await repo.reviewSessions.putReadMark({ reviewSessionId, chunkId: "c1" });
    await repo.reviewSessions.putReclassification({
      reviewSessionId,
      changeGroupId: "g1",
      category: ChangeGroupCategory.BUGFIX,
    });
    await repo.reviewSessions.putReclassification({
      reviewSessionId,
      changeGroupId: "g1",
      category: ChangeGroupCategory.NEW_FEATURE,
    });
    await repo.reviewSessions.recordSubmittedReview({
      reviewSessionId,
      githubReviewId: 909n,
    });
    await repo.reviewSessions.recordSubmittedReview({
      reviewSessionId,
      githubReviewId: 909n,
    });

    const snapshot = await repo.reviewSessions.get({
      briefId,
      reviewerId: REVIEWER,
    });
    expect(snapshot?.readMarks).toHaveLength(1);
    expect(snapshot?.reclassifications).toHaveLength(1);
    expect(snapshot?.reclassifications[0]?.category).toBe(
      ChangeGroupCategory.NEW_FEATURE,
    );
    expect(snapshot?.submittedReviews).toHaveLength(1);
  });

  it("cascades the session and its owned rows away with the brief", async () => {
    const { client, handle } = await freshPair();
    const briefId = await seedBrief(handle, CTX_A);
    const repo = forTenant(handle, CTX_A);
    const created = await repo.reviewSessions.upsert({
      briefId,
      reviewerId: REVIEWER,
    });
    if (!created.ok) throw new Error("session upsert failed");
    await repo.reviewSessions.putReadMark({
      reviewSessionId: created.value.id,
      chunkId: "c1",
    });

    await client.exec("delete from brief");

    expect(await countRows(client, "review_session")).toBe(0);
    expect(await countRows(client, "review_read_mark")).toBe(0);
  });
});

describe("reviewSessions — tenancy containment", () => {
  it("B cannot open a session against A's brief", async () => {
    const { client, handle } = await freshPair();
    const briefId = await seedBrief(handle, CTX_A);

    const attempt = await forTenant(handle, CTX_B).reviewSessions.upsert({
      briefId,
      reviewerId: REVIEWER,
    });

    expect(attempt.ok).toBe(false);
    if (attempt.ok) return;
    expect(attempt.error.code).toBe(
      ReviewSessionErrorCode.PARENT_NOT_IN_TENANT,
    );
    expect(await countRows(client, "review_session")).toBe(0);
  });

  it("B cannot read A's session", async () => {
    const { handle } = await freshPair();
    const briefId = await seedBrief(handle, CTX_A);
    await forTenant(handle, CTX_A).reviewSessions.upsert({
      briefId,
      reviewerId: REVIEWER,
    });

    expect(
      await forTenant(handle, CTX_B).reviewSessions.get({
        briefId,
        reviewerId: REVIEWER,
      }),
    ).toBeUndefined();
  });

  it("B cannot write an owned row onto A's session", async () => {
    const { client, handle } = await freshPair();
    const briefId = await seedBrief(handle, CTX_A);
    const created = await forTenant(handle, CTX_A).reviewSessions.upsert({
      briefId,
      reviewerId: REVIEWER,
    });
    if (!created.ok) throw new Error("session upsert failed");
    const b = forTenant(handle, CTX_B).reviewSessions;

    const attempts = [
      await b.addDraftComment({
        reviewSessionId: created.value.id,
        filePath: "src/app.ts",
        side: DraftCommentSide.NEW,
        startLine: 1,
        endLine: 1,
        body: "injected",
      }),
      await b.putReadMark({ reviewSessionId: created.value.id, chunkId: "c1" }),
      await b.putReclassification({
        reviewSessionId: created.value.id,
        changeGroupId: "g1",
        category: ChangeGroupCategory.BUGFIX,
      }),
      await b.recordSubmittedReview({
        reviewSessionId: created.value.id,
        githubReviewId: 909n,
      }),
    ];

    expect(attempts.map((attempt) => attempt.ok)).toEqual([
      false,
      false,
      false,
      false,
    ]);
    const owned = [
      "review_draft_comment",
      "review_read_mark",
      "review_group_reclassification",
      "review_submitted_review",
    ];
    const counts = await Promise.all(
      owned.map((table) => countRows(client, table)),
    );
    expect(counts).toEqual([0, 0, 0, 0]);
  });

  it("B cannot cite A's session as a draft comment's carry-over source", async () => {
    const { client, handle } = await freshPair();
    const briefA = await seedBrief(handle, CTX_A, 7);
    const briefB = await seedBrief(handle, CTX_B, 8);
    const sessionA = await forTenant(handle, CTX_A).reviewSessions.upsert({
      briefId: briefA,
      reviewerId: REVIEWER,
    });
    const sessionB = await forTenant(handle, CTX_B).reviewSessions.upsert({
      briefId: briefB,
      reviewerId: REVIEWER,
    });
    if (!sessionA.ok || !sessionB.ok) throw new Error("session upsert failed");

    const attempt = await forTenant(
      handle,
      CTX_B,
    ).reviewSessions.addDraftComment({
      reviewSessionId: sessionB.value.id,
      filePath: "src/app.ts",
      side: DraftCommentSide.NEW,
      startLine: 1,
      endLine: 1,
      body: "carried",
      carriedFromSessionId: sessionA.value.id,
    });

    expect(attempt.ok).toBe(false);
    if (attempt.ok) return;
    expect(attempt.error.code).toBe(
      ReviewSessionErrorCode.PARENT_NOT_IN_TENANT,
    );
    expect(await countRows(client, "review_draft_comment")).toBe(0);
  });

  it("keeps A's and B's sessions independent on their own briefs", async () => {
    const { handle } = await freshPair();
    const briefA = await seedBrief(handle, CTX_A, 7);
    const briefB = await seedBrief(handle, CTX_B, 8);

    const a = await forTenant(handle, CTX_A).reviewSessions.upsert({
      briefId: briefA,
      reviewerId: REVIEWER,
    });
    const b = await forTenant(handle, CTX_B).reviewSessions.upsert({
      briefId: briefB,
      reviewerId: REVIEWER,
      reviewOutcome: ReviewOutcome.APPROVE,
    });

    expect(a.ok && a.value.installationId).toBe(TENANT_A);
    expect(b.ok && b.value.installationId).toBe(TENANT_B);
    expect(a.ok && a.value.reviewOutcome).toBe(ReviewOutcome.COMMENT);
  });
});
