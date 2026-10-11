// The session read, end to end over the PGlite harness: it answers on both
// sides of materialization, projects the Attention List off the rows it
// returns, and creates nothing (the invariant the suite exists for). Every
// case asserts the `review_session` row count across the call.
import { makeFakeGitHub, type FakeGitHub } from "github/testing";
import { createTenantRepository, type KeyProvider } from "persistence";
import { AnchorStatuses } from "types/comments";
import { ReviewOutcomes } from "types/reviews";
import { createPgliteHarness, type PgliteHarness } from "persistence/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, type ApiApp } from "../../src/index";
import { testLogging, type TestLogging } from "../logging";
import { spyPullRequestLookups } from "../pull-request-lookups";
import {
  BRIEF_BODY,
  CTX,
  REPO_ID,
  REVIEWER,
  seedBrief,
  seedPreviousWork,
  seedPullRequest,
} from "./fixtures";
import { PR_NUMBER, SECRET, createKeyProvider } from "../fixtures";
import {
  UNUSED_INSTALLATION_DEPS,
  buildFakeAuthDeps,
  stubGateGitHub,
  type GateGitHub,
} from "../reviewer-github";
import { seedSignIn } from "../sign-in";

/** The payload's shape as the assertions read it: the test-side boundary. */
interface SessionBody {
  readonly materialized: boolean;
  readonly carriedFrom: {
    readonly sessionId: string;
    readonly headSha: string;
    readonly revisions: number;
    readonly items: number;
  } | null;
  readonly readMarks: readonly string[];
  readonly draftComments: readonly Record<string, unknown>[];
  readonly reclassifications: readonly Record<string, unknown>[];
  readonly submittedReviewIds: readonly string[];
  readonly attention: readonly {
    readonly kind: string;
    readonly subject: { readonly type: string; readonly id: string | null };
    readonly location: Record<string, unknown> | null;
    readonly clearedBy: readonly string[];
  }[];
}

async function readBody(res: Response): Promise<SessionBody> {
  return (await res.json()) as SessionBody;
}

function sessionPath(head: string): string {
  return `/api/repos/${REPO_ID}/pulls/${PR_NUMBER}/session?base=base&head=${head}`;
}

describe("read-review-session", () => {
  let harness: PgliteHarness;
  let app: ApiApp;
  let kp: KeyProvider;
  let cookie: string;
  let fake: FakeGitHub;
  let gate: GateGitHub;
  let logging: TestLogging;

  beforeEach(async () => {
    harness = await createPgliteHarness();
    kp = createKeyProvider();
    fake = makeFakeGitHub();
    logging = testLogging();
    app = createApp({
      logger: logging.logger,
      handle: harness.handle,
      webhookSecret: SECRET,
      auth: buildFakeAuthDeps(kp, fake),
      ...UNUSED_INSTALLATION_DEPS,
    });
    gate = stubGateGitHub({ repoId: REPO_ID });
    ({ cookie } = await seedSignIn(harness.handle, kp));
    await seedPullRequest(harness.handle);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    await harness.close();
  });

  async function sessionRows(): Promise<number> {
    const rows = await harness.raw(
      "select count(*)::int as n from review_session",
    );
    return Number(rows[0]?.["n"] ?? -1);
  }

  async function read(head: string): Promise<Response> {
    return app.request(sessionPath(head), {
      headers: { Cookie: `__Host-mergebrief_session=${cookie}` },
    });
  }

  it("answers a first-ever session with no carry-over and no row", async () => {
    await seedBrief(harness.handle, 1);
    const lookups = spyPullRequestLookups(harness);

    const res = await read("head-1");

    expect(res.status).toBe(200);
    expect(lookups.count()).toBe(1);
    expect(gate.repositoryReads()).toBe(1);
    expect(fake.calls).toEqual([]);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await readBody(res);
    expect(body.materialized).toBe(false);
    // Null here is what tells a first-ever session from one that carried and
    // has nothing pending: two different rows in the UI.
    expect(body.carriedFrom).toBeNull();
    expect(body.attention).toEqual([]);
    expect(await sessionRows()).toBe(0);
  });

  it("returns evaluated carry-over and attention without creating a row", async () => {
    const previous = await seedBrief(harness.handle, 1);
    await seedBrief(harness.handle, 2);
    await seedPreviousWork(harness.handle, previous);
    const before = await sessionRows();

    const res = await read("head-2");

    expect(res.status).toBe(200);
    const body = await readBody(res);
    expect(body.materialized).toBe(false);
    // The span the carry-over row states: where the work came from, and how
    // many pushes since.
    expect(body.carriedFrom).toEqual({
      sessionId: expect.any(String),
      headSha: "head-1",
      revisions: 1,
      // What CARRIED, so the row's receipt can state it: the draft, the
      // disposition AND the reclassification, and the same number after the
      // write that writes this session.
      items: 3,
    });
    // Silent carry: the reclassification's group still exists on the new
    // Brief.
    expect(body.reclassifications).toEqual([
      { changeGroupId: "g1", category: "logic-refactor" },
    ]);
    expect(body.submittedReviewIds).toEqual([]);
    // The id is the PREVIOUS session's row: it exists, and a write naming it
    // resolves through the copy the first write makes. Only a disposition,
    // which every operation addresses by its anchor, reports none.
    expect(body.draftComments).toEqual([
      expect.objectContaining({
        id: expect.stringMatching(/^\d+$/),
        anchorStatus: AnchorStatuses.ORPHANED,
      }),
    ]);
    expect(body.attention).toEqual([
      {
        kind: "orphaned-anchor",
        subject: {
          type: "draft-comment",
          id: expect.stringMatching(/^\d+$/),
          attribute: null,
        },
        location: {
          kind: "line",
          filePath: "src/app.ts",
          startLine: 10,
          endLine: 12,
        },
        clearedBy: ["reanchor-draft-comment", "delete-draft-comment"],
      },
      {
        kind: "reopened-disposition",
        // The attribute is the half of the anchor `location` cannot state.
        subject: { type: "disposition", id: null, attribute: "no-tests" },
        location: {
          kind: "line",
          filePath: "src/app.ts",
          startLine: 10,
          endLine: 12,
        },
        clearedBy: ["address-risk", "dismiss-risk"],
      },
    ]);
    // The proof: a Brief with a previous session, read twice, still no new row.
    await read("head-2");
    expect(await sessionRows()).toBe(before);
  });

  it("returns the session's own rows once it materialized", async () => {
    const previous = await seedBrief(harness.handle, 1);
    const current = await seedBrief(harness.handle, 2);
    await seedPreviousWork(harness.handle, previous);
    const sessions = createTenantRepository(harness.handle, CTX).reviewSessions;
    const key = { briefId: current, reviewerId: REVIEWER };
    const marked = await sessions.setChunkRead(key, {
      chunkId: "c1",
      read: true,
    });
    const recorded = await sessions.recordPublishedDrafts(key, {
      draftIds: [],
      githubReviewId: 7700n,
    });
    expect(marked.ok && recorded.ok).toBe(true);
    const before = await sessionRows();

    const res = await read("head-2");

    const body = await readBody(res);
    expect(body.materialized).toBe(true);
    expect(body.readMarks).toEqual(["c1"]);
    expect(body.submittedReviewIds).toEqual(["7700"]);
    // Carried in, and it still says so after the write that materialized it.
    expect(body.carriedFrom?.headSha).toBe("head-1");
    // The count is what CARRIED, stamped at materialization: the read mark
    // this session wrote itself must never inflate a receipt that claims to
    // state what came across, and it is the same number the pre-materialized
    // read returned.
    expect(body.carriedFrom?.items).toBe(3);
    // The same list, now off the session's own rows: the subject has an id
    // to act on.
    expect(body.attention).toEqual([
      {
        kind: "orphaned-anchor",
        subject: {
          type: "draft-comment",
          id: expect.stringMatching(/^\d+$/),
          attribute: null,
        },
        location: {
          kind: "line",
          filePath: "src/app.ts",
          startLine: 10,
          endLine: 12,
        },
        clearedBy: ["reanchor-draft-comment", "delete-draft-comment"],
      },
      {
        kind: "reopened-disposition",
        subject: { type: "disposition", id: null, attribute: "no-tests" },
        location: {
          kind: "line",
          filePath: "src/app.ts",
          startLine: 10,
          endLine: 12,
        },
        clearedBy: ["address-risk", "dismiss-risk"],
      },
    ]);
    expect(await sessionRows()).toBe(before);
  });

  it("counts a read mark as carried, so a clean carry still has a receipt", async () => {
    // Read marks and reclassifications have no marker column. Leaving them
    // out of the count reports zero, the carry-over row renders nothing, and
    // a carried session looks first-ever: the one collapse the row forbids.
    // Both sides of materialization, because the row must not vanish mid-use.
    const previous = await seedBrief(harness.handle, 1);
    // `c1` is in the new Brief's persisted carried set, so the mark carries.
    const current = await seedBrief(harness.handle, 2, BRIEF_BODY, ["c1"]);
    const sessions = createTenantRepository(harness.handle, CTX).reviewSessions;
    await sessions.setChunkRead(
      { briefId: previous, reviewerId: REVIEWER },
      { chunkId: "c1", read: true },
    );

    const pending = await readBody(await read("head-2"));
    expect(pending.materialized).toBe(false);
    expect(pending.readMarks).toEqual(["c1"]);
    expect(pending.carriedFrom?.items).toBe(1);

    // The write that writes it must not turn the receipt into nothing.
    await sessions.setOutcome(
      { briefId: current, reviewerId: REVIEWER },
      ReviewOutcomes.COMMENT,
    );

    const settled = await readBody(await read("head-2"));
    expect(settled.materialized).toBe(true);
    expect(settled.carriedFrom?.items).toBe(1);

    // And clearing the carried work does not shrink it: the count states what
    // came across, so the receipt survives the reviewer acting on every item.
    await sessions.setChunkRead(
      { briefId: current, reviewerId: REVIEWER },
      { chunkId: "c1", read: false },
    );

    const cleared = await readBody(await read("head-2"));
    expect(cleared.readMarks).toEqual([]);
    expect(cleared.carriedFrom?.items).toBe(1);
  });

  it("fails the read rather than dropping decisions on an unreadable Brief", async () => {
    // Empty facts would read as "no flag fires any more" and mark every
    // carried decision DROPPED, silently, and on a path that also
    // writes. A failed read the reviewer can retry is the only
    // acceptable answer.
    const previous = await seedBrief(harness.handle, 1);
    await seedBrief(harness.handle, 2, "{ not json");
    await seedPreviousWork(harness.handle, previous);
    const before = await sessionRows();

    const res = await read("head-2");

    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ code: "internal-error" });
    expect(await sessionRows()).toBe(before);
    expect(logging.lines()).toContainEqual(
      expect.objectContaining({
        level: "error",
        msg: "brief artifact unreadable, carry-over not evaluated",
        head: "head-2",
      }),
    );
  });

  it("treats a body missing the carry keys as unreadable, not as empty facts", async () => {
    // Valid JSON that says nothing the evaluation needs. Defaulting these two
    // to [] is the same silent mass-DROPPED as a body that will not parse.
    const previous = await seedBrief(harness.handle, 1);
    await seedBrief(harness.handle, 2, '{"summary":"the brief"}');
    await seedPreviousWork(harness.handle, previous);

    const res = await read("head-2");

    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ code: "internal-error" });
  });

  it("404s an unknown span and 400s a malformed request", async () => {
    await seedBrief(harness.handle, 1);

    expect((await read("head-9")).status).toBe(404);
    const noHead = await app.request(
      `/api/repos/${REPO_ID}/pulls/${PR_NUMBER}/session?base=base`,
      { headers: { Cookie: `__Host-mergebrief_session=${cookie}` } },
    );
    expect(noHead.status).toBe(400);
    expect(await sessionRows()).toBe(0);
  });

  it("401s without a session cookie", async () => {
    const res = await app.request(sessionPath("head-1"));
    expect(res.status).toBe(401);
  });
});
