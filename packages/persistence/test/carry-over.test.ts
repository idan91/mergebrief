// Carry-over: the read-side evaluation and the write-on-first-write
// transaction, exercised through the ctx-bound store — the only surface the
// API layer gets. The dangerous failure here is silent (a wrongly-placed
// anchor reads as correct), so every carry rule gets its own case, including
// the one that must NOT happen: a read mark carrying on a chunk id that was
// merely re-used.
import type { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { describe, expect, it } from "vitest";
import { fromDrizzle } from "../src/db/handle";
import { artifactStore, forTenant, ReviewSessionErrorCode } from "../src/index";
import type {
  AppDatabase,
  BriefCarryFacts,
  FlagKey,
  SessionWriter,
  TenantContext,
} from "../src/index";
import * as schema from "../src/schema/index";
import {
  ChangeGroupCategory,
  DispositionDecision,
  DraftCommentSide,
  DraftCommentStatus,
  ReviewOutcome,
  isInstallationId,
  isRepoId,
  isReviewerId,
  type BriefRowId,
  type InstallationId,
  type PullRequestRowId,
  type RepoId,
  type ReviewerId,
  type ReviewSessionId,
} from "../src/types";
import { brandWith, freshPglite } from "./helpers";

const TENANT: InstallationId = brandWith(isInstallationId, 1000n);
const REPO: RepoId = brandWith(isRepoId, 777n);
const REVIEWER: ReviewerId = brandWith(isReviewerId, 31337n);
const OTHER_REVIEWER: ReviewerId = brandWith(isReviewerId, 42n);
const CTX: TenantContext = { installationId: TENANT };

/** A hop shifting everything after line 1 down by three. */
const SHIFT_BY_THREE = [
  {
    file: "src/app.ts",
    hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 4 }],
  },
];

interface World {
  readonly client: PGlite;
  readonly handle: AppDatabase;
  readonly pullRequestId: PullRequestRowId;
}

async function freshWorld(): Promise<World> {
  const client = await freshPglite();
  const handle = fromDrizzle(drizzle(client, { schema }));
  const pr = await forTenant(handle, CTX).pullRequests.upsert({
    repoId: REPO,
    prNumber: 7,
    repoSlug: "acme/widgets",
    state: "open",
  });
  return { client, handle, pullRequestId: pr.id };
}

/** One Brief of the PR at `headIndex`, head SHA `head-<headIndex>`. */
async function seedBrief(
  world: World,
  headIndex: number,
  carriedChunkIds: readonly string[] = [],
  baseSha = "base",
): Promise<BriefRowId> {
  const written = await artifactStore(world.handle, CTX).briefs.write({
    pullRequestId: world.pullRequestId,
    baseSha,
    headSha: `head-${headIndex}`,
    headIndex,
    commitCount: headIndex,
    provider: "anthropic",
    model: "test",
    effort: "high",
    body: '{"brief":true}',
    carriedChunkIds,
  });
  if (!written.ok)
    throw new Error(`brief seed failed: ${written.error.message}`);
  return written.value.id;
}

/** The durable hop between two consecutive Brief heads. */
async function seedHop(
  world: World,
  fromIndex: number,
  toIndex: number,
  spans: unknown = SHIFT_BY_THREE,
): Promise<void> {
  const written = await artifactStore(world.handle, CTX).hunkSpans.write({
    pullRequestId: world.pullRequestId,
    baselineSha: `head-${fromIndex}`,
    headSha: `head-${toIndex}`,
    spans,
  });
  if (!written.ok) throw new Error(`hop seed failed: ${written.error.message}`);
}

/** The Brief row id at a head index. */
async function briefIdFor(
  world: World,
  headIndex: number,
): Promise<BriefRowId> {
  const row = await artifactStore(world.handle, CTX).briefs.get(
    world.pullRequestId,
    "base",
    `head-${headIndex}`,
  );
  if (row === undefined) throw new Error(`no brief at head-${headIndex}`);
  return row.id;
}

/** One integer count, for the "nothing was written" assertions. */
async function countRows(client: PGlite, table: string): Promise<number> {
  const result = await client.query<{ n: number }>(
    `select count(*)::int as n from ${table}`,
  );
  return result.rows[0]?.n ?? -1;
}

/**
 * A session on `briefId`, created the only way one can be: a materializing
 * write. The fixtures below then write its owned rows through the repository.
 */
async function openSession(
  world: World,
  briefId: BriefRowId,
  reviewerId: ReviewerId = REVIEWER,
): Promise<ReviewSessionId> {
  const created = await forTenant(
    world.handle,
    CTX,
  ).reviewSessions.writeToSession(
    { briefId, reviewerId, brief: artifact([], []) },
    async (writer) => writer.session.id,
  );
  if (!created.ok)
    throw new Error(`session seed failed: ${created.error.code}`);
  return created.value;
}

/** Run one owned write the only way there is: through the session's writer. */
async function write<T>(
  world: World,
  briefId: BriefRowId,
  body: (writer: SessionWriter) => Promise<T>,
  reviewerId: ReviewerId = REVIEWER,
): Promise<T> {
  const written = await forTenant(
    world.handle,
    CTX,
  ).reviewSessions.writeToSession(
    { briefId, reviewerId, brief: artifact([], []) },
    body,
  );
  if (!written.ok) throw new Error(`write failed: ${written.error.code}`);
  return written.value;
}

/** A previous session holding one draft comment on `src/app.ts:10-12`. */
async function seedPreviousComment(
  world: World,
  briefId: BriefRowId,
  reviewerId: ReviewerId = REVIEWER,
): Promise<void> {
  await openSession(world, briefId, reviewerId);
  await write(
    world,
    briefId,
    (writer) =>
      writer.addDraftComment({
        filePath: "src/app.ts",
        side: DraftCommentSide.NEW,
        startLine: 10,
        endLine: 12,
        body: "this allocation is unbounded",
      }),
    reviewerId,
  );
}

/** The Brief facts thunk the query takes; `artifact` builds a non-empty one. */
function artifact(
  groupIds: readonly string[],
  flags: readonly FlagKey[],
): () => Promise<BriefCarryFacts> {
  return async () => ({ groupIds, flags });
}

const NO_ARTIFACT = { brief: artifact([], []) } as const;

/** A thunk that records whether the Brief body was ever asked for. */
function createCountingArtifact(): {
  brief: () => Promise<BriefCarryFacts>;
  calls: () => number;
} {
  let calls = 0;
  return {
    brief: async () => {
      calls++;
      return { groupIds: [], flags: [] };
    },
    calls: () => calls,
  };
}

describe("preview — the read-side evaluation creates nothing", () => {
  it("carries nothing when the reviewer has no earlier session", async () => {
    const world = await freshWorld();
    const briefId = await seedBrief(world, 1);

    const view = await forTenant(world.handle, CTX).reviewSessions.preview({
      briefId,
      reviewerId: REVIEWER,
      ...NO_ARTIFACT,
    });

    expect(view.session).toBeUndefined();
    expect(view.carriedFrom).toBeUndefined();
    expect(view.carried.draftComments).toEqual([]);
    expect(await countRows(world.client, "review_session")).toBe(0);
  });

  it("moves a draft comment through one hop without writing a row", async () => {
    const world = await freshWorld();
    const previous = await seedBrief(world, 1);
    const current = await seedBrief(world, 2);
    await seedHop(world, 1, 2);
    await seedPreviousComment(world, previous);
    const before = await countRows(world.client, "review_session");

    const view = await forTenant(world.handle, CTX).reviewSessions.preview({
      briefId: current,
      reviewerId: REVIEWER,
      ...NO_ARTIFACT,
    });

    expect(view.session).toBeUndefined();
    expect(view.carried.draftComments).toEqual([
      expect.objectContaining({
        filePath: "src/app.ts",
        startLine: 13,
        endLine: 15,
        anchorStatus: "moved",
        body: "this allocation is unbounded",
      }),
    ]);
    expect(await countRows(world.client, "review_session")).toBe(before);
  });

  it("ignores another reviewer's earlier session", async () => {
    const world = await freshWorld();
    const previous = await seedBrief(world, 1);
    const current = await seedBrief(world, 2);
    await seedHop(world, 1, 2);
    await seedPreviousComment(world, previous, OTHER_REVIEWER);

    const view = await forTenant(world.handle, CTX).reviewSessions.preview({
      briefId: current,
      reviewerId: REVIEWER,
      ...NO_ARTIFACT,
    });

    expect(view.carried.draftComments).toEqual([]);
  });
});

describe("preview — several pushes are ONE evaluation", () => {
  it("composes 7 → 8 → 9 → 10 into a single remap", async () => {
    const world = await freshWorld();
    const previous = await seedBrief(world, 7);
    for (const index of [8, 9, 10]) await seedBrief(world, index);
    await seedHop(world, 7, 8);
    await seedHop(world, 8, 9);
    await seedHop(world, 9, 10);
    await seedPreviousComment(world, previous);

    const view = await forTenant(world.handle, CTX).reviewSessions.preview({
      briefId: await briefIdFor(world, 10),
      reviewerId: REVIEWER,
      ...NO_ARTIFACT,
    });

    // Three hops of +3 each, composed once — never three lists summed.
    expect(view.carried.draftComments).toEqual([
      expect.objectContaining({
        startLine: 19,
        endLine: 21,
        anchorStatus: "moved",
      }),
    ]);
  });

  it("orphans every anchor when one hop of the chain is missing", async () => {
    const world = await freshWorld();
    const previous = await seedBrief(world, 7);
    for (const index of [8, 9]) await seedBrief(world, index);
    await seedHop(world, 7, 8);
    // The 8 → 9 hop never landed: the chain cannot be linked end to end.
    await seedPreviousComment(world, previous);

    const view = await forTenant(world.handle, CTX).reviewSessions.preview({
      briefId: await briefIdFor(world, 9),
      reviewerId: REVIEWER,
      ...NO_ARTIFACT,
    });

    expect(view.carried.draftComments).toEqual([
      expect.objectContaining({
        startLine: 10,
        endLine: 12,
        anchorStatus: "orphaned",
      }),
    ]);
  });

  it("never links hops by insertion order", async () => {
    const world = await freshWorld();
    const previous = await seedBrief(world, 7);
    await seedBrief(world, 8);
    await seedBrief(world, 9);
    // A hop written LAST but belonging FIRST in the chain, plus a fork off the
    // shared baseline from a generation that failed — ordinal position is not
    // chain position.
    await seedHop(world, 8, 9);
    await seedHop(world, 7, 8);
    await seedHop(world, 7, 99);
    await seedPreviousComment(world, previous);

    const view = await forTenant(world.handle, CTX).reviewSessions.preview({
      briefId: await briefIdFor(world, 9),
      reviewerId: REVIEWER,
      ...NO_ARTIFACT,
    });

    expect(view.carried.draftComments).toEqual([
      expect.objectContaining({
        startLine: 16,
        endLine: 18,
        anchorStatus: "moved",
      }),
    ]);
  });
});

/** The previous session, holding one row of every kind that can carry. */
async function seedPreviousWork(
  world: World,
  briefId: BriefRowId,
  chunkIds: readonly string[] = ["c5"],
): Promise<void> {
  const id = await openSession(world, briefId);
  await write(world, briefId, async (writer) => {
    await writer.setReviewOutcome(ReviewOutcome.APPROVE);
    await writer.addDraftComment({
      filePath: "src/app.ts",
      side: DraftCommentSide.NEW,
      startLine: 10,
      endLine: 12,
      body: "draft",
    });
    await writer.addDraftComment({
      filePath: "src/app.ts",
      side: DraftCommentSide.NEW,
      startLine: 40,
      endLine: 41,
      body: "already on GitHub",
      status: DraftCommentStatus.SUBMITTED,
    });
    for (const chunkId of chunkIds) {
      await writer.putReadMark({ chunkId });
    }
    await writer.putReclassification({
      changeGroupId: "g1",
      category: ChangeGroupCategory.BUGFIX,
    });
    await writer.putReclassification({
      changeGroupId: "g9",
      category: ChangeGroupCategory.BUGFIX,
    });
  });
  await seedDisposition(world, briefId, 30, 32);
}

/** One `sql-injection` decision on `src/app.ts` over the given region. */
async function seedDisposition(
  world: World,
  briefId: BriefRowId,
  regionStart: number,
  regionEnd: number,
): Promise<void> {
  const id = await openSession(world, briefId);
  await world.client.query(
    `insert into disposition
       (installation_id, review_session_id, file_path, attribute,
        region_start, region_end, decision, decided_at)
     values ($1, $2, 'src/app.ts', 'sql-injection', $3, $4, 'dismissed', now())`,
    [TENANT.toString(), id.toString(), regionStart, regionEnd],
  );
}

const FIRING = [
  {
    filePath: "src/app.ts",
    attribute: "sql-injection",
    regionStart: 30,
    regionEnd: 40,
  },
];

describe("preview — what carries, per subject", () => {
  async function twoBriefs(
    carriedChunkIds: readonly string[],
    previousChunkIds: readonly string[] = ["c5"],
  ): Promise<{ world: World; previous: BriefRowId; current: BriefRowId }> {
    const world = await freshWorld();
    const previous = await seedBrief(world, 1);
    const current = await seedBrief(world, 2, carriedChunkIds);
    await seedHop(world, 1, 2);
    await seedPreviousWork(world, previous, previousChunkIds);
    return { world, previous, current };
  }

  it("carries a read mark whose chunk id is in the new Brief's carried set", async () => {
    const { world, current } = await twoBriefs(["c5"]);

    const view = await forTenant(world.handle, CTX).reviewSessions.preview({
      briefId: current,
      reviewerId: REVIEWER,
      brief: artifact(["g1"], FIRING),
    });

    expect(view.carried.readMarks).toEqual(["c5"]);
  });

  it("does NOT carry a read mark onto a re-minted chunk that merely shares its id", async () => {
    // `c5` exists in the new Brief but was NOT carried — chunk ids get a
    // collision guard, not descent, so this is a Chunk the reviewer never
    // opened. Marking it read would be a silent rubber-stamp.
    const { world, current } = await twoBriefs([]);

    const view = await forTenant(world.handle, CTX).reviewSessions.preview({
      briefId: current,
      reviewerId: REVIEWER,
      brief: artifact(["g1"], FIRING),
    });

    expect(view.carried.readMarks).toEqual([]);
  });

  it("carries a reclassification only where the group id survived descent", async () => {
    const { world, current } = await twoBriefs(["c5"]);

    const view = await forTenant(world.handle, CTX).reviewSessions.preview({
      briefId: current,
      reviewerId: REVIEWER,
      brief: artifact(["g1"], FIRING),
    });

    expect(
      view.carried.reclassifications.map((row) => row.changeGroupId),
    ).toEqual(["g1"]);
  });

  it("carries a draft but never a submitted comment", async () => {
    const { world, current } = await twoBriefs(["c5"]);

    const view = await forTenant(world.handle, CTX).reviewSessions.preview({
      briefId: current,
      reviewerId: REVIEWER,
      brief: artifact(["g1"], FIRING),
    });

    expect(view.carried.draftComments.map((row) => row.body)).toEqual([
      "draft",
    ]);
  });

  it("settles an untouched disposition and reopens a touched one", async () => {
    const { world, current } = await twoBriefs(["c5"]);

    const settled = await forTenant(world.handle, CTX).reviewSessions.preview({
      briefId: current,
      reviewerId: REVIEWER,
      brief: artifact([], FIRING),
    });
    expect(settled.carried.dispositions).toEqual([
      expect.objectContaining({
        carryStatus: "settled",
        regionStart: 33,
        regionEnd: 35,
      }),
    ]);

    // A hop landing inside the flagged region: any touch reopens.
    const touched = await freshWorld();
    const previous = await seedBrief(touched, 1);
    const currentTouched = await seedBrief(touched, 2);
    await seedHop(touched, 1, 2, [
      {
        file: "src/app.ts",
        hunks: [{ oldStart: 31, oldLines: 1, newStart: 31, newLines: 4 }],
      },
    ]);
    await seedPreviousWork(touched, previous);

    const view = await forTenant(touched.handle, CTX).reviewSessions.preview({
      briefId: currentTouched,
      reviewerId: REVIEWER,
      brief: artifact([], FIRING),
    });
    expect(view.carried.dispositions).toEqual([
      expect.objectContaining({
        carryStatus: "reopened",
        regionStart: 30,
        regionEnd: 32,
      }),
    ]);
  });

  it("drops the occurrence that vanished and keeps the surviving one live", async () => {
    // ONE attribute, TWO regions, one decision each. The new Brief still fires
    // it over the first region only: conflating the two would keep the removed
    // occurrence's decision alive and settle it under the survivor.
    const world = await freshWorld();
    const previous = await seedBrief(world, 1);
    const current = await seedBrief(world, 2);
    await seedHop(world, 1, 2);
    await seedPreviousWork(world, previous);
    await seedDisposition(world, previous, 60, 62);

    const view = await forTenant(world.handle, CTX).reviewSessions.preview({
      briefId: current,
      reviewerId: REVIEWER,
      brief: artifact([], FIRING),
    });

    // Row order is the previous session's insertion order: 30-32, then 60-62.
    // Both are remapped — a dropped row ships on current coordinates too, or
    // whatever now occupies its old lines reads as already decided.
    expect(
      view.carried.dispositions.map((row) => [
        row.regionStart,
        row.carryStatus,
      ]),
    ).toEqual([
      [33, "settled"],
      [63, "dropped"],
    ]);
  });

  it("clears a dangling evidence pointer and reports missing evidence", async () => {
    // `c9` is not in the new Brief's carried set, so the Chunk the decision
    // pointed at is gone: the decision reads as addressed with no proof.
    const { world, current } = await twoBriefs(["c5"]);
    await world.client.query(
      `update disposition set decision = 'addressed', evidence_kind =
         'chunk-reviewed', evidence_ref = 'c9'`,
    );

    const view = await forTenant(world.handle, CTX).reviewSessions.preview({
      briefId: current,
      reviewerId: REVIEWER,
      brief: artifact([], FIRING),
    });

    expect(view.carried.dispositions).toEqual([
      expect.objectContaining({
        carryStatus: "settled",
        evidenceStatus: "missing-evidence",
        evidence: null,
      }),
    ]);
  });

  it("keeps evidence that still stands, and a note that points at nothing", async () => {
    const { world, current } = await twoBriefs(["c5"]);
    await world.client.query(
      `update disposition set decision = 'addressed', evidence_kind =
         'chunk-reviewed', evidence_ref = 'c5'`,
    );

    const held = await forTenant(world.handle, CTX).reviewSessions.preview({
      briefId: current,
      reviewerId: REVIEWER,
      brief: artifact([], FIRING),
    });
    expect(held.carried.dispositions).toEqual([
      expect.objectContaining({
        evidenceStatus: null,
        evidence: { kind: "chunk-reviewed", ref: "c5" },
      }),
    ]);

    // A note is the reviewer's own words — there is nothing for it to dangle
    // against, whatever the new Brief dropped.
    await world.client.query(
      `update disposition set evidence_kind = 'manual-note', evidence_ref =
         'checked by hand'`,
    );
    const note = await forTenant(world.handle, CTX).reviewSessions.preview({
      briefId: current,
      reviewerId: REVIEWER,
      brief: artifact([], FIRING),
    });
    expect(note.carried.dispositions).toEqual([
      expect.objectContaining({ evidenceStatus: null }),
    ]);
  });

  it("keeps evidence naming a comment the reviewer published", async () => {
    // The submitted comment does not carry — GitHub holds it now — but the
    // proof it stands for is firmer than a draft's, not gone.
    const { world, current } = await twoBriefs(["c5"]);
    const submitted = await world.client.query<{ id: string }>(
      `select id::text as id from review_draft_comment
         where status = 'submitted'`,
    );
    await world.client.query(
      `update disposition set decision = 'addressed', evidence_kind =
         'linked-comment', evidence_ref = $1`,
      [submitted.rows[0]?.id],
    );

    const view = await forTenant(world.handle, CTX).reviewSessions.preview({
      briefId: current,
      reviewerId: REVIEWER,
      brief: artifact([], FIRING),
    });

    expect(view.carried.dispositions).toEqual([
      expect.objectContaining({ evidenceStatus: null }),
    ]);
  });

  it("drops a disposition whose flag no longer fires", async () => {
    const { world, current } = await twoBriefs(["c5"]);

    const view = await forTenant(world.handle, CTX).reviewSessions.preview({
      briefId: current,
      reviewerId: REVIEWER,
      brief: artifact([], []),
    });

    expect(view.carried.dispositions).toEqual([
      expect.objectContaining({ carryStatus: "dropped" }),
    ]);
  });
});

describe("preview — the rules a multi-push chain must not loosen", () => {
  it("does NOT carry a read mark that any step of the chain dropped", async () => {
    const world = await freshWorld();
    const previous = await seedBrief(world, 7);
    // Brief 8 still carries c5; Brief 9 re-mints it for unrelated content and
    // Brief 10 carries THAT one forward. Reading only the newest Brief's
    // carried set would rubber-stamp a Chunk the reviewer never opened.
    await seedBrief(world, 8, ["c5"]);
    await seedBrief(world, 9, []);
    await seedBrief(world, 10, ["c5"]);
    await seedHop(world, 7, 8);
    await seedHop(world, 8, 9);
    await seedHop(world, 9, 10);
    await seedPreviousWork(world, previous);

    const view = await forTenant(world.handle, CTX).reviewSessions.preview({
      briefId: await briefIdFor(world, 10),
      reviewerId: REVIEWER,
      brief: artifact([], FIRING),
    });

    expect(view.carried.readMarks).toEqual([]);
  });

  it("carries a read mark that survived every step", async () => {
    const world = await freshWorld();
    const previous = await seedBrief(world, 7);
    for (const index of [8, 9, 10]) await seedBrief(world, index, ["c5"]);
    await seedHop(world, 7, 8);
    await seedHop(world, 8, 9);
    await seedHop(world, 9, 10);
    await seedPreviousWork(world, previous);

    const view = await forTenant(world.handle, CTX).reviewSessions.preview({
      briefId: await briefIdFor(world, 10),
      reviewerId: REVIEWER,
      brief: artifact([], FIRING),
    });

    expect(view.carried.readMarks).toEqual(["c5"]);
  });

  it("orphans an old-side draft when the chain cannot be trusted", async () => {
    const world = await freshWorld();
    const previous = await seedBrief(world, 1);
    const current = await seedBrief(world, 2);
    // No hop row: nothing places anything, whichever side it sits on.
    const repo = forTenant(world.handle, CTX);
    await openSession(world, previous);
    await write(world, previous, (writer) =>
      writer.addDraftComment({
        filePath: "src/app.ts",
        side: DraftCommentSide.OLD,
        startLine: 10,
        endLine: 12,
        body: "on the removed side",
      }),
    );

    const view = await repo.reviewSessions.preview({
      briefId: current,
      reviewerId: REVIEWER,
      ...NO_ARTIFACT,
    });

    expect(view.carried.draftComments).toEqual([
      expect.objectContaining({ startLine: 10, anchorStatus: "orphaned" }),
    ]);
  });

  it("merges two decisions that remap onto one anchor, keeping the re-look", async () => {
    const world = await freshWorld();
    const previous = await seedBrief(world, 1);
    const current = await seedBrief(world, 2);
    // The hunk covers 30-32 (reopened, stays put) and shifts 50-52 back onto
    // 30-32 (settled). One anchor, one row — and the anchor is a unique key,
    // so a second row would abort the whole materialization.
    await seedHop(world, 1, 2, [
      {
        file: "src/app.ts",
        hunks: [{ oldStart: 30, oldLines: 25, newStart: 30, newLines: 0 }],
      },
    ]);
    const repo = forTenant(world.handle, CTX);
    const sessionId = await openSession(world, previous);
    for (const [start, end] of [
      [30, 32],
      [55, 57],
    ]) {
      await world.client.query(
        `insert into disposition
           (installation_id, review_session_id, file_path, attribute,
            region_start, region_end, decision, decided_at)
         values ($1, $2, 'src/app.ts', 'sql-injection', $3, $4, 'dismissed', now())`,
        [TENANT.toString(), sessionId.toString(), start, end],
      );
    }

    const view = await repo.reviewSessions.preview({
      briefId: current,
      reviewerId: REVIEWER,
      brief: artifact([], FIRING),
    });

    expect(view.carried.dispositions).toEqual([
      expect.objectContaining({
        regionStart: 30,
        regionEnd: 32,
        carryStatus: "reopened",
      }),
    ]);
  });

  it("returns the session and no carry-over once one exists", async () => {
    const world = await freshWorld();
    const previous = await seedBrief(world, 1);
    const current = await seedBrief(world, 2, ["c5"]);
    await seedHop(world, 1, 2);
    await seedPreviousWork(world, previous);
    const repo = forTenant(world.handle, CTX);
    const createdId = await openSession(world, current);

    const view = await repo.reviewSessions.preview({
      briefId: current,
      reviewerId: REVIEWER,
      brief: artifact(["g1"], FIRING),
    });

    expect(view.session?.session.id).toBe(createdId);
    expect(view.carried.draftComments).toEqual([]);
    expect(view.carried.readMarks).toEqual([]);
    // The source still reports: "carried in" outlives the evaluation, and the
    // reviewer's row has to survive the write that materialized the session.
    expect(view.carriedFrom).toBeDefined();
  });

  it("reports no source for a materialized first-ever session", async () => {
    const world = await freshWorld();
    const only = await seedBrief(world, 1);
    const repo = forTenant(world.handle, CTX);
    const createdId = await openSession(world, only);

    const view = await repo.reviewSessions.preview({
      briefId: only,
      reviewerId: REVIEWER,
      ...NO_ARTIFACT,
    });

    expect(view.session?.session.id).toBe(createdId);
    expect(view.carriedFrom).toBeUndefined();
  });

  it("never reads the Brief body when there is nothing to evaluate", async () => {
    const world = await freshWorld();
    const first = await seedBrief(world, 1);
    const repo = forTenant(world.handle, CTX);
    const firstEver = createCountingArtifact();

    await repo.reviewSessions.preview({
      briefId: first,
      reviewerId: REVIEWER,
      brief: firstEver.brief,
    });

    // A first-ever session has no predecessor to place, and a materialized
    // one holds its carry-over as rows — neither pays for the parse, and the
    // read runs on every page load.
    expect(firstEver.calls()).toBe(0);
    // The write that creates a first-ever session pays nothing either: there
    // is no predecessor, so the parse would be discarded.
    const materialized = createCountingArtifact();
    await repo.reviewSessions.writeToSession(
      { briefId: first, reviewerId: REVIEWER, brief: materialized.brief },
      (writer) => writer.putReadMark({ chunkId: "c1" }),
    );
    await repo.reviewSessions.writeToSession(
      { briefId: first, reviewerId: REVIEWER, brief: materialized.brief },
      (writer) => writer.putReadMark({ chunkId: "c2" }),
    );
    await repo.reviewSessions.preview({
      briefId: first,
      reviewerId: REVIEWER,
      brief: materialized.brief,
    });
    expect(materialized.calls()).toBe(0);
  });

  it("reads the Brief body exactly once when a carry-over is pending", async () => {
    const world = await freshWorld();
    const previous = await seedBrief(world, 1);
    const current = await seedBrief(world, 2);
    await seedHop(world, 1, 2);
    await seedPreviousComment(world, previous);
    const pending = createCountingArtifact();

    await forTenant(world.handle, CTX).reviewSessions.preview({
      briefId: current,
      reviewerId: REVIEWER,
      brief: pending.brief,
    });

    expect(pending.calls()).toBe(1);
  });
});

describe("old-side drafts against the PR base", () => {
  /** A previous session holding one old-side draft on `src/app.ts:10-12`. */
  async function seedOldSideDraft(
    world: World,
    briefId: BriefRowId,
  ): Promise<void> {
    await openSession(world, briefId);
    await write(world, briefId, (writer) =>
      writer.addDraftComment({
        filePath: "src/app.ts",
        side: DraftCommentSide.OLD,
        startLine: 10,
        endLine: 12,
        body: "on the removed side",
      }),
    );
  }

  it("keeps an old-side draft exact while the base holds still", async () => {
    const world = await freshWorld();
    const previous = await seedBrief(world, 1);
    const current = await seedBrief(world, 2);
    await seedHop(world, 1, 2);
    await seedOldSideDraft(world, previous);

    const view = await forTenant(world.handle, CTX).reviewSessions.preview({
      briefId: current,
      reviewerId: REVIEWER,
      ...NO_ARTIFACT,
    });

    // The hops say nothing about the base, and the base did not move.
    expect(view.carried.draftComments).toEqual([
      expect.objectContaining({
        startLine: 10,
        endLine: 12,
        anchorStatus: null,
      }),
    ]);
  });

  it("orphans an old-side draft when the PR is retargeted", async () => {
    const world = await freshWorld();
    const previous = await seedBrief(world, 1);
    // A retarget: the head chain still links, but the coordinates the draft
    // was written against belong to a base that is no longer the PR's.
    const current = await seedBrief(world, 2, [], "other-base");
    await seedHop(world, 1, 2);
    await seedOldSideDraft(world, previous);

    const view = await forTenant(world.handle, CTX).reviewSessions.preview({
      briefId: current,
      reviewerId: REVIEWER,
      ...NO_ARTIFACT,
    });

    expect(view.carried.draftComments).toEqual([
      expect.objectContaining({
        startLine: 10,
        endLine: 12,
        anchorStatus: "orphaned",
      }),
    ]);
  });
});

describe("writeToSession — the first write, one transaction", () => {
  /** Brief 1 carries work; brief 2 is where the reviewer writes next. */
  async function pending(): Promise<{ world: World; current: BriefRowId }> {
    const world = await freshWorld();
    const previous = await seedBrief(world, 1);
    const current = await seedBrief(world, 2, ["c5"]);
    await seedHop(world, 1, 2);
    await seedPreviousWork(world, previous);
    return { world, current };
  }

  const QUERY = { brief: artifact(["g1"], FIRING) } as const;

  it("creates the session, copies the carried rows, and applies the write", async () => {
    const { world, current } = await pending();

    const written = await forTenant(
      world.handle,
      CTX,
    ).reviewSessions.writeToSession(
      { briefId: current, reviewerId: REVIEWER, ...QUERY },
      (writer) =>
        writer.addDraftComment({
          filePath: "src/other.ts",
          side: DraftCommentSide.NEW,
          startLine: 1,
          endLine: 2,
          body: "the triggering write",
        }),
    );

    expect(written.ok).toBe(true);
    const snapshot = await forTenant(world.handle, CTX).reviewSessions.get({
      briefId: current,
      reviewerId: REVIEWER,
    });
    expect(snapshot?.draftComments.map((row) => row.body)).toEqual([
      "draft",
      "the triggering write",
    ]);
    const carried = snapshot?.draftComments[0];
    expect(carried?.startLine).toBe(13);
    expect(carried?.anchorStatus).toBe("moved");
    expect(carried?.carriedFromSessionId).not.toBeNull();
    expect(snapshot?.readMarks.map((row) => row.chunkId)).toEqual(["c5"]);
    expect(snapshot?.reclassifications.map((row) => row.changeGroupId)).toEqual(
      ["g1"],
    );
    expect(snapshot?.dispositions.map((row) => row.carryStatus)).toEqual([
      "settled",
    ]);
  });

  it("addresses a carried draft by the row it was copied from", async () => {
    const { world, current } = await pending();
    const repo = forTenant(world.handle, CTX);
    const previewed = await repo.reviewSessions.preview({
      briefId: current,
      reviewerId: REVIEWER,
      ...QUERY,
    });
    const sourceId = previewed.carried.draftComments[0]?.id;

    // The id the read handed out, used AFTER a different write materialized —
    // it still names the copy, because the copy points back at its source.
    await repo.reviewSessions.writeToSession(
      { briefId: current, reviewerId: REVIEWER, ...QUERY },
      (writer) => writer.putReadMark({ chunkId: "c5" }),
    );
    const edited = await repo.reviewSessions.writeToSession(
      { briefId: current, reviewerId: REVIEWER, ...QUERY },
      (writer) =>
        writer.updateDraftComment(sourceId ?? 0n, { body: "re-worded" }),
    );

    expect(edited.ok && edited.value?.body).toBe("re-worded");
    const snapshot = await repo.reviewSessions.get({
      briefId: current,
      reviewerId: REVIEWER,
    });
    expect(snapshot?.draftComments.map((row) => row.body)).toEqual([
      "re-worded",
    ]);
  });

  it("never carries the review outcome", async () => {
    const { world, current } = await pending();

    await forTenant(world.handle, CTX).reviewSessions.writeToSession(
      { briefId: current, reviewerId: REVIEWER, ...QUERY },
      (writer) => writer.putReadMark({ chunkId: "c9" }),
    );

    const snapshot = await forTenant(world.handle, CTX).reviewSessions.get({
      briefId: current,
      reviewerId: REVIEWER,
    });
    // The previous session approved; an approve riding onto new commits is the
    // one carry that does real damage.
    expect(snapshot?.session.reviewOutcome).toBe(ReviewOutcome.COMMENT);
  });

  // PGlite serializes transactions on one connection, so these two calls
  // cannot overlap here — what this pins is the mechanism that makes an
  // overlap safe: whichever writer loses the session insert never copies.
  it("copies each carried row once when a second first-write follows", async () => {
    const { world, current } = await pending();
    const repo = forTenant(world.handle, CTX);
    const key = { briefId: current, reviewerId: REVIEWER, ...QUERY };

    const [first, second] = await Promise.all([
      repo.reviewSessions.writeToSession(key, (writer) =>
        writer.putReadMark({ chunkId: "c8" }),
      ),
      repo.reviewSessions.writeToSession(key, (writer) =>
        writer.putReadMark({ chunkId: "c9" }),
      ),
    ]);

    expect(first.ok && second.ok).toBe(true);
    // Both writes landed; only one of them brought the carried rows.
    const snapshot = await repo.reviewSessions.get({
      briefId: current,
      reviewerId: REVIEWER,
    });
    // Only the creating writer copies; the loser goes straight to its write.
    expect(snapshot?.draftComments).toHaveLength(1);
    expect(snapshot?.readMarks.map((row) => row.chunkId).toSorted()).toEqual([
      "c5",
      "c8",
      "c9",
    ]);
  });

  it("re-reads the previous session inside the transaction", async () => {
    const { world, current } = await pending();
    const repo = forTenant(world.handle, CTX);
    const key = { briefId: current, reviewerId: REVIEWER, ...QUERY };

    // The read happened; the reviewer's other tab keeps typing on the old
    // Brief; then the write lands. The late row must still carry.
    await repo.reviewSessions.preview(key);
    await write(world, await briefIdFor(world, 1), (writer) =>
      writer.addDraftComment({
        filePath: "src/app.ts",
        side: DraftCommentSide.NEW,
        startLine: 20,
        endLine: 20,
        body: "typed after the read",
      }),
    );

    await repo.reviewSessions.writeToSession(key, (writer) =>
      writer.putReadMark({ chunkId: "c8" }),
    );

    const snapshot = await repo.reviewSessions.get({
      briefId: current,
      reviewerId: REVIEWER,
    });
    expect(snapshot?.draftComments.map((row) => row.body)).toEqual([
      "draft",
      "typed after the read",
    ]);
  });

  it("keeps an orphaned draft's last known coordinates", async () => {
    const world = await freshWorld();
    const previous = await seedBrief(world, 1);
    const current = await seedBrief(world, 2, ["c5"]);
    // No hop row at all: the chain is untrustworthy, so every anchor orphans.
    await seedPreviousWork(world, previous);

    await forTenant(world.handle, CTX).reviewSessions.writeToSession(
      { briefId: current, reviewerId: REVIEWER, ...QUERY },
      (writer) => writer.putReadMark({ chunkId: "c8" }),
    );

    const snapshot = await forTenant(world.handle, CTX).reviewSessions.get({
      briefId: current,
      reviewerId: REVIEWER,
    });
    // There is no sentinel for "unplaced" — the CHECK forbids one — so the
    // row keeps the file and line it was last placed at.
    expect(snapshot?.draftComments[0]).toEqual(
      expect.objectContaining({
        filePath: "src/app.ts",
        startLine: 10,
        endLine: 12,
        anchorStatus: "orphaned",
      }),
    );
  });
});

describe("freeze — a session freezes only when a newer one is materialized", () => {
  it("accepts a write while a newer Brief merely exists", async () => {
    const world = await freshWorld();
    const first = await seedBrief(world, 1);
    await seedBrief(world, 2);
    await seedHop(world, 1, 2);

    const written = await forTenant(
      world.handle,
      CTX,
    ).reviewSessions.writeToSession(
      { briefId: first, reviewerId: REVIEWER, brief: artifact([], []) },
      (writer) => writer.putReadMark({ chunkId: "c1" }),
    );

    expect(written.ok).toBe(true);
  });

  it("refuses a write once the reviewer materialized a newer session", async () => {
    const world = await freshWorld();
    const first = await seedBrief(world, 1);
    const second = await seedBrief(world, 2);
    await seedHop(world, 1, 2);
    const repo = forTenant(world.handle, CTX);
    const older = {
      briefId: first,
      reviewerId: REVIEWER,
      brief: artifact([], []),
    };

    await repo.reviewSessions.writeToSession(older, (writer) =>
      writer.putReadMark({ chunkId: "c1" }),
    );
    await repo.reviewSessions.writeToSession(
      { briefId: second, reviewerId: REVIEWER, brief: artifact([], []) },
      (writer) => writer.putReadMark({ chunkId: "c2" }),
    );

    const refused = await repo.reviewSessions.writeToSession(older, (writer) =>
      writer.putReadMark({ chunkId: "c3" }),
    );

    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.error.code).toBe(ReviewSessionErrorCode.SESSION_FROZEN);
    const snapshot = await repo.reviewSessions.get({
      briefId: first,
      reviewerId: REVIEWER,
    });
    expect(snapshot?.readMarks.map((row) => row.chunkId)).toEqual(["c1"]);
  });

  it("leaves another reviewer's newer session out of it", async () => {
    const world = await freshWorld();
    const first = await seedBrief(world, 1);
    const second = await seedBrief(world, 2);
    await seedHop(world, 1, 2);
    const repo = forTenant(world.handle, CTX);

    await repo.reviewSessions.writeToSession(
      { briefId: second, reviewerId: OTHER_REVIEWER, brief: artifact([], []) },
      (writer) => writer.putReadMark({ chunkId: "c2" }),
    );
    const written = await repo.reviewSessions.writeToSession(
      { briefId: first, reviewerId: REVIEWER, brief: artifact([], []) },
      (writer) => writer.putReadMark({ chunkId: "c1" }),
    );

    expect(written.ok).toBe(true);
  });
});

describe("the session writer covers every product write", () => {
  it("records a disposition and sets the outcome inside the transaction", async () => {
    const world = await freshWorld();
    const briefId = await seedBrief(world, 1);
    const repo = forTenant(world.handle, CTX);

    const written = await repo.reviewSessions.writeToSession(
      { briefId, reviewerId: REVIEWER, brief: artifact([], []) },
      async (writer) => {
        await writer.putDisposition({
          filePath: "src/app.ts",
          attribute: "sql-injection",
          regionStart: 10,
          regionEnd: 20,
          decision: DispositionDecision.DISMISSED,
          reason: "test-only path",
        });
        return writer.setReviewOutcome(ReviewOutcome.APPROVE);
      },
    );

    expect(written.ok).toBe(true);
    const snapshot = await repo.reviewSessions.get({
      briefId,
      reviewerId: REVIEWER,
    });
    expect(snapshot?.session.reviewOutcome).toBe(ReviewOutcome.APPROVE);
    expect(snapshot?.dispositions).toEqual([
      expect.objectContaining({
        attribute: "sql-injection",
        decision: DispositionDecision.DISMISSED,
        reason: "test-only path",
        carryStatus: null,
      }),
    ]);
  });

  it("clears the carried status when the reviewer decides again", async () => {
    const world = await freshWorld();
    const previous = await seedBrief(world, 1);
    const current = await seedBrief(world, 2, ["c5"]);
    await seedHop(world, 1, 2);
    await seedPreviousWork(world, previous);
    const repo = forTenant(world.handle, CTX);
    const key = {
      briefId: current,
      reviewerId: REVIEWER,
      brief: artifact([], FIRING),
    };

    await repo.reviewSessions.writeToSession(key, (writer) =>
      writer.putReadMark({ chunkId: "c8" }),
    );
    // The carried row sits at the remapped anchor; deciding on it again is an
    // upsert, not a second row.
    await repo.reviewSessions.writeToSession(key, (writer) =>
      writer.putDisposition({
        filePath: "src/app.ts",
        attribute: "sql-injection",
        regionStart: 33,
        regionEnd: 35,
        decision: DispositionDecision.ADDRESSED,
      }),
    );

    const snapshot = await repo.reviewSessions.get({
      briefId: current,
      reviewerId: REVIEWER,
    });
    expect(snapshot?.dispositions).toEqual([
      expect.objectContaining({
        decision: DispositionDecision.ADDRESSED,
        carryStatus: null,
      }),
    ]);
  });

  it("deletes a disposition by its anchor, and says so when none was held", async () => {
    const world = await freshWorld();
    const briefId = await seedBrief(world, 1);
    const repo = forTenant(world.handle, CTX);
    const anchor = {
      filePath: "src/app.ts",
      attribute: "sql-injection",
      regionStart: 10,
      regionEnd: 20,
    };

    const undone = await repo.reviewSessions.writeToSession(
      { briefId, reviewerId: REVIEWER, brief: artifact([], []) },
      async (writer) => {
        await writer.putDisposition({
          ...anchor,
          decision: DispositionDecision.DISMISSED,
          reason: "test-only path",
        });
        // Undoing twice is the same undo: an undecided flag is a row that
        // does not exist, so the repeat has nothing left to remove.
        return [
          await writer.deleteDisposition(anchor),
          await writer.deleteDisposition(anchor),
        ];
      },
    );

    expect(undone).toEqual({ ok: true, value: [true, false] });
    const snapshot = await repo.reviewSessions.get({
      briefId,
      reviewerId: REVIEWER,
    });
    expect(snapshot?.dispositions).toEqual([]);
  });
});
