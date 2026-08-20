// The Review Session writes, end to end over the PGlite harness. Five things
// this suite exists to hold: any write can be the one that writes the
// carry-over (session row created, carried rows copied, write applied, all in
// one transaction), a draft id the read handed out before materialization
// lands on the copy that write makes, a frozen session refuses every write
// with 409, `set-chunk-read` is idempotent under a repeat of the same boolean,
// and the router's scope gate stands in front of all of them.
import {
  ChangeGroupCategory,
  forTenant,
  WriteClassification,
} from "persistence";
import type { KeyProvider } from "persistence";
import { createPgliteHarness, type PgliteHarness } from "persistence/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createApp, type ApiApp } from "../../src/index";
import { testLogger } from "../logging";
import {
  authDeps,
  CTX,
  keyProvider,
  NO_ARTIFACT,
  PR_NUMBER,
  REPO_ID,
  REVIEWER,
  SECRET,
  seedApiToken,
  seedBrief,
  seedOrphanedDraft,
  seedPreviousWork,
  seedPullRequest,
  seedSession,
  stubGitHub,
} from "./fixtures";

function pathFor(suffix: string, head: string): string {
  return `/api/repos/${REPO_ID}/pulls/${PR_NUMBER}/session${suffix}?base=base&head=${head}`;
}

/** The created draft's row id, as the write route reports it. */
async function draftIdOf(res: Response): Promise<string> {
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
 * carried anchors — before materialization those are the PREVIOUS session's
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
    kp = keyProvider();
    app = createApp({
      logger: testLogger(),
      handle: harness.handle,
      webhookSecret: SECRET,
      auth: authDeps(kp),
      github: {
        fetchPullRequestConversation: () => {
          throw new Error("conversation port must not be called");
        },
        listRepoCollaborators: () => {
          throw new Error("collaborators port must not be called");
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
    return app.request(pathFor(suffix, head), {
      method,
      headers: {
        Cookie: `rs_session=${cookie}`,
        "content-type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }

  async function read(head: string): Promise<Response> {
    return app.request(pathFor("", head), {
      headers: { Cookie: `rs_session=${cookie}` },
    });
  }

  async function countOf(table: string): Promise<number> {
    const rows = await harness.raw(`select count(*)::int as n from ${table}`);
    return Number(rows[0]?.["n"] ?? -1);
  }

  it("writes the carry-over on whichever write lands first", async () => {
    const previous = await seedBrief(harness.handle, 1);
    const current = await seedBrief(harness.handle, 2);
    await seedPreviousWork(harness.handle, previous);
    // One session — the previous one — and nothing on the new Brief yet.
    expect(await countOf("review_session")).toBe(1);

    // A read mark owns none of the carried subjects and still creates the
    // session and copies the carried work: materialization belongs to no
    // single operation.
    const res = await write("PUT", "/chunks/c1/read", "head-2", { read: true });

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await countOf("review_session")).toBe(2);
    const snapshot = await forTenant(harness.handle, CTX).reviewSessions.get({
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
    expect(await countOf("review_session")).toBe(1);

    const res = await write("PUT", "/chunks/c1/read", "head-2", { read: true });

    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ code: "internal-error" });
    expect(await countOf("review_session")).toBe(1);
  });

  it("applies the copy and the write together, or neither", async () => {
    const previous = await seedBrief(harness.handle, 1);
    const current = await seedBrief(harness.handle, 2);
    await seedPreviousWork(harness.handle, previous);
    const carriedBefore = await countOf("review_draft_comment");

    // A write that throws takes the whole materialization down with it — the
    // session and the copied rows go back with the transaction.
    const failed = forTenant(harness.handle, CTX).reviewSessions.writeToSession(
      {
        briefId: current,
        reviewerId: REVIEWER,
        brief: async () => NO_ARTIFACT,
      },
      async () => {
        throw new Error("the write failed after the copy");
      },
    );
    await expect(failed).rejects.toThrow("the write failed after the copy");

    expect(await countOf("review_session")).toBe(1);
    expect(await countOf("review_draft_comment")).toBe(carriedBefore);
  });

  it("refuses every write to a frozen session with 409", async () => {
    await seedBrief(harness.handle, 1);
    // A draft on the older Brief, addressable by row id once it is frozen.
    const draftId = await draftIdOf(
      await write("POST", "/comments", "head-1", DRAFT),
    );
    const current = await seedBrief(harness.handle, 2);
    // The reviewer writes the NEWER Brief's session — that, and only
    // that, freezes the older one.
    const opened = await forTenant(
      harness.handle,
      CTX,
    ).reviewSessions.writeToSession(
      {
        briefId: current,
        reviewerId: REVIEWER,
        brief: async () => NO_ARTIFACT,
      },
      (writer) => writer.putReadMark({ chunkId: "c1" }),
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
        category: ChangeGroupCategory.BUGFIX,
      }),
    ]);

    expect(refusals.map((res) => res.status)).toEqual([
      409, 409, 409, 409, 409, 409,
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
    expect(await countOf("review_read_mark")).toBe(1);

    // The unread half is the same operation carrying `false`, and repeating it
    // is just as safe.
    expect(
      (await write("PUT", "/chunks/c1/read", "head-1", { read: false })).status,
    ).toBe(200);
    expect(
      (await write("PUT", "/chunks/c1/read", "head-1", { read: false })).status,
    ).toBe(200);
    expect(await countOf("review_read_mark")).toBe(0);
  });

  it("edits, re-anchors and deletes a draft through the session that owns it", async () => {
    const briefId = await seedBrief(harness.handle, 1);
    const draftId = await draftIdOf(
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

    const snapshot = await forTenant(harness.handle, CTX).reviewSessions.get({
      briefId,
      reviewerId: REVIEWER,
    });
    expect(snapshot?.draftComments[0]).toMatchObject({
      body: "on reflection, bounded",
      startLine: 40,
      endLine: 41,
      // The human placed it, so the carry-over verdict is settled.
      anchorStatus: null,
    });

    expect(
      (await write("DELETE", `/comments/${draftId}`, "head-1")).status,
    ).toBe(200);
    expect(await countOf("review_draft_comment")).toBe(0);
    // A second delete has nothing left to name.
    expect(
      (await write("DELETE", `/comments/${draftId}`, "head-1")).status,
    ).toBe(404);
  });

  it("stores a group reclassification as an override", async () => {
    const briefId = await seedBrief(harness.handle, 1);

    const res = await write("PUT", "/groups/g1/classification", "head-1", {
      category: ChangeGroupCategory.BUGFIX,
    });
    await write("PUT", "/groups/g1/classification", "head-1", {
      category: ChangeGroupCategory.NEW_FEATURE,
    });

    expect(res.status).toBe(200);
    expect(await countOf("review_group_reclassification")).toBe(1);
    const snapshot = await forTenant(harness.handle, CTX).reviewSessions.get({
      briefId,
      reviewerId: REVIEWER,
    });
    expect(snapshot?.reclassifications[0]?.category).toBe(
      ChangeGroupCategory.NEW_FEATURE,
    );
  });

  it("resolves a carried draft id on every write, not only the one that writes", async () => {
    await seedBrief(harness.handle, 1);
    const draftId = await draftIdOf(
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

    // Materialized now, and the same id still reaches the copy — the pointer
    // is a column on it, not a mapping that lived for one transaction.
    const deleted = await write("DELETE", `/comments/${draftId}`, "head-2");
    expect(deleted.status).toBe(200);
    // The row that went is the copy; the id that named it is still the
    // previous session's row, which survives.
    expect(await draftIdOf(deleted)).not.toBe(draftId);
    expect(
      await harness.raw("select id::text as id from review_draft_comment"),
    ).toEqual([{ id: draftId }]);

    // The trade-off this accepts: that first write on Brief 2 froze Brief 1,
    // so every later Brief-1 write is 409 — terminal for a screen still on it.
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
    // the copy — the operation the attention item names, run straight off it.
    const res = await write("PUT", `/comments/${draftId}/anchor`, "head-2", {
      filePath: "src/app.ts",
      side: "new",
      startLine: 40,
      endLine: 41,
    });

    expect(res.status).toBe(200);
    expect(await countOf("review_session")).toBe(2);
    const rows = await harness.raw(
      "select id::text as id, start_line, anchor_status from review_draft_comment order by id",
    );
    // The previous session's row is untouched; the copy holds the placement.
    expect(rows).toEqual([
      { id: draftId, start_line: 10, anchor_status: null },
      { id: expect.any(String), start_line: 40, anchor_status: null },
    ]);
    expect(await draftIdOf(res)).not.toBe(draftId);
  });

  it("clears every carried anchor one read listed, materializing on the first", async () => {
    const previous = await seedBrief(harness.handle, 1);
    await seedBrief(harness.handle, 2);
    await seedPreviousWork(harness.handle, previous);
    await seedOrphanedDraft(harness.handle, previous);
    // Two items, one payload — the list is meant to be walked, so the second
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
    expect(await countOf("review_session")).toBe(2);
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
    // The write still materialized: the session row and its copies stand, and
    // the older Brief is frozen from here whatever the response said.
    expect(await countOf("review_session")).toBe(2);
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
          Cookie: `rs_session=${cookie}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ read: true }),
      },
    );
    expect(noHead.status).toBe(400);
    expect(await countOf("review_session")).toBe(0);
  });

  it("gates the writes on the credential's scope", async () => {
    await seedBrief(harness.handle, 1);
    const readOnly = await seedApiToken(
      harness.handle,
      kp,
      WriteClassification.READ,
    );
    const writer = await seedApiToken(
      harness.handle,
      kp,
      WriteClassification.PRIVATE_WRITE,
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
    expect(await countOf("review_session")).toBe(0);

    expect((await asToken(writer)).status).toBe(200);
    expect(await countOf("review_read_mark")).toBe(1);
  });

  it("401s without a credential", async () => {
    await seedBrief(harness.handle, 1);
    const res = await app.request(pathFor("/chunks/c1/read", "head-1"), {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ read: true }),
    });
    expect(res.status).toBe(401);
    expect(await countOf("review_session")).toBe(0);
  });
});
