// Any session write may materialize carried state atomically before applying its action.
// Pre-materialization draft ids must resolve to copies; frozen sessions refuse all writes.
// Repeated read marks are idempotent and every write inherits the router scope gate.
import {
  createTenantRepository,
  PUBLISH_CLAIM_LEASE_MS,
  WriteClassifications,
} from "persistence";
import { ChangeGroupCategories, ReviewOutcomes } from "types/reviews";
import {
  DispositionDecisions,
  DispositionEvidenceKinds,
} from "types/dispositions";
import type { KeyProvider } from "persistence";
import { CommentAnchorKinds, DraftCommentSides } from "types/comments";
import { createPgliteHarness, type PgliteHarness } from "persistence/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod/v4";
import { createApp, type ApiApp } from "../../src/index";
import { testLogger } from "../logging";
import {
  CTX,
  REPO_ID,
  REVIEWER,
  seedApiToken,
  seedBrief,
  seedHop,
  seedHopInsideFlaggedRegion,
  seedOrphanedDraft,
  seedPreviousWork,
  seedPullRequest,
  seedSession,
  stubGitHub,
} from "./fixtures";
import {
  PR_NUMBER,
  SECRET,
  buildAuthDeps,
  createKeyProvider,
  SAME_ORIGIN_HEADERS,
} from "../fixtures";

function pathFor(suffix: string, head: string): string {
  return `/api/repos/${REPO_ID}/pulls/${PR_NUMBER}/session${suffix}?base=base&head=${head}`;
}

/** The wire code an error response carries. */
async function readWireCode(res: Response): Promise<string> {
  return z.object({ code: z.string() }).parse(await res.json()).code;
}

/** The created draft's row id, as the write route reports it. */
async function readDraftId(res: Response): Promise<string> {
  const body: unknown = await res.json();
  if (
    typeof body !== "object" ||
    body === null ||
    !("draftId" in body) ||
    typeof body.draftId !== "string"
  ) {
    throw new Error("create-draft-comment returned no draft id");
  }
  return body.draftId;
}

/**
 * The draft-comment subject ids the read route hands out for the orphaned
 * carried anchors, before materialization those are the PREVIOUS session's
 * rows. A null id would fail the parse, which is the point.
 */
function draftSubjectIds(body: unknown): string[] {
  return z
    .object({
      attention: z.array(
        z.object({
          subject: z.object({ type: z.string(), id: z.string().nullable() }),
        }),
      ),
    })
    .parse(body)
    .attention.filter((row) => row.subject.type === "draft-comment")
    .map((row) => z.string().parse(row.subject.id));
}

/** The flag the fixture Brief fires on, by the anchor every risk write names. */
const FLAG = {
  filePath: "src/app.ts",
  attribute: "no-tests",
  regionStart: 10,
  regionEnd: 12,
};

/** The review outcome the session read reports. */
async function readOutcome(res: Response): Promise<string> {
  return z.object({ reviewOutcome: z.string() }).parse(await res.json())
    .reviewOutcome;
}

const DRAFT = {
  filePath: "src/app.ts",
  side: "new",
  startLine: 10,
  endLine: 12,
  body: "this allocation is unbounded",
};

describe("the Review Session writes", () => {
  let harness: PgliteHarness;
  let app: ApiApp;
  let kp: KeyProvider;
  let cookie: string;

  beforeEach(async () => {
    harness = await createPgliteHarness();
    kp = createKeyProvider();
    app = createApp({
      logger: testLogger(),
      handle: harness.handle,
      webhookSecret: SECRET,
      auth: buildAuthDeps(kp),
      github: {
        fetchPullRequestConversation: () => {
          throw new Error("conversation port must not be called");
        },
        listRepoCollaborators: () => {
          throw new Error("collaborators port must not be called");
        },
        commitAttachment: async () => {
          throw new Error("attachment port must not be called in this suite");
        },
        deleteAttachmentBranch: async () => {
          throw new Error("attachment port must not be called in this suite");
        },
      },
    });
    stubGitHub();
    cookie = await seedSession(harness.handle, kp);
    await seedPullRequest(harness.handle);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    await harness.close();
  });

  async function write(
    method: string,
    suffix: string,
    head: string,
    body?: unknown,
  ): Promise<Response> {
    const init: RequestInit = {
      method,
      headers: {
        ...SAME_ORIGIN_HEADERS,
        Cookie: `__Host-mergebrief_session=${cookie}`,
        "content-type": "application/json",
      },
    };

    if (body !== undefined) init.body = JSON.stringify(body);

    return app.request(pathFor(suffix, head), init);
  }

  async function read(head: string): Promise<Response> {
    return app.request(pathFor("", head), {
      headers: { Cookie: `__Host-mergebrief_session=${cookie}` },
    });
  }

  async function countRows(table: string): Promise<number> {
    const rows = await harness.raw(`select count(*)::int as n from ${table}`);
    return Number(rows[0]?.["n"] ?? -1);
  }

  it("writes the carry-over on whichever write lands first", async () => {
    const previous = await seedBrief(harness.handle, 1);
    const current = await seedBrief(harness.handle, 2);
    await seedPreviousWork(harness.handle, previous);
    // One session, the previous one, and nothing on the new Brief yet.
    expect(await countRows("review_session")).toBe(1);

    // A read mark owns none of the carried subjects and still creates the
    // session and copies the carried work: materialization belongs to no
    // single operation.
    const res = await write("PUT", "/chunks/c1/read", "head-2", { read: true });

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await countRows("review_session")).toBe(2);
    const snapshot = await createTenantRepository(
      harness.handle,
      CTX,
    ).reviewSessions.get({
      briefId: current,
      reviewerId: REVIEWER,
    });
    // The carried draft comment and reclassification, plus the write.
    expect(snapshot?.draftComments).toHaveLength(1);
    expect(snapshot?.reclassifications).toHaveLength(1);
    expect(snapshot?.readMarks.map((row) => row.chunkId)).toEqual(["c1"]);
  });

  it("writes NOTHING when the Brief the carry-over needs will not parse", async () => {
    // The read route's failure has a worse twin here: empty facts would write
    // every carried decision to the new session as DROPPED, permanently.
    const previous = await seedBrief(harness.handle, 1);
    await seedBrief(harness.handle, 2, "{ not json");
    await seedPreviousWork(harness.handle, previous);
    expect(await countRows("review_session")).toBe(1);

    const res = await write("PUT", "/chunks/c1/read", "head-2", { read: true });

    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ code: "internal-error" });
    expect(await countRows("review_session")).toBe(1);
  });

  it("applies the copy and the write together, or neither", async () => {
    const previous = await seedBrief(harness.handle, 1);
    await seedBrief(harness.handle, 2);
    await seedPreviousWork(harness.handle, previous);
    const carriedBefore = await countRows("review_draft_comment");

    // The carried `g1` fills the Brief's one group, so a second group is
    // refused after the copy, and the session and the copied rows go back
    // with the transaction.
    const refused = await write("PUT", "/groups/g2/classification", "head-2", {
      category: ChangeGroupCategories.BUGFIX,
    });

    expect(refused.status).toBe(409);
    expect(await readWireCode(refused)).toBe("session-record-limit-reached");
    expect(await countRows("review_session")).toBe(1);
    expect(await countRows("review_draft_comment")).toBe(carriedBefore);
  });

  it("409s a read mark or a decision past the Brief's own counts", async () => {
    await seedBrief(harness.handle, 1);
    const third = { ...FLAG, attribute: "no-docs" };

    const marks = [
      await write("PUT", "/chunks/c1/read", "head-1", { read: true }),
      await write("PUT", "/chunks/c2/read", "head-1", { read: true }),
      await write("PUT", "/chunks/c3/read", "head-1", { read: true }),
      await write("PUT", "/chunks/c1/read", "head-1", { read: true }),
    ];
    const decided = await write("POST", "/risks/dismiss", "head-1", {
      flags: [FLAG, { ...FLAG, attribute: "no-error-path" }, third],
      reason: "covered elsewhere",
    });

    expect(marks.map((res) => res.status)).toEqual([200, 200, 409, 200]);
    expect(await readWireCode(marks[2]!)).toBe("session-record-limit-reached");
    expect(decided.status).toBe(409);
    expect(await readWireCode(decided)).toBe("session-record-limit-reached");
    expect(await countRows("review_read_mark")).toBe(2);
    expect(await countRows("disposition")).toBe(0);
  });

  it("refuses every write to a frozen session with 409", async () => {
    await seedBrief(harness.handle, 1);
    // A draft on the older Brief, addressable by row id once it is frozen.
    const draftId = await readDraftId(
      await write("POST", "/comments", "head-1", DRAFT),
    );
    const current = await seedBrief(harness.handle, 2);
    // The reviewer writes the NEWER Brief's session, that, and only
    // that, freezes the older one.
    const opened = await createTenantRepository(
      harness.handle,
      CTX,
    ).reviewSessions.setOutcome(
      { briefId: current, reviewerId: REVIEWER },
      ReviewOutcomes.COMMENT,
    );
    expect(opened.ok).toBe(true);

    const refusals = await Promise.all([
      write("POST", "/comments", "head-1", DRAFT),
      write("PATCH", `/comments/${draftId}`, "head-1", { body: "edited" }),
      write("PUT", `/comments/${draftId}/anchor`, "head-1", {
        filePath: "src/app.ts",
        side: "new",
        startLine: 40,
        endLine: 41,
      }),
      write("DELETE", `/comments/${draftId}`, "head-1"),
      write("PUT", "/chunks/c1/read", "head-1", { read: true }),
      write("PUT", "/groups/g1/classification", "head-1", {
        category: ChangeGroupCategories.BUGFIX,
      }),
      write("POST", "/risks/dismiss", "head-1", {
        flags: [FLAG],
        reason: "not on this path",
      }),
      write("POST", "/risks/address", "head-1", {
        flags: [{ ...FLAG, evidence: { kind: "manual-note", ref: "checked" } }],
      }),
      write("POST", "/risks/reopen", "head-1", { flags: [FLAG] }),
      write("PUT", "/outcome", "head-1", { outcome: "approve" }),
    ]);

    expect(refusals.map((res) => res.status)).toEqual([
      409, 409, 409, 409, 409, 409, 409, 409, 409, 409,
    ]);
    expect(await refusals[0]!.json()).toEqual({
      error: expect.any(String),
      code: "pr-changed-since-read",
    });
  });

  it("keeps set-chunk-read idempotent under a repeat of the same boolean", async () => {
    await seedBrief(harness.handle, 1);

    expect(
      (await write("PUT", "/chunks/c1/read", "head-1", { read: true })).status,
    ).toBe(200);
    expect(
      (await write("PUT", "/chunks/c1/read", "head-1", { read: true })).status,
    ).toBe(200);
    expect(await countRows("review_read_mark")).toBe(1);

    // The unread half is the same operation carrying `false`, and repeating it
    // is just as safe.
    expect(
      (await write("PUT", "/chunks/c1/read", "head-1", { read: false })).status,
    ).toBe(200);
    expect(
      (await write("PUT", "/chunks/c1/read", "head-1", { read: false })).status,
    ).toBe(200);
    expect(await countRows("review_read_mark")).toBe(0);
  });

  it("edits, re-anchors and deletes a draft through the session that owns it", async () => {
    const briefId = await seedBrief(harness.handle, 1);
    const draftId = await readDraftId(
      await write("POST", "/comments", "head-1", DRAFT),
    );

    const edited = await write("PATCH", `/comments/${draftId}`, "head-1", {
      body: "on reflection, bounded",
    });
    const reanchored = await write(
      "PUT",
      `/comments/${draftId}/anchor`,
      "head-1",
      { filePath: "src/app.ts", side: "new", startLine: 40, endLine: 41 },
    );
    expect([edited.status, reanchored.status]).toEqual([200, 200]);

    const snapshot = await createTenantRepository(
      harness.handle,
      CTX,
    ).reviewSessions.get({
      briefId,
      reviewerId: REVIEWER,
    });
    expect(snapshot?.draftComments[0]).toMatchObject({
      body: "on reflection, bounded",
      anchor: expect.objectContaining({
        startLine: 40,
        endLine: 41,
      }),
      // The human placed it, so the carry-over verdict is settled.
      anchorStatus: null,
    });

    expect(
      (await write("DELETE", `/comments/${draftId}`, "head-1")).status,
    ).toBe(200);
    expect(await countRows("review_draft_comment")).toBe(0);
    // A second delete has nothing left to name.
    expect(
      (await write("DELETE", `/comments/${draftId}`, "head-1")).status,
    ).toBe(404);
  });

  it("stores a File comment with no line columns", async () => {
    const briefId = await seedBrief(harness.handle, 1);
    const created = await write("POST", "/comments", "head-1", {
      kind: CommentAnchorKinds.FILE,
      filePath: "src/app.ts",
      body: "on the file",
    });
    expect(created.status).toBe(201);

    const snapshot = await createTenantRepository(
      harness.handle,
      CTX,
    ).reviewSessions.get({
      briefId,
      reviewerId: REVIEWER,
    });
    expect(snapshot?.draftComments[0]).toMatchObject({
      anchor: {
        kind: CommentAnchorKinds.FILE,
        file: "src/app.ts",
      },
      body: "on the file",
    });
  });

  it("400s mixing the file kind with a line span", async () => {
    await seedBrief(harness.handle, 1);
    const mixed = await write("POST", "/comments", "head-1", {
      kind: CommentAnchorKinds.FILE,
      filePath: "src/app.ts",
      startLine: 10,
      body: "on the file",
    });
    expect(mixed.status).toBe(400);
    expect(await countRows("review_draft_comment")).toBe(0);
  });

  it("reanchors a Line comment onto a file", async () => {
    const briefId = await seedBrief(harness.handle, 1);
    const draftId = await readDraftId(
      await write("POST", "/comments", "head-1", DRAFT),
    );
    const reanchored = await write(
      "PUT",
      `/comments/${draftId}/anchor`,
      "head-1",
      { kind: CommentAnchorKinds.FILE, filePath: "src/app.ts" },
    );
    expect(reanchored.status).toBe(200);

    const snapshot = await createTenantRepository(
      harness.handle,
      CTX,
    ).reviewSessions.get({
      briefId,
      reviewerId: REVIEWER,
    });
    expect(snapshot?.draftComments[0]).toMatchObject({
      anchor: {
        kind: CommentAnchorKinds.FILE,
        file: "src/app.ts",
      },
      anchorStatus: null,
    });
  });

  it("stores a group reclassification as an override", async () => {
    const briefId = await seedBrief(harness.handle, 1);

    const res = await write("PUT", "/groups/g1/classification", "head-1", {
      category: ChangeGroupCategories.BUGFIX,
    });
    await write("PUT", "/groups/g1/classification", "head-1", {
      category: ChangeGroupCategories.NEW_FEATURE,
    });

    expect(res.status).toBe(200);
    expect(await countRows("review_group_reclassification")).toBe(1);
    const snapshot = await createTenantRepository(
      harness.handle,
      CTX,
    ).reviewSessions.get({
      briefId,
      reviewerId: REVIEWER,
    });
    expect(snapshot?.reclassifications[0]?.category).toBe(
      ChangeGroupCategories.NEW_FEATURE,
    );
  });

  it("resolves carried draft ids on every write after materialization", async () => {
    await seedBrief(harness.handle, 1);
    const draftId = await readDraftId(
      await write("POST", "/comments", "head-1", DRAFT),
    );
    await seedBrief(harness.handle, 2);
    // The SAME reviewer, one Brief later, with no session on it yet: the id
    // names the previous session's row, so this write copies that row over and
    // edits the copy.
    expect(
      (
        await write("PATCH", `/comments/${draftId}`, "head-2", {
          body: "edited",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await harness.raw("select body from review_draft_comment order by id")
      ).map((row) => row["body"]),
    ).toEqual([DRAFT.body, "edited"]);

    // Materialized now, and the same id still reaches the copy, the pointer
    // is a column on it, not a mapping that lived for one transaction.
    const deleted = await write("DELETE", `/comments/${draftId}`, "head-2");
    expect(deleted.status).toBe(200);
    // The row that went is the copy; the id that named it is still the
    // previous session's row, which survives.
    expect(await readDraftId(deleted)).not.toBe(draftId);
    expect(
      await harness.raw("select id::text as id from review_draft_comment"),
    ).toEqual([{ id: draftId }]);

    // The trade-off this accepts: that first write on Brief 2 froze Brief 1,
    // so every later Brief-1 write is 409, terminal for a screen still on it.
    expect(
      (await write("PATCH", `/comments/${draftId}`, "head-1", { body: "x" }))
        .status,
    ).toBe(409);
  });

  it("clears an orphaned carried anchor by the id the read handed out", async () => {
    const previous = await seedBrief(harness.handle, 1);
    await seedBrief(harness.handle, 2);
    await seedPreviousWork(harness.handle, previous);
    const [draftId] = draftSubjectIds(await (await read("head-2")).json());

    // The FIRST write of the session: it writes, copies, and lands on
    // the copy, the operation the attention item names, run straight off it.
    const res = await write("PUT", `/comments/${draftId}/anchor`, "head-2", {
      filePath: "src/app.ts",
      side: "new",
      startLine: 40,
      endLine: 41,
    });

    expect(res.status).toBe(200);
    expect(await countRows("review_session")).toBe(2);
    const rows = await harness.raw(
      "select id::text as id, start_line, anchor_status from review_draft_comment order by id",
    );
    // The previous session's row is untouched; the copy holds the placement.
    expect(rows).toEqual([
      { id: draftId, start_line: 10, anchor_status: null },
      { id: expect.any(String), start_line: 40, anchor_status: null },
    ]);
    expect(await readDraftId(res)).not.toBe(draftId);
  });

  it("clears every listed carried anchor and materializes on the first write", async () => {
    const previous = await seedBrief(harness.handle, 1);
    await seedBrief(harness.handle, 2);
    await seedPreviousWork(harness.handle, previous);
    await seedOrphanedDraft(harness.handle, previous);
    // Two items, one payload, the list is meant to be walked, so the second
    // id has to still work after the first write materialized the session.
    const [first, second] = draftSubjectIds(
      await (await read("head-2")).json(),
    );

    const cleared = [
      await write("DELETE", `/comments/${first}`, "head-2"),
      await write("PUT", `/comments/${second}/anchor`, "head-2", {
        filePath: "src/other.ts",
        side: "new",
        startLine: 40,
        endLine: 41,
      }),
    ];

    expect(cleared.map((res) => res.status)).toEqual([200, 200]);
    expect(await countRows("review_session")).toBe(2);
    // The previous session keeps both its rows; of the two copies, one was
    // deleted and one re-placed.
    expect(
      await harness.raw(
        "select id::text as id, start_line from review_draft_comment order by id",
      ),
    ).toEqual([
      { id: first, start_line: 10 },
      { id: second, start_line: 10 },
      { id: expect.any(String), start_line: 40 },
    ]);
  });

  it("404s a draft id that names neither session", async () => {
    const previous = await seedBrief(harness.handle, 1);
    await seedBrief(harness.handle, 2);
    await seedPreviousWork(harness.handle, previous);

    expect(
      (await write("DELETE", "/comments/987654321", "head-2")).status,
    ).toBe(404);
    // A refused write rolls back whole: no session, no copies, nothing frozen.
    expect(await countRows("review_session")).toBe(1);
  });

  it("leaves the session unmaterialized after a refused first edit", async () => {
    const previous = await seedBrief(harness.handle, 1);
    await seedBrief(harness.handle, 2);
    await seedPreviousWork(harness.handle, previous);

    const refused = await write("PATCH", "/comments/987654321", "head-2", {
      body: "edited",
    });

    expect(refused.status).toBe(404);
    const after = await read("head-2");
    expect(
      z.object({ materialized: z.boolean() }).parse(await after.json()),
    ).toEqual({ materialized: false });
  });

  it("409s an edit or a delete against a draft already published", async () => {
    const briefId = await seedBrief(harness.handle, 1);
    const draftId = await readDraftId(
      await write("POST", "/comments", "head-1", DRAFT),
    );
    // The publish itself is submit's job; here it is the state the edit meets.
    await createTenantRepository(
      harness.handle,
      CTX,
    ).reviewSessions.recordPublishedDrafts(
      { briefId, reviewerId: REVIEWER },
      { draftIds: [BigInt(draftId)] },
    );

    const refusals = await Promise.all([
      write("PATCH", `/comments/${draftId}`, "head-1", { body: "edited" }),
      write("PUT", `/comments/${draftId}/anchor`, "head-1", {
        filePath: "src/app.ts",
        side: "new",
        startLine: 40,
        endLine: 41,
      }),
      write("DELETE", `/comments/${draftId}`, "head-1"),
    ]);

    expect(refusals.map((res) => res.status)).toEqual([409, 409, 409]);
    for (const res of refusals) {
      expect(await readWireCode(res)).toBe("draft-already-published");
    }
    // The body the audit trail points at never moved.
    const rows = await harness.raw(
      "select body from review_draft_comment order by id",
    );
    expect(rows[0]?.["body"]).toBe(DRAFT.body);
  });

  it("409s an edit of a draft a publish attempt holds", async () => {
    const briefId = await seedBrief(harness.handle, 1);
    const draftId = await readDraftId(
      await write("POST", "/comments", "head-1", DRAFT),
    );
    await createTenantRepository(
      harness.handle,
      CTX,
    ).reviewSessions.claimDrafts(
      { briefId, reviewerId: REVIEWER },
      { draftIds: [BigInt(draftId)] },
    );

    const refusals = [
      await write("PATCH", `/comments/${draftId}`, "head-1", {
        body: "edited",
      }),
      await write("DELETE", `/comments/${draftId}`, "head-1"),
    ];

    expect(refusals.map((res) => res.status)).toEqual([409, 409]);
    for (const res of refusals) {
      expect(await readWireCode(res)).toBe("draft-publish-pending");
    }
  });

  it("409s an edit of an in-doubt draft and lets the reviewer delete it", async () => {
    const briefId = await seedBrief(harness.handle, 1);
    const draftId = await readDraftId(
      await write("POST", "/comments", "head-1", DRAFT),
    );
    await createTenantRepository(
      harness.handle,
      CTX,
    ).reviewSessions.claimDrafts(
      { briefId, reviewerId: REVIEWER },
      {
        draftIds: [BigInt(draftId)],
        now: new Date(Date.now() - PUBLISH_CLAIM_LEASE_MS),
      },
    );

    const edited = await write("PUT", `/comments/${draftId}/anchor`, "head-1", {
      filePath: "src/app.ts",
      side: "new",
      startLine: 40,
      endLine: 41,
    });
    const deleted = await write("DELETE", `/comments/${draftId}`, "head-1");

    expect(edited.status).toBe(409);
    expect(await readWireCode(edited)).toBe("draft-publish-in-doubt");
    expect(deleted.ok).toBe(true);
    expect(await countRows("review_draft_comment")).toBe(0);
  });

  it("refuses the 65th unposted draft the session would hold", async () => {
    const briefId = await seedBrief(harness.handle, 1);
    const repo = createTenantRepository(harness.handle, CTX);
    const key = { briefId, reviewerId: REVIEWER };
    for (let index = 0; index < 64; index++) {
      await repo.reviewSessions.addDraft(key, {
        anchor: {
          kind: CommentAnchorKinds.LINE,
          file: DRAFT.filePath,
          side: DraftCommentSides.NEW,
          startLine: DRAFT.startLine,
          endLine: DRAFT.endLine,
        },
        body: DRAFT.body,
      });
    }

    const refused = await write("POST", "/comments", "head-1", DRAFT);
    expect(refused.status).toBe(409);
    expect(await readWireCode(refused)).toBe("draft-limit-reached");

    // Publishing one frees a slot: the cap counts what a submit would post.
    const rows = await harness.raw(
      "select id from review_draft_comment order by id limit 1",
    );
    await repo.reviewSessions.recordPublishedDrafts(key, {
      draftIds: [BigInt(String(rows[0]?.["id"]))],
    });
    expect((await write("POST", "/comments", "head-1", DRAFT)).status).toBe(
      201,
    );
  });

  it("400s a malformed payload and 404s an unknown span, writing nothing", async () => {
    await seedBrief(harness.handle, 1);

    // Digits, but past int8: refused at the boundary rather than raised by
    // Postgres inside the transaction.
    expect(
      (await write("DELETE", "/comments/9999999999999999999", "head-1")).status,
    ).toBe(400);

    expect(
      (await write("PUT", "/chunks/c1/read", "head-1", { read: "yes" })).status,
    ).toBe(400);
    expect(
      (await write("POST", "/comments", "head-1", { ...DRAFT, endLine: 1 }))
        .status,
    ).toBe(400);
    expect((await write("POST", "/comments", "head-9", DRAFT)).status).toBe(
      404,
    );
    // No `head` at all: the span is judged before the Brief is resolved, which
    // every case above reaches only after its body schema has passed.
    const noHead = await app.request(
      `/api/repos/${REPO_ID}/pulls/${PR_NUMBER}/session/chunks/c1/read?base=base`,
      {
        method: "PUT",
        headers: {
          ...SAME_ORIGIN_HEADERS,
          Cookie: `__Host-mergebrief_session=${cookie}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ read: true }),
      },
    );
    expect(noHead.status).toBe(400);
    expect(await countRows("review_session")).toBe(0);
  });

  it("gates the writes on the credential's scope", async () => {
    await seedBrief(harness.handle, 1);
    const readOnly = await seedApiToken(
      harness.handle,
      kp,
      WriteClassifications.READ,
    );
    const writer = await seedApiToken(
      harness.handle,
      kp,
      WriteClassifications.PRIVATE_WRITE,
    );

    async function asToken(bearer: string): Promise<Response> {
      return app.request(pathFor("/chunks/c1/read", "head-1"), {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${bearer}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ read: true }),
      });
    }

    const refused = await asToken(readOnly);
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({
      error: expect.any(String),
      code: "scope-exceeded",
    });
    // Refused before the handler ran: nothing was created.
    expect(await countRows("review_session")).toBe(0);

    expect((await asToken(writer)).status).toBe(200);
    expect(await countRows("review_read_mark")).toBe(1);
  });

  it("dismisses, addresses and reopens a whole array of flags in one call", async () => {
    const briefId = await seedBrief(harness.handle, 1);
    const second = { ...FLAG, attribute: "no-error-path" };

    const dismissed = await write("POST", "/risks/dismiss", "head-1", {
      flags: [FLAG, second],
      reason: "both are covered by the integration suite",
    });

    expect(dismissed.status).toBe(200);
    expect(await dismissed.json()).toEqual({ flags: 2 });
    expect(await countRows("disposition")).toBe(2);

    // A different payload recording a different judgment on the same anchor:
    // the upsert re-decides the row rather than adding a second one.
    const addressed = await write("POST", "/risks/address", "head-1", {
      flags: [
        { ...FLAG, evidence: { kind: "linked-comment", ref: "41" } },
        {
          ...second,
          evidence: { kind: "manual-note", ref: "checked by hand" },
        },
      ],
    });
    expect(addressed.status).toBe(200);
    expect(await countRows("disposition")).toBe(2);
    expect(
      await harness.raw(
        `select decision, reason, evidence_kind, evidence_ref
           from disposition order by attribute`,
      ),
    ).toEqual([
      {
        decision: "addressed",
        reason: null,
        evidence_kind: "manual-note",
        evidence_ref: "checked by hand",
      },
      {
        decision: "addressed",
        reason: null,
        evidence_kind: "linked-comment",
        evidence_ref: "41",
      },
    ]);

    // The bare undo: an undecided flag is a row that does not exist.
    const reopened = await write("POST", "/risks/reopen", "head-1", {
      flags: [FLAG, second],
    });
    expect(reopened.status).toBe(200);
    expect(await countRows("disposition")).toBe(0);
    // Repeating the undo is the same undo, and says it changed nothing.
    const again = await write("POST", "/risks/reopen", "head-1", {
      flags: [FLAG],
    });
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ flags: 0 });

    const snapshot = await createTenantRepository(
      harness.handle,
      CTX,
    ).reviewSessions.get({
      briefId,
      reviewerId: REVIEWER,
    });
    expect(snapshot?.dispositions).toEqual([]);
  });

  it("400s a risk write with an empty array or a pointer to nothing", async () => {
    await seedBrief(harness.handle, 1);

    const refused = await Promise.all([
      write("POST", "/risks/dismiss", "head-1", { flags: [], reason: "x" }),
      write("POST", "/risks/dismiss", "head-1", { flags: [FLAG], reason: "" }),
      write("POST", "/risks/reopen", "head-1", {
        flags: [{ ...FLAG, regionStart: 13 }],
      }),
      // Past `int4`: refused at the boundary rather than raised by Postgres
      // inside the transaction, which would escape as a bare 500.
      write("POST", "/risks/reopen", "head-1", {
        flags: [
          { ...FLAG, regionStart: 3_000_000_000, regionEnd: 3_000_000_000 },
        ],
      }),
      // The cap the web app mirrors, a deterministic 400 past it.
      write("POST", "/risks/reopen", "head-1", {
        flags: Array.from({ length: 201 }, () => FLAG),
      }),
      // A pointer kind with nothing to point at would store its own
      // `missing-evidence` on the way in.
      write("POST", "/risks/address", "head-1", {
        flags: [{ ...FLAG, evidence: { kind: "chunk-reviewed" } }],
      }),
      // A note is the reviewer's own words, so it has to have words.
      write("POST", "/risks/address", "head-1", {
        flags: [{ ...FLAG, evidence: { kind: "manual-note", ref: "" } }],
      }),
    ]);

    expect(refused.map((res) => res.status)).toEqual([
      400, 400, 400, 400, 400, 400, 400,
    ]);
    expect(await countRows("review_session")).toBe(0);
  });

  it("keeps clearing human-only while allowing token-authored decisions", async () => {
    await seedBrief(harness.handle, 1);
    const bearer = await seedApiToken(
      harness.handle,
      kp,
      // The widest scope there is: this refusal is not about scope.
      WriteClassifications.EXTERNAL_WRITE,
    );

    async function asAgent(
      suffix: string,
      body?: unknown,
      method = "POST",
    ): Promise<Response> {
      const init: RequestInit = {
        method,
        headers: {
          Authorization: `Bearer ${bearer}`,
          "content-type": "application/json",
        },
      };

      if (body !== undefined) init.body = JSON.stringify(body);

      return app.request(pathFor(suffix, "head-1"), init);
    }

    // All FIVE clearing operations, not just the three risk ones:
    // re-anchoring and deleting a draft are what an orphaned anchor's
    // `clearedBy` names, and rows carry no per-author ownership.
    const refused = await Promise.all([
      asAgent("/risks/dismiss", { flags: [FLAG], reason: "looks fine" }),
      asAgent("/risks/address", {
        flags: [{ ...FLAG, evidence: { kind: "manual-note", ref: "read it" } }],
      }),
      asAgent("/risks/reopen", { flags: [FLAG] }),
      asAgent(
        "/comments/1/anchor",
        { filePath: "src/app.ts", side: "new", startLine: 1, endLine: 2 },
        "PUT",
      ),
      asAgent("/comments/1", undefined, "DELETE"),
    ]);

    expect(refused.map((res) => res.status)).toEqual([403, 403, 403, 403, 403]);
    expect(await refused[0]!.json()).toEqual({
      error: expect.any(String),
      code: "human-only",
    });
    expect(await countRows("disposition")).toBe(0);
    // Nothing was written at all, the refusal lands before the session is
    // materialized, so a refused clear cannot freeze an older Brief.
    expect(await countRows("review_session")).toBe(0);

    // The SAME credential authors its own drafts freely: this restricts
    // clearing, never authoring.
    expect((await asAgent("/comments", DRAFT)).status).toBe(201);
  });

  it("round-trips the review outcome, and never carries it to the next Brief", async () => {
    await seedBrief(harness.handle, 1);

    const picked = await write("PUT", "/outcome", "head-1", {
      outcome: "request-changes",
    });
    expect(picked.status).toBe(200);
    // Read back off the row: the picker is server-authoritative.
    expect(await picked.json()).toEqual({ outcome: "request-changes" });
    expect(await readOutcome(await read("head-1"))).toBe("request-changes");
    expect(
      (await write("PUT", "/outcome", "head-1", { outcome: "sideways" }))
        .status,
    ).toBe(400);

    // An approve picked against old code is the one carry that does damage:
    // the next Brief starts at `comment` again.
    await seedBrief(harness.handle, 2);
    expect(await readOutcome(await read("head-2"))).toBe("comment");
  });

  it("lists decisions with missing evidence and clears them by either route", async () => {
    const previous = await seedBrief(harness.handle, 1);
    await seedPreviousWork(harness.handle, previous);
    // The decision points at a Chunk the next Brief did not carry.
    await createTenantRepository(
      harness.handle,
      CTX,
    ).reviewSessions.decideRisks({ briefId: previous, reviewerId: REVIEWER }, [
      {
        ...FLAG,
        decision: DispositionDecisions.ADDRESSED,
        evidence: { kind: DispositionEvidenceKinds.CHUNK_REVIEWED, ref: "c9" },
      },
    ]);
    await seedBrief(harness.handle, 2);
    await seedHop(harness.handle, 1, 2);

    const body: unknown = await (await read("head-2")).json();
    const items = z
      .object({
        attention: z.array(
          z.object({
            kind: z.string(),
            subject: z.object({ type: z.string() }),
            clearedBy: z.array(z.string()),
          }),
        ),
      })
      .parse(body)
      .attention.filter((item) => item.subject.type === "disposition");

    // The region was untouched, so the decision itself settled: what needs a
    // re-look is the proof it claimed, and either operation supplies one.
    expect(items).toEqual([
      {
        kind: "missing-evidence",
        subject: { type: "disposition" },
        clearedBy: ["address-risk", "dismiss-risk"],
      },
    ]);
  });

  it("keeps a linked-comment evidence pointer good across two carries", async () => {
    // The id the reviewer cites is the one the READ handed out, the previous
    // session's row. Every carry re-keys the copy, so a pointer that is not
    // re-normalized forward reports missing evidence on work that is alive.
    await seedBrief(harness.handle, 1);
    const draftId = await readDraftId(
      await write("POST", "/comments", "head-1", DRAFT),
    );
    await write("POST", "/risks/address", "head-1", {
      flags: [{ ...FLAG, evidence: { kind: "linked-comment", ref: draftId } }],
    });

    for (const head of [2, 3]) {
      await seedBrief(harness.handle, head);
      await seedHop(harness.handle, head - 1, head);
      // Any write writes; the carry rides with it.
      const carried = await write("PUT", "/chunks/c1/read", `head-${head}`, {
        read: true,
      });
      expect(carried.status).toBe(200);
    }

    // Still proof, and the pointer resolves WITHIN the newest session, the
    // only scope a write can address. A ref left pointing at an older
    // session's row still exists somewhere, and is exactly as good as gone.
    expect(
      await harness.raw(
        `select d.evidence_status,
                exists (select 1 from review_draft_comment c
                          where c.review_session_id = d.review_session_id
                            and (c.id::text = d.evidence_ref
                                 or c.carried_from_comment_id::text
                                      = d.evidence_ref))
                  as resolves
           from disposition d order by d.id desc limit 1`,
      ),
    ).toEqual([{ evidence_status: null, resolves: true }]);
  });

  it("advances the evidence pointer across a hop that reopened the flag", async () => {
    // The pointer must move on EVERY hop: a ref that only advanced when the
    // decision settled would be two generations stale after two reopens, and
    // then read as gone against a comment that never went away.
    await seedBrief(harness.handle, 1);
    const draftId = await readDraftId(
      await write("POST", "/comments", "head-1", DRAFT),
    );
    await write("POST", "/risks/address", "head-1", {
      flags: [{ ...FLAG, evidence: { kind: "linked-comment", ref: draftId } }],
    });

    // Two pushes that land inside the flagged region: both reopen it, and
    // the reviewer answers neither.
    for (const head of [2, 3]) {
      await seedBrief(harness.handle, head);
      await seedHopInsideFlaggedRegion(harness.handle, head - 1, head);
      await write("PUT", "/chunks/c1/read", `head-${head}`, { read: true });
    }
    // A push that leaves the region alone: the decision settles again, and
    // the proof it named has to still be its proof.
    await seedBrief(harness.handle, 4);
    await seedHop(harness.handle, 3, 4);
    await write("PUT", "/chunks/c1/read", "head-4", { read: true });

    expect(
      await harness.raw(
        `select d.evidence_status,
                exists (select 1 from review_draft_comment c
                          where c.review_session_id = d.review_session_id
                            and (c.id::text = d.evidence_ref
                                 or c.carried_from_comment_id::text
                                      = d.evidence_ref))
                  as resolves
           from disposition d order by d.id desc limit 1`,
      ),
    ).toEqual([{ evidence_status: null, resolves: true }]);
  });

  it("401s without a credential", async () => {
    await seedBrief(harness.handle, 1);
    const res = await app.request(pathFor("/chunks/c1/read", "head-1"), {
      method: "PUT",
      headers: { ...SAME_ORIGIN_HEADERS, "content-type": "application/json" },
      body: JSON.stringify({ read: true }),
    });
    expect(res.status).toBe(401);
    expect(await countRows("review_session")).toBe(0);
  });
});
