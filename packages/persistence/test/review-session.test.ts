// Review Session tests. Three jobs: prove the DB-stored vocabularies and
// their CHECK constraints cannot drift apart, prove the store's session
// semantics (the first write creates, a read never does), and prove tenant B can neither
// read nor write tenant A's session rows.
import type { PGlite } from "@electric-sql/pglite";
import { Categories } from "brief-core";
import { drizzle } from "drizzle-orm/pglite";
import {
  AnchorStatuses,
  CommentAnchorKinds,
  DraftCommentSides,
  DraftCommentStatuses,
} from "types/comments";
import { describe, expect, it } from "vitest";
import { fromDrizzle } from "../src/db/handle";
import {
  createArtifactStore,
  createTenantRepository,
  ReviewSessionErrorCodes,
} from "../src/index";
import type {
  AppDatabase,
  ReviewSessionRow,
  SessionWriter,
  TenantContext,
} from "../src/index";
import * as schema from "../src/schema/index";
import {
  isInstallationId,
  isRepoId,
  isReviewerId,
  type BriefRowId,
  type InstallationId,
  type RepoId,
  type ReviewerId,
} from "../src/types";
import { ChangeGroupCategories, ReviewOutcomes } from "types/reviews";
import {
  DispositionCarryStatuses,
  DispositionEvidenceKinds,
  DispositionEvidenceStatuses,
} from "types/dispositions";

import { brandWith, freshPglite } from "./helpers";

/**
 * The handle plus the PGlite client behind it: the raw client is how these
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
  const repo = createTenantRepository(handle, ctx);
  const pr = await repo.pullRequests.upsert({
    repoId: REPO,
    prNumber,
    repoSlug: "acme/widgets",
    state: "open",
  });
  const written = await createArtifactStore(handle, ctx).briefs.write({
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

/** No previous session in these fixtures, so the facts are never consulted. */
const NO_FACTS = { groupIds: [], flags: [], filePaths: [] };

/**
 * A materialized session: the ONLY way one is created. The write is the
 * identity read, so the seed is exactly what a first product write does.
 */
async function openSession(
  handle: AppDatabase,
  ctx: TenantContext,
  briefId: BriefRowId,
  reviewerId: ReviewerId = REVIEWER,
): Promise<ReviewSessionRow> {
  const created = await createTenantRepository(
    handle,
    ctx,
  ).reviewSessions.writeToSession(
    { briefId, reviewerId, brief: async () => NO_FACTS },
    async (writer) => writer.session,
  );
  if (!created.ok)
    throw new Error(`session seed failed: ${created.error.code}`);
  return created.value;
}

/** Run one owned write the only way there is: through the session's writer. */
async function write<T>(
  handle: AppDatabase,
  ctx: TenantContext,
  briefId: BriefRowId,
  body: (writer: SessionWriter) => Promise<T>,
): Promise<T> {
  const written = await createTenantRepository(
    handle,
    ctx,
  ).reviewSessions.writeToSession(
    { briefId, reviewerId: REVIEWER, brief: async () => NO_FACTS },
    body,
  );
  if (!written.ok) throw new Error(`write failed: ${written.error.code}`);
  return written.value;
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

describe("review-session vocabularies match CHECK constraints", () => {
  it.each([
    ["review_session_review_outcome_check", ReviewOutcomes],
    ["review_draft_comment_status_check", DraftCommentStatuses],
    ["review_draft_comment_kind_check", CommentAnchorKinds],
    ["review_draft_comment_side_check", DraftCommentSides],
    ["review_draft_comment_start_side_check", DraftCommentSides],
    ["review_draft_comment_anchor_status_check", AnchorStatuses],
    ["review_group_reclassification_category_check", ChangeGroupCategories],
    ["disposition_carry_status_check", DispositionCarryStatuses],
    ["disposition_evidence_status_check", DispositionEvidenceStatuses],
    ["disposition_evidence_kind_check", DispositionEvidenceKinds],
  ])("%s accepts exactly its `as const` map", async (name, map) => {
    const { client } = await freshPair();
    expect((await checkValues(client, name)).toSorted()).toEqual(
      Object.values(map).toSorted(),
    );
  });

  it("mirrors brief-core's Category vocabulary exactly", () => {
    expect(Object.values(ChangeGroupCategories).toSorted()).toEqual(
      [...Categories].toSorted(),
    );
  });

  it.each([
    ["non-positive start", 0, 5],
    ["inverted range", 9, 4],
  ])("rejects a draft comment with a %s", async (_name, start, end) => {
    const { handle } = await freshPair();
    const briefId = await seedBrief(handle, CTX_A);
    await openSession(handle, CTX_A, briefId);

    // The coordinates ARE the GitHub POST payload: a bad range must not reach
    // publish time, so the DB refuses it.
    const rejection: unknown = await write(handle, CTX_A, briefId, (writer) =>
      writer.addDraftComment({
        kind: CommentAnchorKinds.LINE,
        filePath: "src/app.ts",
        side: DraftCommentSides.NEW,
        startLine: start,
        endLine: end,
        body: "bad range",
      }),
    ).then(
      () => null,
      (error: unknown) => error,
    );
    expect(rejection).not.toBeNull();
  });

  it("round-trips a two-side draft and lets its lines invert", async () => {
    const { handle } = await freshPair();
    const briefId = await seedBrief(handle, CTX_A);
    await openSession(handle, CTX_A, briefId);

    // new\u2192old across blocks: the start line is higher than the end line,
    // which only the conditional range CHECK permits.
    const written = await write(handle, CTX_A, briefId, (writer) =>
      writer.addDraftComment({
        kind: CommentAnchorKinds.LINE,
        filePath: "src/app.ts",
        side: DraftCommentSides.OLD,
        startSide: DraftCommentSides.NEW,
        startLine: 10,
        endLine: 20,
        body: "crosses sides",
      }),
    );
    expect(written.anchor).toEqual(
      expect.objectContaining({
        kind: CommentAnchorKinds.LINE,
        startSide: DraftCommentSides.NEW,
      }),
    );

    const inverted = await write(handle, CTX_A, briefId, (writer) =>
      writer.addDraftComment({
        kind: CommentAnchorKinds.LINE,
        filePath: "src/app.ts",
        side: DraftCommentSides.NEW,
        startSide: DraftCommentSides.OLD,
        startLine: 25,
        endLine: 3,
        body: "old start after new end",
      }),
    );
    expect(inverted.anchor).toEqual(
      expect.objectContaining({
        startLine: 25,
        endLine: 3,
      }),
    );
  });

  it("round-trips a file-arm draft with no line columns", async () => {
    const { handle } = await freshPair();
    const briefId = await seedBrief(handle, CTX_A);
    await openSession(handle, CTX_A, briefId);

    const written = await write(handle, CTX_A, briefId, (writer) =>
      writer.addDraftComment({
        kind: CommentAnchorKinds.FILE,
        filePath: "src/app.ts",
        body: "comment on the file",
      }),
    );

    expect(written.anchor).toEqual({
      kind: CommentAnchorKinds.FILE,
      file: "src/app.ts",
    });

    const snapshot = await createTenantRepository(
      handle,
      CTX_A,
    ).reviewSessions.get({ briefId, reviewerId: REVIEWER });
    expect(snapshot?.draftComments).toEqual([
      expect.objectContaining({
        anchor: {
          kind: CommentAnchorKinds.FILE,
          file: "src/app.ts",
        },
        body: "comment on the file",
      }),
    ]);
  });

  it("rejects a line-arm row with null coordinates", async () => {
    const { client, handle } = await freshPair();
    const briefId = await seedBrief(handle, CTX_A);
    const session = await openSession(handle, CTX_A, briefId);

    const rejection: unknown = await client
      .query(
        `insert into review_draft_comment (
           review_session_id, file_path, kind, body
         ) values ($1, 'src/app.ts', 'line', 'no coords')`,
        [session.id],
      )
      .then(
        () => null,
        (error: unknown) => error,
      );
    expect(rejection).not.toBeNull();
  });

  it("rejects a line-arm row with a null side", async () => {
    const { client, handle } = await freshPair();
    const briefId = await seedBrief(handle, CTX_A);
    const session = await openSession(handle, CTX_A, briefId);

    const rejection: unknown = await client
      .query(
        `insert into review_draft_comment (
           review_session_id, file_path, kind, start_line, end_line, body
         ) values ($1, 'src/app.ts', 'line', 1, 1, 'no side')`,
        [session.id],
      )
      .then(
        () => null,
        (error: unknown) => error,
      );
    expect(rejection).not.toBeNull();
  });

  it("rejects a line-arm update that nulls coordinates", async () => {
    const { client, handle } = await freshPair();
    const briefId = await seedBrief(handle, CTX_A);
    await openSession(handle, CTX_A, briefId);
    const written = await write(handle, CTX_A, briefId, (writer) =>
      writer.addDraftComment({
        kind: CommentAnchorKinds.LINE,
        filePath: "src/app.ts",
        side: DraftCommentSides.NEW,
        startLine: 1,
        endLine: 2,
        body: "valid line",
      }),
    );

    const rejection: unknown = await client
      .query(
        `update review_draft_comment
         set side = null, start_line = null, end_line = null
         where id = $1`,
        [written.id],
      )
      .then(
        () => null,
        (error: unknown) => error,
      );
    expect(rejection).not.toBeNull();
  });

  it("rejects a file-arm row that still carries a line", async () => {
    const { client, handle } = await freshPair();
    const briefId = await seedBrief(handle, CTX_A);
    const session = await openSession(handle, CTX_A, briefId);

    const rejection: unknown = await client
      .query(
        `insert into review_draft_comment (
           review_session_id, file_path, kind, side, start_line, end_line, body
         ) values ($1, 'src/app.ts', 'file', 'new', 1, 1, 'mixed')`,
        [session.id],
      )
      .then(
        () => null,
        (error: unknown) => error,
      );
    expect(rejection).not.toBeNull();
  });

  it("rejects a start_side equal to side", async () => {
    const { handle } = await freshPair();
    const briefId = await seedBrief(handle, CTX_A);
    await openSession(handle, CTX_A, briefId);

    const rejection: unknown = await write(handle, CTX_A, briefId, (writer) =>
      writer.addDraftComment({
        kind: CommentAnchorKinds.LINE,
        filePath: "src/app.ts",
        side: DraftCommentSides.NEW,
        startSide: DraftCommentSides.NEW,
        startLine: 1,
        endLine: 2,
        body: "not genuinely two-side",
      }),
    ).then(
      () => null,
      (error: unknown) => error,
    );
    expect(rejection).not.toBeNull();
  });

  it("rejects a value outside the outcome vocabulary", async () => {
    const { client, handle } = await freshPair();
    const briefId = await seedBrief(handle, CTX_A);
    await openSession(handle, CTX_A, briefId);

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
 * `disposition` has no store yet: the carry-over writer arrives with the
 * evaluation transaction. What must hold now is the amended key: a decision is
 * unique per (session, file, attribute, region), and the SAME coordinates in a
 * second session are a second row rather than a conflict.
 */
describe("disposition uses a session-owned natural key", () => {
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
    const created = await openSession(handle, CTX_A, briefId);

    await insertDisposition(client, created.id);
    const rejection: unknown = await insertDisposition(client, created.id).then(
      () => null,
      (error: unknown) => error,
    );
    expect(rejection).not.toBeNull();
    expect(await countRows(client, "disposition")).toBe(1);
  });

  it("keeps the same anchor decided in a second session", async () => {
    const { client, handle } = await freshPair();
    const first = await openSession(
      handle,
      CTX_A,
      await seedBrief(handle, CTX_A, 7),
    );
    const second = await openSession(
      handle,
      CTX_A,
      await seedBrief(handle, CTX_A, 8),
    );

    await insertDisposition(client, first.id);
    await insertDisposition(client, second.id);
    expect(await countRows(client, "disposition")).toBe(2);
  });

  it("cascades away with the session that owns it", async () => {
    const { client, handle } = await freshPair();
    const briefId = await seedBrief(handle, CTX_A);
    const created = await openSession(handle, CTX_A, briefId);

    await insertDisposition(client, created.id);
    await client.exec("delete from review_session");
    expect(await countRows(client, "disposition")).toBe(0);
  });
});

describe("reviewSessions session semantics", () => {
  it("creates on the first write and reuses the row on the second", async () => {
    const { handle } = await freshPair();
    const briefId = await seedBrief(handle, CTX_A);

    const first = await openSession(handle, CTX_A, briefId);
    const second = await openSession(handle, CTX_A, briefId);

    expect(second.id).toBe(first.id);
    expect(first.reviewOutcome).toBe(ReviewOutcomes.COMMENT);
  });

  it("leaves the stored outcome alone when a later write does not name one", async () => {
    const { handle } = await freshPair();
    const briefId = await seedBrief(handle, CTX_A);
    const repo = createTenantRepository(handle, CTX_A);
    const query = {
      briefId,
      reviewerId: REVIEWER,
      brief: async () => NO_FACTS,
    };

    await repo.reviewSessions.writeToSession(query, (writer) =>
      writer.setReviewOutcome(ReviewOutcomes.REQUEST_CHANGES),
    );
    await repo.reviewSessions.writeToSession(query, (writer) =>
      writer.putReadMark({ chunkId: "c1" }),
    );

    const snapshot = await repo.reviewSessions.get({
      briefId,
      reviewerId: REVIEWER,
    });
    expect(snapshot?.session.reviewOutcome).toBe(
      ReviewOutcomes.REQUEST_CHANGES,
    );
  });

  it("reads nothing and creates nothing when no session exists", async () => {
    const { client, handle } = await freshPair();
    const briefId = await seedBrief(handle, CTX_A);
    const repo = createTenantRepository(handle, CTX_A);

    expect(
      await repo.reviewSessions.get({ briefId, reviewerId: REVIEWER }),
    ).toBeUndefined();

    expect(await countRows(client, "review_session")).toBe(0);
  });

  it("returns the session with everything it owns", async () => {
    const { handle } = await freshPair();
    const briefId = await seedBrief(handle, CTX_A);
    const repo = createTenantRepository(handle, CTX_A);
    const created = await openSession(handle, CTX_A, briefId);
    const reviewSessionId = created.id;

    await write(handle, CTX_A, briefId, async (writer) => {
      await writer.addDraftComment({
        kind: CommentAnchorKinds.LINE,
        filePath: "src/app.ts",
        side: DraftCommentSides.NEW,
        startLine: 10,
        endLine: 12,
        body: "this leaks",
        anchorStatus: AnchorStatuses.MOVED,
      });
      await writer.putReadMark({ chunkId: "c1" });
      await writer.putReclassification({
        changeGroupId: "g1",
        category: ChangeGroupCategories.BUGFIX,
      });
      await writer.recordSubmittedReview({ githubReviewId: 909n });
    });

    const snapshot = await repo.reviewSessions.get({
      briefId,
      reviewerId: REVIEWER,
    });
    expect(snapshot?.session.id).toBe(reviewSessionId);
    expect(snapshot?.draftComments).toHaveLength(1);
    expect(snapshot?.draftComments[0]?.status).toBe(DraftCommentStatuses.DRAFT);
    expect(snapshot?.draftComments[0]?.anchorStatus).toBe(AnchorStatuses.MOVED);
    expect(snapshot?.readMarks).toHaveLength(1);
    expect(snapshot?.reclassifications).toHaveLength(1);
    expect(snapshot?.submittedReviews).toHaveLength(1);
  });

  it("keeps the per-subject writes idempotent on their natural keys", async () => {
    const { handle } = await freshPair();
    const briefId = await seedBrief(handle, CTX_A);
    const repo = createTenantRepository(handle, CTX_A);
    await openSession(handle, CTX_A, briefId);

    await write(handle, CTX_A, briefId, async (writer) => {
      await writer.putReadMark({ chunkId: "c1" });
      await writer.putReadMark({ chunkId: "c1" });
      await writer.putReclassification({
        changeGroupId: "g1",
        category: ChangeGroupCategories.BUGFIX,
      });
      await writer.putReclassification({
        changeGroupId: "g1",
        category: ChangeGroupCategories.NEW_FEATURE,
      });
      await writer.recordSubmittedReview({ githubReviewId: 909n });
      await writer.recordSubmittedReview({ githubReviewId: 909n });
    });

    const snapshot = await repo.reviewSessions.get({
      briefId,
      reviewerId: REVIEWER,
    });
    expect(snapshot?.readMarks).toHaveLength(1);
    expect(snapshot?.reclassifications).toHaveLength(1);
    expect(snapshot?.reclassifications[0]?.category).toBe(
      ChangeGroupCategories.NEW_FEATURE,
    );
    expect(snapshot?.submittedReviews).toHaveLength(1);
  });

  it("publishing flips the named drafts and leaves the rest alone", async () => {
    const { handle } = await freshPair();
    const briefId = await seedBrief(handle, CTX_A);
    const repo = createTenantRepository(handle, CTX_A);
    await openSession(handle, CTX_A, briefId);

    const published = await write(handle, CTX_A, briefId, async (writer) => {
      const first = await writer.addDraftComment({
        kind: CommentAnchorKinds.LINE,
        filePath: "src/app.ts",
        side: DraftCommentSides.NEW,
        startLine: 1,
        endLine: 1,
        body: "publish me",
      });
      await writer.addDraftComment({
        kind: CommentAnchorKinds.LINE,
        filePath: "src/app.ts",
        side: DraftCommentSides.NEW,
        startLine: 2,
        endLine: 2,
        body: "leave me",
      });
      await writer.publishDraftComments([first.id]);
      return first.id;
    });

    const snapshot = await repo.reviewSessions.get({
      briefId,
      reviewerId: REVIEWER,
    });
    const flipped = snapshot?.draftComments.filter(
      (row) => row.status === DraftCommentStatuses.SUBMITTED,
    );
    expect(flipped?.map((row) => row.id)).toEqual([published]);
  });

  it("cascades the session and its owned rows away with the brief", async () => {
    const { client, handle } = await freshPair();
    const briefId = await seedBrief(handle, CTX_A);
    await write(handle, CTX_A, briefId, (writer) =>
      writer.putReadMark({ chunkId: "c1" }),
    );

    await client.exec("delete from brief");

    expect(await countRows(client, "review_session")).toBe(0);
    expect(await countRows(client, "review_read_mark")).toBe(0);
  });
});

describe("reviewSessions tenancy containment", () => {
  it("B cannot open a session against A's brief", async () => {
    const { client, handle } = await freshPair();
    const briefId = await seedBrief(handle, CTX_A);

    const attempt = await createTenantRepository(
      handle,
      CTX_B,
    ).reviewSessions.writeToSession(
      { briefId, reviewerId: REVIEWER, brief: async () => NO_FACTS },
      async (writer) => writer.session,
    );

    expect(attempt.ok).toBe(false);
    if (attempt.ok) return;
    expect(attempt.error.code).toBe(
      ReviewSessionErrorCodes.PARENT_NOT_IN_TENANT,
    );
    expect(await countRows(client, "review_session")).toBe(0);
  });

  it("B cannot read A's session", async () => {
    const { handle } = await freshPair();
    const briefId = await seedBrief(handle, CTX_A);
    await openSession(handle, CTX_A, briefId);

    expect(
      await createTenantRepository(handle, CTX_B).reviewSessions.get({
        briefId,
        reviewerId: REVIEWER,
      }),
    ).toBeUndefined();
  });

  it("keeps A's and B's sessions independent on their own briefs", async () => {
    const { handle } = await freshPair();
    const briefA = await seedBrief(handle, CTX_A, 7);
    const briefB = await seedBrief(handle, CTX_B, 8);

    const a = await openSession(handle, CTX_A, briefA);
    const b = await openSession(handle, CTX_B, briefB);

    expect(a.installationId).toBe(TENANT_A);
    expect(b.installationId).toBe(TENANT_B);
    expect(a.reviewOutcome).toBe(ReviewOutcomes.COMMENT);
  });
});
