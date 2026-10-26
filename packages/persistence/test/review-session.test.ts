// Review Session tests. Three jobs: prove the DB-stored vocabularies and
// their CHECK constraints cannot drift apart, prove the store's session
// semantics (the first write creates, a read never does), and prove tenant B can neither
// read nor write tenant A's session rows.
import type { PGlite } from "@electric-sql/pglite";
import {
  AnchorStatuses,
  CommentAnchorKinds,
  DiffSides,
  DraftCommentStatuses,
} from "types/comments";
import { describe, expect, it } from "vitest";
import {
  ClaimStates,
  createArtifactStore,
  createTenantRepository,
  deriveClaimState,
  PUBLISH_CLAIM_LEASE_MS,
  ReviewSessionErrorCodes,
  ScopeViolationError,
} from "../src/index";
import type {
  AppDatabase,
  ReviewDraftCommentRow,
  ReviewSessionRow,
  TenantContext,
} from "../src/index";
import {
  isInstallationId,
  isRepoId,
  isReviewerId,
  type BriefRowId,
  type DraftAnchor,
  type InstallationId,
  type RepoId,
  type ReviewerId,
} from "../src/types";
import { ChangeGroupCategories, ReviewOutcomes } from "types/reviews";
import {
  DispositionCarryStatuses,
  DispositionDecisions,
  DispositionEvidenceKinds,
  DispositionEvidenceStatuses,
} from "types/dispositions";

import {
  brandWith,
  expectCheckViolation,
  registerSharedPglite,
} from "./helpers";
import { STORED_BODY_VERSION } from "brief-core/artifact";

/**
 * The handle plus the PGlite client behind it: the raw client is how these
 * tests read `pg_constraint` and row counts the repository deliberately does
 * not expose.
 */
const shared = registerSharedPglite();

const TENANT_A: InstallationId = brandWith(isInstallationId, 1000n);
const TENANT_B: InstallationId = brandWith(isInstallationId, 2000n);
const REPO: RepoId = brandWith(isRepoId, 777n);
const REVIEWER: ReviewerId = brandWith(isReviewerId, 31337n);

const CTX_A: TenantContext = { installationId: TENANT_A };
const CTX_B: TenantContext = { installationId: TENANT_B };

/** Two Chunks, one change group and one flag: the caps these tests meet. */
const BRIEF_BODY = JSON.stringify({
  changeGroups: [{ id: "g1" }],
  chunks: [
    {
      id: "c1",
      file: "src/app.ts",
      addedRanges: [{ start: 10, end: 20 }],
      riskSurface: ["sql-injection"],
    },
    { id: "c2", file: "src/app.ts" },
  ],
});

const LINE_ANCHOR = {
  kind: CommentAnchorKinds.LINE,
  file: "src/app.ts",
  side: DiffSides.NEW,
  startLine: 1,
  endLine: 1,
} as const;

/** A PR + brief in `ctx`'s tenant; returns the brief row id. */
async function seedBrief(
  handle: AppDatabase,
  ctx: TenantContext,
  prNumber = 7,
  body = BRIEF_BODY,
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
    bodyVersion: STORED_BODY_VERSION,
    body,
    usedGroupIds: [],
  });
  return written.id;
}

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
  ).reviewSessions.setOutcome({ briefId, reviewerId }, ReviewOutcomes.COMMENT);
  if (!created.ok) {
    throw new Error(`session seed failed: ${created.error.code}`);
  }
  return created.value;
}

/** One draft on the session, through the reviewer's own draft action. */
async function seedDraft(
  handle: AppDatabase,
  briefId: BriefRowId,
  anchor: DraftAnchor,
  body: string,
): Promise<ReviewDraftCommentRow> {
  const added = await createTenantRepository(
    handle,
    CTX_A,
  ).reviewSessions.addDraft(
    { briefId, reviewerId: REVIEWER },
    { anchor, body },
  );
  if (!added.ok) {
    throw new Error(`draft seed failed: ${added.error.code}`);
  }
  return added.value;
}

/** A carry-over verdict no reviewer action writes, stamped on a stored draft. */
async function stampAnchorStatus(
  client: PGlite,
  draftId: bigint,
  anchorStatus: string,
): Promise<void> {
  await client.query(
    "update review_draft_comment set anchor_status = $1 where id = $2",
    [anchorStatus, draftId.toString()],
  );
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
    ["review_draft_comment_side_check", DiffSides],
    ["review_draft_comment_start_side_check", DiffSides],
    ["review_draft_comment_anchor_status_check", AnchorStatuses],
    ["review_group_reclassification_category_check", ChangeGroupCategories],
    ["disposition_carry_status_check", DispositionCarryStatuses],
    ["disposition_evidence_status_check", DispositionEvidenceStatuses],
    ["disposition_evidence_kind_check", DispositionEvidenceKinds],
  ])("%s accepts exactly its `as const` map", async (name, map) => {
    const { client } = shared;
    expect((await checkValues(client, name)).toSorted()).toEqual(
      Object.values(map).toSorted(),
    );
  });

  it.each([
    ["non-positive start", 0, 5],
    ["inverted range", 9, 4],
  ])("rejects a draft comment with a %s", async (_name, start, end) => {
    const { handle } = shared;
    const briefId = await seedBrief(handle, CTX_A);
    await openSession(handle, CTX_A, briefId);

    // The coordinates ARE the GitHub POST payload: a bad range must not reach
    // publish time, so the DB refuses it.
    const rejection: unknown = await seedDraft(
      handle,
      briefId,
      {
        kind: CommentAnchorKinds.LINE,
        file: "src/app.ts",
        side: DiffSides.NEW,
        startLine: start,
        endLine: end,
      },
      "bad range",
    ).then(
      () => null,
      (error: unknown) => error,
    );
    expect(rejection).not.toBeNull();
  });

  it("round-trips a two-side draft and lets its lines invert", async () => {
    const { handle } = shared;
    const briefId = await seedBrief(handle, CTX_A);
    await openSession(handle, CTX_A, briefId);

    // new\u2192old across blocks: the start line is higher than the end line,
    // which only the conditional range CHECK permits.
    const written = await seedDraft(
      handle,
      briefId,
      {
        kind: CommentAnchorKinds.LINE,
        file: "src/app.ts",
        side: DiffSides.OLD,
        startSide: DiffSides.NEW,
        startLine: 10,
        endLine: 20,
      },
      "crosses sides",
    );
    expect(written.anchor).toEqual(
      expect.objectContaining({
        kind: CommentAnchorKinds.LINE,
        startSide: DiffSides.NEW,
      }),
    );

    const inverted = await seedDraft(
      handle,
      briefId,
      {
        kind: CommentAnchorKinds.LINE,
        file: "src/app.ts",
        side: DiffSides.NEW,
        startSide: DiffSides.OLD,
        startLine: 25,
        endLine: 3,
      },
      "old start after new end",
    );
    expect(inverted.anchor).toEqual(
      expect.objectContaining({
        startLine: 25,
        endLine: 3,
      }),
    );
  });

  it("round-trips a file-arm draft with no line columns", async () => {
    const { handle } = shared;
    const briefId = await seedBrief(handle, CTX_A);
    await openSession(handle, CTX_A, briefId);

    const written = await seedDraft(
      handle,
      briefId,
      { kind: CommentAnchorKinds.FILE, file: "src/app.ts" },
      "comment on the file",
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
    const { client, handle } = shared;
    const briefId = await seedBrief(handle, CTX_A);
    const session = await openSession(handle, CTX_A, briefId);

    await expectCheckViolation(
      client.query(
        `insert into review_draft_comment (
           review_session_id, file_path, kind, body
         ) values ($1, 'src/app.ts', 'line', 'no coords')`,
        [session.id],
      ),
      "review_draft_comment_anchor_shape",
    );
  });

  it("rejects a line-arm row with a null side", async () => {
    const { client, handle } = shared;
    const briefId = await seedBrief(handle, CTX_A);
    const session = await openSession(handle, CTX_A, briefId);

    await expectCheckViolation(
      client.query(
        `insert into review_draft_comment (
           review_session_id, file_path, kind, start_line, end_line, body
         ) values ($1, 'src/app.ts', 'line', 1, 1, 'no side')`,
        [session.id],
      ),
      "review_draft_comment_anchor_shape",
    );
  });

  it("rejects a line-arm update that nulls coordinates", async () => {
    const { client, handle } = shared;
    const briefId = await seedBrief(handle, CTX_A);
    await openSession(handle, CTX_A, briefId);
    const written = await seedDraft(
      handle,
      briefId,
      {
        kind: CommentAnchorKinds.LINE,
        file: "src/app.ts",
        side: DiffSides.NEW,
        startLine: 1,
        endLine: 2,
      },
      "valid line",
    );

    await expectCheckViolation(
      client.query(
        `update review_draft_comment
         set side = null, start_line = null, end_line = null
         where id = $1`,
        [written.id],
      ),
      "review_draft_comment_anchor_shape",
    );
  });

  it("rejects a file-arm row that still carries a line", async () => {
    const { client, handle } = shared;
    const briefId = await seedBrief(handle, CTX_A);
    const session = await openSession(handle, CTX_A, briefId);

    await expectCheckViolation(
      client.query(
        `insert into review_draft_comment (
           review_session_id, file_path, kind, side, start_line, end_line, body
         ) values ($1, 'src/app.ts', 'file', 'new', 1, 1, 'mixed')`,
        [session.id],
      ),
      "review_draft_comment_anchor_shape",
    );
  });

  it("rejects a start_side equal to side", async () => {
    const { handle } = shared;
    const briefId = await seedBrief(handle, CTX_A);
    await openSession(handle, CTX_A, briefId);

    const rejection: unknown = await seedDraft(
      handle,
      briefId,
      {
        kind: CommentAnchorKinds.LINE,
        file: "src/app.ts",
        side: DiffSides.NEW,
        startSide: DiffSides.NEW,
        startLine: 1,
        endLine: 2,
      },
      "not genuinely two-side",
    ).then(
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
    const { client, handle } = shared;
    const briefId = await seedBrief(handle, CTX_A);
    const created = await openSession(handle, CTX_A, briefId);

    await insertDisposition(client, created.id);
    await expectCheckViolation(
      insertDisposition(client, created.id),
      "disposition_natural_key",
    );
    expect(await countRows(client, "disposition")).toBe(1);
  });

  it("keeps the same anchor decided in a second session", async () => {
    const { client, handle } = shared;
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
});

describe("reviewSessions session semantics", () => {
  it("creates on the first write and reuses the row on the second", async () => {
    const { handle } = shared;
    const briefId = await seedBrief(handle, CTX_A);

    const first = await openSession(handle, CTX_A, briefId);
    const second = await openSession(handle, CTX_A, briefId);

    expect(second.id).toBe(first.id);
    expect(first.reviewOutcome).toBe(ReviewOutcomes.COMMENT);
  });

  it("leaves the stored outcome alone when a later write does not name one", async () => {
    const { handle } = shared;
    const briefId = await seedBrief(handle, CTX_A);
    const repo = createTenantRepository(handle, CTX_A);
    const query = {
      briefId,
      reviewerId: REVIEWER,
    };

    await repo.reviewSessions.setOutcome(query, ReviewOutcomes.REQUEST_CHANGES);
    await repo.reviewSessions.setChunkRead(query, {
      chunkId: "c1",
      read: true,
    });

    const snapshot = await repo.reviewSessions.get({
      briefId,
      reviewerId: REVIEWER,
    });
    expect(snapshot?.session.reviewOutcome).toBe(
      ReviewOutcomes.REQUEST_CHANGES,
    );
  });

  it("reads nothing and creates nothing when no session exists", async () => {
    const { client, handle } = shared;
    const briefId = await seedBrief(handle, CTX_A);
    const repo = createTenantRepository(handle, CTX_A);

    expect(
      await repo.reviewSessions.get({ briefId, reviewerId: REVIEWER }),
    ).toBeUndefined();

    expect(await countRows(client, "review_session")).toBe(0);
  });

  it("returns the session with everything it owns", async () => {
    const { client, handle } = shared;
    const briefId = await seedBrief(handle, CTX_A);
    const repo = createTenantRepository(handle, CTX_A);
    const created = await openSession(handle, CTX_A, briefId);
    const reviewSessionId = created.id;
    const key = { briefId, reviewerId: REVIEWER };

    const draft = await seedDraft(handle, briefId, LINE_ANCHOR, "this leaks");
    await stampAnchorStatus(client, draft.id, AnchorStatuses.MOVED);
    await repo.reviewSessions.setChunkRead(key, { chunkId: "c1", read: true });
    await repo.reviewSessions.reclassifyGroup(key, {
      changeGroupId: "g1",
      category: ChangeGroupCategories.BUGFIX,
    });
    await repo.reviewSessions.recordPublishedDrafts(key, {
      draftIds: [],
      githubReviewId: 909n,
    });

    const snapshot = await repo.reviewSessions.get(key);
    expect(snapshot?.session.id).toBe(reviewSessionId);
    expect(snapshot?.draftComments).toHaveLength(1);
    expect(snapshot?.draftComments[0]?.status).toBe(DraftCommentStatuses.DRAFT);
    expect(snapshot?.draftComments[0]?.anchorStatus).toBe(AnchorStatuses.MOVED);
    expect(snapshot?.readMarks).toHaveLength(1);
    expect(snapshot?.reclassifications).toHaveLength(1);
    expect(snapshot?.submittedReviews).toHaveLength(1);
  });

  it("keeps the per-subject writes idempotent on their natural keys", async () => {
    const { handle } = shared;
    const briefId = await seedBrief(handle, CTX_A);
    const repo = createTenantRepository(handle, CTX_A);
    await openSession(handle, CTX_A, briefId);
    const key = { briefId, reviewerId: REVIEWER };
    const sessions = repo.reviewSessions;

    await sessions.setChunkRead(key, { chunkId: "c1", read: true });
    await sessions.setChunkRead(key, { chunkId: "c1", read: true });
    await sessions.reclassifyGroup(key, {
      changeGroupId: "g1",
      category: ChangeGroupCategories.BUGFIX,
    });
    await sessions.reclassifyGroup(key, {
      changeGroupId: "g1",
      category: ChangeGroupCategories.NEW_FEATURE,
    });
    await sessions.recordReplyReview(key, 909n);
    await sessions.recordReplyReview(key, 909n);

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
    const { handle } = shared;
    const briefId = await seedBrief(handle, CTX_A);
    const repo = createTenantRepository(handle, CTX_A);
    const key = { briefId, reviewerId: REVIEWER };

    const first = await seedDraft(handle, briefId, LINE_ANCHOR, "publish me");
    await seedDraft(
      handle,
      briefId,
      { ...LINE_ANCHOR, startLine: 2, endLine: 2 },
      "leave me",
    );
    const flipped = await repo.reviewSessions.recordPublishedDrafts(key, {
      draftIds: [first.id],
    });

    expect(flipped).toEqual({ ok: true, value: 1 });
    const listed = await repo.reviewSessions.listDrafts(key);
    expect(listed.ok && listed.value.map((row) => row.status)).toEqual([
      DraftCommentStatuses.SUBMITTED,
      DraftCommentStatuses.DRAFT,
    ]);
  });
});

describe("the draft operations", () => {
  it("adds a draft as the session's first write", async () => {
    const { client, handle } = shared;
    const briefId = await seedBrief(handle, CTX_A);
    const sessions = createTenantRepository(handle, CTX_A).reviewSessions;
    const key = { briefId, reviewerId: REVIEWER };

    const added = await sessions.addDraft(key, {
      anchor: LINE_ANCHOR,
      body: "first",
    });

    expect(added.ok && added.value.body).toBe("first");
    expect(await countRows(client, "review_session")).toBe(1);
    const snapshot = await sessions.get(key);
    expect(snapshot?.draftComments.map((row) => row.anchor)).toEqual([
      LINE_ANCHOR,
    ]);
  });

  it("refuses the 65th unposted draft and counts no published one", async () => {
    const { handle } = shared;
    const briefId = await seedBrief(handle, CTX_A);
    const sessions = createTenantRepository(handle, CTX_A).reviewSessions;
    const key = { briefId, reviewerId: REVIEWER };
    const held: bigint[] = [];
    for (let index = 0; index < 64; index++) {
      const added = await sessions.addDraft(key, {
        anchor: LINE_ANCHOR,
        body: `draft ${index}`,
      });
      if (added.ok) {
        held.push(added.value.id);
      }
    }

    const refused = await sessions.addDraft(key, {
      anchor: LINE_ANCHOR,
      body: "one too many",
    });
    expect(!refused.ok && refused.error.code).toBe(
      ReviewSessionErrorCodes.DRAFT_LIMIT_REACHED,
    );
    expect((await sessions.get(key))?.draftComments).toHaveLength(64);

    await sessions.recordPublishedDrafts(key, { draftIds: held.slice(0, 1) });
    const freed = await sessions.addDraft(key, {
      anchor: LINE_ANCHOR,
      body: "fits again",
    });
    expect(freed.ok).toBe(true);
  });

  it("edits, re-anchors and deletes a draft the session holds", async () => {
    const { client, handle } = shared;
    const briefId = await seedBrief(handle, CTX_A);
    const sessions = createTenantRepository(handle, CTX_A).reviewSessions;
    const key = { briefId, reviewerId: REVIEWER };
    const added = await sessions.addDraft(key, {
      anchor: LINE_ANCHOR,
      body: "first",
    });
    if (!added.ok) {
      throw new Error("draft seed failed");
    }
    const draftId = added.value.id;
    await stampAnchorStatus(client, draftId, AnchorStatuses.MOVED);

    const edited = await sessions.editDraft(key, draftId, "re-worded");
    const fileAnchor = { kind: CommentAnchorKinds.FILE, file: "src/b.ts" };
    const moved = await sessions.reanchorDraft(key, draftId, fileAnchor);

    expect(edited.ok && edited.value.body).toBe("re-worded");
    expect(moved.ok && moved.value.anchor).toEqual(fileAnchor);
    expect(moved.ok && moved.value.anchorStatus).toBeNull();
    const deleted = await sessions.deleteDraft(key, draftId);
    expect(deleted.ok && deleted.value.id).toBe(draftId);
    expect((await sessions.get(key))?.draftComments).toEqual([]);
  });

  it("refuses an unknown or published draft and moves nothing", async () => {
    const { handle } = shared;
    const briefId = await seedBrief(handle, CTX_A);
    const sessions = createTenantRepository(handle, CTX_A).reviewSessions;
    const key = { briefId, reviewerId: REVIEWER };
    const added = await sessions.addDraft(key, {
      anchor: LINE_ANCHOR,
      body: "published",
    });
    if (!added.ok) {
      throw new Error("draft seed failed");
    }
    const published = added.value.id;
    await sessions.recordPublishedDrafts(key, { draftIds: [published] });

    const refusals = [
      await sessions.editDraft(key, published, "edited"),
      await sessions.reanchorDraft(key, published, LINE_ANCHOR),
      await sessions.deleteDraft(key, published),
    ];

    expect(
      refusals.map((refusal) => !refusal.ok && refusal.error.code),
    ).toEqual([
      ReviewSessionErrorCodes.DRAFT_ALREADY_PUBLISHED,
      ReviewSessionErrorCodes.DRAFT_ALREADY_PUBLISHED,
      ReviewSessionErrorCodes.DRAFT_ALREADY_PUBLISHED,
    ]);
    await expect(
      sessions.editDraft(key, 987654321n, "edited"),
    ).rejects.toBeInstanceOf(ScopeViolationError);
    await expect(
      sessions.reanchorDraft(key, 987654321n, LINE_ANCHOR),
    ).rejects.toBeInstanceOf(ScopeViolationError);
    await expect(sessions.deleteDraft(key, 987654321n)).rejects.toBeInstanceOf(
      ScopeViolationError,
    );
    expect((await sessions.get(key))?.draftComments).toEqual([
      expect.objectContaining({ id: published, body: "published" }),
    ]);
  });
});

describe("publish claims", () => {
  const CLAIMED_AT = new Date("2026-10-06T12:00:00.000Z");

  function shiftClock(by: number): Date {
    return new Date(CLAIMED_AT.getTime() + by);
  }

  async function openWorld() {
    const { client, handle } = shared;
    const briefId = await seedBrief(handle, CTX_A);
    const sessions = createTenantRepository(handle, CTX_A).reviewSessions;
    const key = { briefId, reviewerId: REVIEWER };
    const first = await seedDraft(handle, briefId, LINE_ANCHOR, "first");
    const second = await seedDraft(handle, briefId, LINE_ANCHOR, "second");
    return {
      client,
      handle,
      sessions,
      key,
      first: first.id,
      second: second.id,
    };
  }

  async function claimOrThrow(
    sessions: ReturnType<typeof createTenantRepository>["reviewSessions"],
    key: { briefId: BriefRowId; reviewerId: ReviewerId },
    draftIds: readonly bigint[],
    now: Date,
  ): Promise<string> {
    const claimed = await sessions.claimDrafts(key, { draftIds, now });
    if (!claimed.ok) {
      throw new Error(`claim failed: ${claimed.error.code}`);
    }
    return claimed.value.claim;
  }

  it("claims the drafts under one token and keeps them drafts", async () => {
    const { sessions, key, first, second } = await openWorld();

    const claimed = await sessions.claimDrafts(key, {
      draftIds: [first, second],
      now: CLAIMED_AT,
    });

    if (!claimed.ok) {
      throw new Error("claim refused");
    }
    expect(claimed.value.drafts.map((row) => row.id)).toEqual([first, second]);
    const drafts = (await sessions.get(key))?.draftComments ?? [];
    expect(drafts.map((row) => row.publishClaim)).toEqual([
      claimed.value.claim,
      claimed.value.claim,
    ]);
    expect(drafts.map((row) => row.publishClaimedAt)).toEqual([
      CLAIMED_AT,
      CLAIMED_AT,
    ]);
    expect(drafts.map((row) => row.status)).toEqual([
      DraftCommentStatuses.DRAFT,
      DraftCommentStatuses.DRAFT,
    ]);
  });

  it("tells a pending claim from one in doubt at the lease", () => {
    const claimed = { publishClaimedAt: CLAIMED_AT };

    expect(deriveClaimState({ publishClaimedAt: null }, CLAIMED_AT)).toBe(
      ClaimStates.UNCLAIMED,
    );
    expect(
      deriveClaimState(claimed, shiftClock(PUBLISH_CLAIM_LEASE_MS - 1)),
    ).toBe(ClaimStates.PENDING);
    expect(deriveClaimState(claimed, shiftClock(PUBLISH_CLAIM_LEASE_MS))).toBe(
      ClaimStates.IN_DOUBT,
    );
  });

  it("refuses a second claim as pending inside the lease, in doubt after", async () => {
    const { sessions, key, first } = await openWorld();
    await claimOrThrow(sessions, key, [first], CLAIMED_AT);

    const inside = await sessions.claimDrafts(key, {
      draftIds: [first],
      now: shiftClock(PUBLISH_CLAIM_LEASE_MS - 1),
    });
    const after = await sessions.claimDrafts(key, {
      draftIds: [first],
      now: shiftClock(PUBLISH_CLAIM_LEASE_MS),
    });

    expect(!inside.ok && inside.error.code).toBe(
      ReviewSessionErrorCodes.DRAFT_PUBLISH_PENDING,
    );
    expect(!after.ok && after.error.code).toBe(
      ReviewSessionErrorCodes.DRAFT_PUBLISH_IN_DOUBT,
    );
  });

  it("refuses an unknown, published or orphaned draft and claims none", async () => {
    const { client, handle, sessions, key, first, second } = await openWorld();
    const orphaned = await seedDraft(handle, key.briefId, LINE_ANCHOR, "x");
    await stampAnchorStatus(client, orphaned.id, AnchorStatuses.ORPHANED);
    await sessions.recordPublishedDrafts(key, { draftIds: [second] });

    await expect(
      sessions.claimDrafts(key, { draftIds: [first, 987654321n] }),
    ).rejects.toBeInstanceOf(ScopeViolationError);
    const refusals = [
      await sessions.claimDrafts(key, { draftIds: [first, second] }),
      await sessions.claimDrafts(key, { draftIds: [first, orphaned.id] }),
    ];

    expect(
      refusals.map((refusal) => !refusal.ok && refusal.error.code),
    ).toEqual([
      ReviewSessionErrorCodes.DRAFT_ALREADY_PUBLISHED,
      ReviewSessionErrorCodes.DRAFT_ANCHOR_ORPHANED,
    ]);
    const drafts = (await sessions.get(key))?.draftComments ?? [];
    expect(drafts.map((row) => row.publishClaim)).toEqual([null, null, null]);
  });

  it("refuses edit and re-anchor on a claimed draft, pending or in doubt", async () => {
    const { sessions, key, first, second } = await openWorld();
    await claimOrThrow(sessions, key, [first], new Date());
    const stale = new Date(Date.now() - PUBLISH_CLAIM_LEASE_MS);
    await claimOrThrow(sessions, key, [second], stale);

    const refusals = [
      await sessions.editDraft(key, first, "edited"),
      await sessions.reanchorDraft(key, first, LINE_ANCHOR),
      await sessions.editDraft(key, second, "edited"),
      await sessions.reanchorDraft(key, second, LINE_ANCHOR),
    ];

    expect(
      refusals.map((refusal) => !refusal.ok && refusal.error.code),
    ).toEqual([
      ReviewSessionErrorCodes.DRAFT_PUBLISH_PENDING,
      ReviewSessionErrorCodes.DRAFT_PUBLISH_PENDING,
      ReviewSessionErrorCodes.DRAFT_PUBLISH_IN_DOUBT,
      ReviewSessionErrorCodes.DRAFT_PUBLISH_IN_DOUBT,
    ]);
    const drafts = (await sessions.get(key))?.draftComments ?? [];
    expect(drafts.map((row) => row.body)).toEqual(["first", "second"]);
  });

  it("refuses to delete a pending claim and deletes one in doubt", async () => {
    const { sessions, key, first, second } = await openWorld();
    await claimOrThrow(sessions, key, [first], new Date());
    const stale = new Date(Date.now() - PUBLISH_CLAIM_LEASE_MS);
    await claimOrThrow(sessions, key, [second], stale);

    const pending = await sessions.deleteDraft(key, first);
    const inDoubt = await sessions.deleteDraft(key, second);

    expect(!pending.ok && pending.error.code).toBe(
      ReviewSessionErrorCodes.DRAFT_PUBLISH_PENDING,
    );
    expect(inDoubt.ok && inDoubt.value.id).toBe(second);
    const drafts = (await sessions.get(key))?.draftComments ?? [];
    expect(drafts.map((row) => row.id)).toEqual([first]);
  });

  it("settles the claim's drafts and records the review", async () => {
    const { sessions, key, first, second } = await openWorld();
    const claim = await claimOrThrow(sessions, key, [first], CLAIMED_AT);

    const settled = await sessions.settleClaim(key, {
      claim,
      githubReviewId: 4242n,
    });

    expect(settled).toEqual({ ok: true, value: 1 });
    const snapshot = await sessions.get(key);
    expect(
      snapshot?.draftComments.map((row) => [
        row.id,
        row.status,
        row.publishClaim,
        row.publishClaimedAt,
      ]),
    ).toEqual([
      [first, DraftCommentStatuses.SUBMITTED, null, null],
      [second, DraftCommentStatuses.DRAFT, null, null],
    ]);
    expect(snapshot?.submittedReviews.map((row) => row.githubReviewId)).toEqual(
      [4242n],
    );
  });

  it("releases the claim and leaves the drafts editable", async () => {
    const { sessions, key, first } = await openWorld();
    const claim = await claimOrThrow(sessions, key, [first], new Date());

    const released = await sessions.releaseClaim(key, { claim });
    const edited = await sessions.editDraft(key, first, "edited");

    expect(released).toEqual({ ok: true, value: 1 });
    expect(edited.ok && edited.value.status).toBe(DraftCommentStatuses.DRAFT);
    expect(edited.ok && edited.value.publishClaim).toBeNull();
  });

  it("answers not found to settle or release without a session", async () => {
    const { client, handle } = shared;
    const briefId = await seedBrief(handle, CTX_A);
    const sessions = createTenantRepository(handle, CTX_A).reviewSessions;
    const key = { briefId, reviewerId: REVIEWER };
    const claim = "00000000-0000-4000-8000-000000000000";

    const settled = await sessions.settleClaim(key, { claim });
    const released = await sessions.releaseClaim(key, { claim });

    expect(
      [settled, released].map((done) => !done.ok && done.error.code),
    ).toEqual([
      ReviewSessionErrorCodes.SESSION_NOT_FOUND,
      ReviewSessionErrorCodes.SESSION_NOT_FOUND,
    ]);
    expect(await countRows(client, "review_session")).toBe(0);
  });

  it("rejects a claim token stored without its time", async () => {
    const { client, first } = await openWorld();

    await expectCheckViolation(
      client.query(
        "update review_draft_comment set publish_claim = gen_random_uuid() where id = $1",
        [first.toString()],
      ),
      "review_draft_comment_publish_claim_pair_check",
    );
  });
});

/** The one flag the default Brief fires, as a dismissal names it. */
const FLAG = {
  filePath: "src/app.ts",
  attribute: "sql-injection",
  regionStart: 10,
  regionEnd: 20,
};

function makeDismissal(anchor: typeof FLAG, reason: string) {
  return { ...anchor, decision: DispositionDecisions.DISMISSED, reason };
}

describe("the review work operations", () => {
  async function openWorld(body = BRIEF_BODY) {
    const { client, handle } = shared;
    const briefId = await seedBrief(handle, CTX_A, 7, body);
    const sessions = createTenantRepository(handle, CTX_A).reviewSessions;
    return { client, sessions, key: { briefId, reviewerId: REVIEWER } };
  }

  it("marks and clears a Chunk read, a repeat changing nothing", async () => {
    const { client, sessions, key } = await openWorld();

    const marked = await sessions.setChunkRead(key, {
      chunkId: "c1",
      read: true,
    });
    await sessions.setChunkRead(key, { chunkId: "c1", read: true });
    expect(marked).toEqual({ ok: true, value: { chunkId: "c1", read: true } });
    expect(await countRows(client, "review_read_mark")).toBe(1);

    await sessions.setChunkRead(key, { chunkId: "c1", read: false });
    await sessions.setChunkRead(key, { chunkId: "c1", read: false });
    expect(await countRows(client, "review_read_mark")).toBe(0);
  });

  it("refuses a read mark past the Brief's Chunk count", async () => {
    const { client, sessions, key } = await openWorld();
    await sessions.setChunkRead(key, { chunkId: "c1", read: true });
    await sessions.setChunkRead(key, { chunkId: "c2", read: true });

    const refused = await sessions.setChunkRead(key, {
      chunkId: "c3",
      read: true,
    });
    const again = await sessions.setChunkRead(key, {
      chunkId: "c1",
      read: true,
    });

    expect(!refused.ok && refused.error.code).toBe(
      ReviewSessionErrorCodes.SESSION_RECORD_LIMIT_REACHED,
    );
    expect(again.ok).toBe(true);
    expect(await countRows(client, "review_read_mark")).toBe(2);
  });

  it.each([true, false])(
    "marks every Chunk and unattributed file read, stored counts %s",
    async (stored) => {
      const withRemainder = JSON.stringify({
        ...JSON.parse(BRIEF_BODY),
        unattributed: [
          { file: "src/left.ts", addedRanges: [{ start: 1, end: 2 }] },
          { file: "src/over.ts", addedRanges: [{ start: 4, end: 4 }] },
        ],
      });
      const { client, sessions, key } = await openWorld(withRemainder);
      if (!stored) {
        await client.query(
          `update brief set session_chunk_count = null,
             session_group_count = null, session_flag_count = null
           where id = $1`,
          [key.briefId.toString()],
        );
      }
      const marked = [];
      for (const chunkId of ["u-left", "u-over", "c1", "c2"]) {
        marked.push(await sessions.setChunkRead(key, { chunkId, read: true }));
      }

      const refused = await sessions.setChunkRead(key, {
        chunkId: "c3",
        read: true,
      });

      expect(marked.every((mark) => mark.ok)).toBe(true);
      expect(!refused.ok && refused.error.code).toBe(
        ReviewSessionErrorCodes.SESSION_RECORD_LIMIT_REACHED,
      );
    },
  );

  it("refuses a new group past the Brief's groups, rewrites a held one", async () => {
    const { sessions, key } = await openWorld();
    await sessions.reclassifyGroup(key, {
      changeGroupId: "g1",
      category: ChangeGroupCategories.BUGFIX,
    });

    const rewritten = await sessions.reclassifyGroup(key, {
      changeGroupId: "g1",
      category: ChangeGroupCategories.NEW_FEATURE,
    });
    const refused = await sessions.reclassifyGroup(key, {
      changeGroupId: "g2",
      category: ChangeGroupCategories.BUGFIX,
    });

    expect(rewritten.ok && rewritten.value.category).toBe(
      ChangeGroupCategories.NEW_FEATURE,
    );
    expect(!refused.ok && refused.error.code).toBe(
      ReviewSessionErrorCodes.SESSION_RECORD_LIMIT_REACHED,
    );
    expect((await sessions.get(key))?.reclassifications).toHaveLength(1);
  });

  it("decides a held flag again at the cap and answers the rows written", async () => {
    const { sessions, key } = await openWorld();
    await sessions.decideRisks(key, [makeDismissal(FLAG, "first")]);

    const again = await sessions.decideRisks(key, [
      makeDismissal(FLAG, "second"),
    ]);

    expect(again).toEqual({ ok: true, value: 1 });
    expect((await sessions.get(key))?.dispositions).toEqual([
      expect.objectContaining({ reason: "second" }),
    ]);
  });

  it("refuses a decision list past the flags and leaves no session", async () => {
    const { client, sessions, key } = await openWorld();
    const other = { ...FLAG, attribute: "no-tests" };

    const refused = await sessions.decideRisks(key, [
      makeDismissal(FLAG, "fine"),
      makeDismissal(other, "fine"),
    ]);

    expect(!refused.ok && refused.error.code).toBe(
      ReviewSessionErrorCodes.SESSION_RECORD_LIMIT_REACHED,
    );
    expect(await countRows(client, "review_session")).toBe(0);
    expect(await countRows(client, "disposition")).toBe(0);
  });

  it("does not count a carried decision against the Brief's flags", async () => {
    const { client, sessions, key } = await openWorld();
    const session = await sessions.setOutcome(key, ReviewOutcomes.COMMENT);
    if (!session.ok) {
      throw new Error("session seed failed");
    }
    await client.query(
      `insert into disposition
         (installation_id, review_session_id, file_path, attribute,
          region_start, region_end, decision, carry_status, decided_at)
       values ($1, $2, 'src/gone.ts', 'no-tests', 1, 2, 'dismissed', 'dropped', now())`,
      [TENANT_A.toString(), session.value.id.toString()],
    );

    const decided = await sessions.decideRisks(key, [
      makeDismissal(FLAG, "fine"),
    ]);
    const refused = await sessions.decideRisks(key, [
      makeDismissal({ ...FLAG, attribute: "no-tests" }, "fine"),
    ]);

    expect(decided.ok).toBe(true);
    expect(!refused.ok && refused.error.code).toBe(
      ReviewSessionErrorCodes.SESSION_RECORD_LIMIT_REACHED,
    );
  });

  it("reopens decisions and answers how many it removed", async () => {
    const { sessions, key } = await openWorld();
    await sessions.decideRisks(key, [makeDismissal(FLAG, "fine")]);

    const reopened = await sessions.reopenRisks(key, [FLAG, FLAG]);
    const again = await sessions.reopenRisks(key, [FLAG]);

    expect(reopened).toEqual({ ok: true, value: 1 });
    expect(again).toEqual({ ok: true, value: 0 });
  });

  it("refuses a capped first write on an empty Brief without a session", async () => {
    const { client, sessions, key } = await openWorld(
      '{"changeGroups":[],"chunks":[]}',
    );

    const refused = await sessions.setChunkRead(key, {
      chunkId: "c1",
      read: true,
    });

    expect(!refused.ok && refused.error.code).toBe(
      ReviewSessionErrorCodes.SESSION_RECORD_LIMIT_REACHED,
    );
    expect(await countRows(client, "review_session")).toBe(0);
  });

  it("skips the caps when the Brief body cannot be read", async () => {
    const { client, sessions, key } = await openWorld("{ not json");

    const marked = await sessions.setChunkRead(key, {
      chunkId: "c1",
      read: true,
    });
    const reclassified = await sessions.reclassifyGroup(key, {
      changeGroupId: "g1",
      category: ChangeGroupCategories.BUGFIX,
    });
    const decided = await sessions.decideRisks(key, [
      makeDismissal(FLAG, "fine"),
    ]);

    expect(marked.ok).toBe(true);
    expect(reclassified.ok).toBe(true);
    expect(decided).toEqual({ ok: true, value: 1 });
    expect(await countRows(client, "review_session")).toBe(1);
  });

  it("caps a held session from the stored counts, never the body", async () => {
    const { client, sessions, key } = await openWorld();
    await sessions.setChunkRead(key, { chunkId: "c1", read: true });
    await client.query("update brief set body = '{ not json' where id = $1", [
      key.briefId.toString(),
    ]);

    const marked = await sessions.setChunkRead(key, {
      chunkId: "c2",
      read: true,
    });
    const refused = await sessions.setChunkRead(key, {
      chunkId: "c3",
      read: true,
    });

    expect(marked.ok).toBe(true);
    expect(!refused.ok && refused.error.code).toBe(
      ReviewSessionErrorCodes.SESSION_RECORD_LIMIT_REACHED,
    );
  });

  it("falls back to the body when a Brief predates the stored counts", async () => {
    const { client, sessions, key } = await openWorld();
    await client.query(
      `update brief set session_chunk_count = null,
         session_group_count = null, session_flag_count = null
       where id = $1`,
      [key.briefId.toString()],
    );
    await sessions.setChunkRead(key, { chunkId: "c1", read: true });
    await sessions.setChunkRead(key, { chunkId: "c2", read: true });

    const refused = await sessions.setChunkRead(key, {
      chunkId: "c3",
      read: true,
    });
    const repeated = await sessions.setChunkRead(key, {
      chunkId: "c1",
      read: true,
    });

    expect(!refused.ok && refused.error.code).toBe(
      ReviewSessionErrorCodes.SESSION_RECORD_LIMIT_REACHED,
    );
    expect(repeated.ok).toBe(true);
  });

  it("records a reply's review only on a session that exists", async () => {
    const { client, sessions, key } = await openWorld();

    const absent = await sessions.recordReplyReview(key, 77n);
    expect(!absent.ok && absent.error.code).toBe(
      ReviewSessionErrorCodes.SESSION_NOT_FOUND,
    );
    expect(await countRows(client, "review_session")).toBe(0);

    await sessions.setOutcome(key, ReviewOutcomes.COMMENT);
    const recorded = await sessions.recordReplyReview(key, 77n);
    expect(recorded.ok && recorded.value.githubReviewId).toBe(77n);
  });
});

describe("reviewSessions tenancy containment", () => {
  it("B cannot open a session against A's brief", async () => {
    const { client, handle } = shared;
    const briefId = await seedBrief(handle, CTX_A);

    await expect(
      createTenantRepository(handle, CTX_B).reviewSessions.setOutcome(
        { briefId, reviewerId: REVIEWER },
        ReviewOutcomes.APPROVE,
      ),
    ).rejects.toBeInstanceOf(ScopeViolationError);

    expect(await countRows(client, "review_session")).toBe(0);
  });

  it("B cannot read A's session", async () => {
    const { handle } = shared;
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
    const { handle } = shared;
    const briefA = await seedBrief(handle, CTX_A, 7);
    const briefB = await seedBrief(handle, CTX_B, 8);

    const a = await openSession(handle, CTX_A, briefA);
    const b = await openSession(handle, CTX_B, briefB);

    expect(a.installationId).toBe(TENANT_A);
    expect(b.installationId).toBe(TENANT_B);
    expect(a.reviewOutcome).toBe(ReviewOutcomes.COMMENT);
  });
});
