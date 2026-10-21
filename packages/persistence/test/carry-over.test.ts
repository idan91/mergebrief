// Exercise carry through the tenant-bound store. A wrong anchor can look valid,
// so include negative cases where a re-minted chunk merely reused an id.
import type { PGlite } from "@electric-sql/pglite";
import { CommentAnchorKinds, type Mutable } from "types";
import { describe, expect, it } from "vitest";
import {
  createArtifactStore,
  createTenantRepository,
  ReviewSessionErrorCodes,
  ScopeViolationError,
} from "../src/index";
import type { FlagKey } from "brief-core/artifact";
import type {
  AppDatabase,
  BriefWriteInput,
  ReviewDraftCommentRow,
  ReviewSessionError,
  ReviewSessionRepository,
  ReviewSessionView,
  TenantContext,
} from "../src/index";
import type { Result } from "types/utils";
import {
  isInstallationId,
  isRepoId,
  isReviewerId,
  type BriefRowId,
  type DraftAnchor,
  type InstallationId,
  type PullRequestRowId,
  type RepoId,
  type ReviewerId,
  type ReviewSessionId,
} from "../src/types";
import { ChangeGroupCategories, ReviewOutcomes } from "types/reviews";
import { DispositionDecisions } from "types/dispositions";
import { DiffSides, type DiffSide } from "types/comments";
import { brandWith, registerSharedPglite } from "./helpers";

const TENANT: InstallationId = brandWith(isInstallationId, 1000n);
const REPO: RepoId = brandWith(isRepoId, 777n);
const REVIEWER: ReviewerId = brandWith(isReviewerId, 31337n);
const OTHER_REVIEWER: ReviewerId = brandWith(isReviewerId, 42n);
const CTX: TenantContext = { installationId: TENANT };
const EMPTY_BRIEF_BODY = '{"changeGroups":[],"chunks":[]}';
const UNREADABLE_BODY = "{ not json";

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

const shared = registerSharedPglite();

async function makeWorld(): Promise<World> {
  const { client, handle } = shared;
  const pr = await createTenantRepository(handle, CTX).pullRequests.upsert({
    repoId: REPO,
    prNumber: 7,
    repoSlug: "acme/widgets",
    state: "open",
  });
  return { client, handle, pullRequestId: pr.id };
}

/**
 * One Brief of the PR at `headIndex`, head SHA `head-<headIndex>`. Stamped
 * `anchored` unless a test says otherwise, an unstamped chain drops every
 * reclassification, which is its own test, not this suite's default.
 */
async function seedBrief(
  world: World,
  headIndex: number,
  carriedChunkIds: readonly string[] = [],
  baseSha = "base",
  anchorState: string | null = "anchored",
  headSha = "",
): Promise<BriefRowId> {
  const briefWrite: Mutable<BriefWriteInput> = {
    pullRequestId: world.pullRequestId,
    baseSha,
    headSha: headSha === "" ? `head-${headIndex}` : headSha,
    headIndex,
    commitCount: headIndex,
    provider: "anthropic",
    model: "test",
    effort: "high",
    body: EMPTY_BRIEF_BODY,
    carriedChunkIds,
    usedGroupIds: [],
  };

  if (anchorState !== null) {
    briefWrite.anchorState = anchorState;
  }
  if (anchorState === "fresh-restart") {
    briefWrite.anchorReason = "model-swap";
  }

  const written = await createArtifactStore(world.handle, CTX).briefs.write(
    briefWrite,
  );
  return written.id;
}

/** The durable hop between two consecutive Brief heads. */
async function seedHop(
  world: World,
  fromIndex: number,
  toIndex: number,
  spans: unknown = SHIFT_BY_THREE,
): Promise<void> {
  await createArtifactStore(world.handle, CTX).hunkSpans.write({
    pullRequestId: world.pullRequestId,
    baselineSha: `head-${fromIndex}`,
    headSha: `head-${toIndex}`,
    spans,
  });
}

/** The Brief row id at a head index. */
async function briefIdFor(
  world: World,
  headIndex: number,
): Promise<BriefRowId> {
  const row = await createArtifactStore(world.handle, CTX).briefs.get(
    world.pullRequestId,
    "base",
    `head-${headIndex}`,
  );
  if (row === undefined) {
    throw new Error(`no brief at head-${headIndex}`);
  }
  return row.id;
}

/** One integer count, for the "nothing was written" assertions. */
async function countRows(client: PGlite, table: string): Promise<number> {
  const result = await client.query<{ n: number }>(
    `select count(*)::int as n from ${table}`,
  );
  return result.rows[0]?.n ?? -1;
}

/** The value of a write these fixtures expect to land. */
function unwrapWrite<Value>(
  written: Result<Value, ReviewSessionError>,
  subject: string,
): Value {
  if (!written.ok) {
    throw new Error(`${subject} seed failed: ${written.error.code}`);
  }
  return written.value;
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
  const created = await createTenantRepository(
    world.handle,
    CTX,
  ).reviewSessions.setOutcome({ briefId, reviewerId }, ReviewOutcomes.COMMENT);
  return unwrapWrite(created, "session").id;
}

/** One draft on the session, through the reviewer's own draft action. */
async function seedDraft(
  world: World,
  briefId: BriefRowId,
  anchor: DraftAnchor,
  body: string,
  reviewerId: ReviewerId = REVIEWER,
): Promise<ReviewDraftCommentRow> {
  const added = await createTenantRepository(
    world.handle,
    CTX,
  ).reviewSessions.addDraft({ briefId, reviewerId }, { anchor, body });
  return unwrapWrite(added, "draft");
}

/** A Line anchor on `src/app.ts` over the given new-side lines. */
function makeLineAnchor(
  startLine: number,
  endLine: number,
  side: DiffSide = DiffSides.NEW,
): DraftAnchor {
  return {
    kind: CommentAnchorKinds.LINE,
    file: "src/app.ts",
    side,
    startLine,
    endLine,
  };
}

/** A previous session holding one draft comment on `src/app.ts:10-12`. */
async function seedPreviousComment(
  world: World,
  briefId: BriefRowId,
  reviewerId: ReviewerId = REVIEWER,
): Promise<void> {
  await seedDraft(
    world,
    briefId,
    makeLineAnchor(10, 12),
    "this allocation is unbounded",
    reviewerId,
  );
}

/** A Brief body emitting exactly these groups, flags and file paths. */
function shapeBriefBody(
  groupIds: readonly string[],
  flags: readonly FlagKey[],
  filePaths: readonly string[],
): string {
  const flagChunks = flags.map((flag, index) => ({
    id: `flag-${index}`,
    file: flag.filePath,
    addedRanges: [{ start: flag.regionStart, end: flag.regionEnd }],
    riskSurface: [flag.attribute],
  }));
  const pathChunks = filePaths.map((file, index) => ({
    id: `path-${index}`,
    file,
  }));
  return JSON.stringify({
    changeGroups: groupIds.map((id) => ({ id })),
    chunks: [...flagChunks, ...pathChunks],
  });
}

/** Rewrite a seeded Brief's body so it emits these facts. */
async function seedBriefFacts(
  world: World,
  briefId: BriefRowId,
  groupIds: readonly string[],
  flags: readonly FlagKey[],
  filePaths: readonly string[] = [],
): Promise<void> {
  await seedBriefBody(
    world,
    briefId,
    shapeBriefBody(groupIds, flags, filePaths),
  );
}

/** A raw rewrite stores no counts, so the session limits read this body. */
async function seedBriefBody(
  world: World,
  briefId: BriefRowId,
  body: string,
): Promise<void> {
  await world.client.query(
    `update brief set body = $1, session_chunk_count = null,
       session_group_count = null, session_flag_count = null
     where id = $2`,
    [body, briefId.toString()],
  );
}

async function unwrapPreview(
  previewed: ReturnType<ReviewSessionRepository["preview"]>,
): Promise<ReviewSessionView> {
  const read = await previewed;
  if (!read.ok) {
    throw new Error(`preview failed: ${read.error.code}`);
  }
  return read.value;
}

/** A previous session holding one File comment on `src/app.ts`. */
async function seedPreviousFileComment(
  world: World,
  briefId: BriefRowId,
  reviewerId: ReviewerId = REVIEWER,
): Promise<void> {
  await seedDraft(
    world,
    briefId,
    { kind: CommentAnchorKinds.FILE, file: "src/app.ts" },
    "comment on the file",
    reviewerId,
  );
}

describe("preview, the read-side evaluation creates nothing", () => {
  it("carries nothing when the reviewer has no earlier session", async () => {
    const world = await makeWorld();
    const briefId = await seedBrief(world, 1);

    const view = await unwrapPreview(
      createTenantRepository(world.handle, CTX).reviewSessions.preview({
        briefId,
        reviewerId: REVIEWER,
      }),
    );

    expect(view.session).toBeUndefined();
    expect(view.carriedFrom).toBeUndefined();
    expect(view.carried.draftComments).toEqual([]);
    expect(await countRows(world.client, "review_session")).toBe(0);
  });

  it("moves a draft comment through one hop without writing a row", async () => {
    const world = await makeWorld();
    const previous = await seedBrief(world, 1);
    const current = await seedBrief(world, 2);
    await seedHop(world, 1, 2);
    await seedPreviousComment(world, previous);
    const before = await countRows(world.client, "review_session");

    const view = await unwrapPreview(
      createTenantRepository(world.handle, CTX).reviewSessions.preview({
        briefId: current,
        reviewerId: REVIEWER,
      }),
    );

    expect(view.session).toBeUndefined();
    expect(view.carried.draftComments).toEqual([
      expect.objectContaining({
        anchor: expect.objectContaining({
          file: "src/app.ts",
          startLine: 13,
          endLine: 15,
        }),
        anchorStatus: "moved",
        body: "this allocation is unbounded",
      }),
    ]);
    expect(await countRows(world.client, "review_session")).toBe(before);
  });

  it("ignores another reviewer's earlier session", async () => {
    const world = await makeWorld();
    const previous = await seedBrief(world, 1);
    const current = await seedBrief(world, 2);
    await seedHop(world, 1, 2);
    await seedPreviousComment(world, previous, OTHER_REVIEWER);

    const view = await unwrapPreview(
      createTenantRepository(world.handle, CTX).reviewSessions.preview({
        briefId: current,
        reviewerId: REVIEWER,
      }),
    );

    expect(view.carried.draftComments).toEqual([]);
  });
});

describe("preview, a File comment follows the path not a line-map", () => {
  it("attaches a File comment whose path is still in the Brief", async () => {
    const world = await makeWorld();
    const previous = await seedBrief(world, 1);
    const current = await seedBrief(world, 2);
    await seedHop(world, 1, 2);
    await seedPreviousFileComment(world, previous);

    await seedBriefFacts(world, current, [], [], ["src/app.ts"]);
    const view = await unwrapPreview(
      createTenantRepository(world.handle, CTX).reviewSessions.preview({
        briefId: current,
        reviewerId: REVIEWER,
      }),
    );

    expect(view.carried.draftComments).toEqual([
      expect.objectContaining({
        anchor: {
          kind: CommentAnchorKinds.FILE,
          file: "src/app.ts",
        },
        anchorStatus: null,
        body: "comment on the file",
      }),
    ]);
  });

  it("orphans a File comment whose path left the Brief", async () => {
    const world = await makeWorld();
    const previous = await seedBrief(world, 1);
    const current = await seedBrief(world, 2);
    await seedHop(world, 1, 2);
    await seedPreviousFileComment(world, previous);

    await seedBriefFacts(world, current, [], [], ["src/other.ts"]);
    const view = await unwrapPreview(
      createTenantRepository(world.handle, CTX).reviewSessions.preview({
        briefId: current,
        reviewerId: REVIEWER,
      }),
    );

    expect(view.carried.draftComments).toEqual([
      expect.objectContaining({
        anchor: {
          kind: CommentAnchorKinds.FILE,
          file: "src/app.ts",
        },
        anchorStatus: "orphaned",
      }),
    ]);
  });
});

describe("preview, several pushes are ONE evaluation", () => {
  it("composes 7 → 8 → 9 → 10 into a single remap", async () => {
    const world = await makeWorld();
    const previous = await seedBrief(world, 7);
    for (const index of [8, 9, 10]) {
      await seedBrief(world, index);
    }
    await seedHop(world, 7, 8);
    await seedHop(world, 8, 9);
    await seedHop(world, 9, 10);
    await seedPreviousComment(world, previous);

    const view = await unwrapPreview(
      createTenantRepository(world.handle, CTX).reviewSessions.preview({
        briefId: await briefIdFor(world, 10),
        reviewerId: REVIEWER,
      }),
    );

    // Three hops of +3 each, composed once, never three lists summed.
    expect(view.carried.draftComments).toEqual([
      expect.objectContaining({
        anchor: expect.objectContaining({
          startLine: 19,
          endLine: 21,
        }),
        anchorStatus: "moved",
      }),
    ]);
  });

  it("orphans every anchor when one hop of the chain is missing", async () => {
    const world = await makeWorld();
    const previous = await seedBrief(world, 7);
    for (const index of [8, 9]) {
      await seedBrief(world, index);
    }
    await seedHop(world, 7, 8);
    // The 8 → 9 hop never landed: the chain cannot be linked end to end.
    await seedPreviousComment(world, previous);

    const view = await unwrapPreview(
      createTenantRepository(world.handle, CTX).reviewSessions.preview({
        briefId: await briefIdFor(world, 9),
        reviewerId: REVIEWER,
      }),
    );

    expect(view.carried.draftComments).toEqual([
      expect.objectContaining({
        anchor: expect.objectContaining({
          startLine: 10,
          endLine: 12,
        }),
        anchorStatus: "orphaned",
      }),
    ]);
  });

  it("never links hops by insertion order", async () => {
    const world = await makeWorld();
    const previous = await seedBrief(world, 7);
    await seedBrief(world, 8);
    await seedBrief(world, 9);
    // A hop written LAST but belonging FIRST in the chain, plus a fork off the
    // shared baseline from a generation that failed, ordinal position is not
    // chain position.
    await seedHop(world, 8, 9);
    await seedHop(world, 7, 8);
    await seedHop(world, 7, 99);
    await seedPreviousComment(world, previous);

    const view = await unwrapPreview(
      createTenantRepository(world.handle, CTX).reviewSessions.preview({
        briefId: await briefIdFor(world, 9),
        reviewerId: REVIEWER,
      }),
    );

    expect(view.carried.draftComments).toEqual([
      expect.objectContaining({
        anchor: expect.objectContaining({
          startLine: 16,
          endLine: 18,
        }),
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
  const groupIds = ["g1", "g9"];
  await seedBriefBody(
    world,
    briefId,
    JSON.stringify({
      changeGroups: groupIds.map((id) => ({ id })),
      chunks: chunkIds.map((id) => ({ id, file: "src/app.ts" })),
    }),
  );
  const sessions = createTenantRepository(world.handle, CTX).reviewSessions;
  const key = { briefId, reviewerId: REVIEWER };
  unwrapWrite(
    await sessions.setOutcome(key, ReviewOutcomes.APPROVE),
    "outcome",
  );
  await seedDraft(world, briefId, makeLineAnchor(10, 12), "draft");
  const published = await seedDraft(
    world,
    briefId,
    makeLineAnchor(40, 41),
    "already on GitHub",
  );
  unwrapWrite(
    await sessions.recordPublishedDrafts(key, { draftIds: [published.id] }),
    "publish",
  );
  for (const chunkId of chunkIds) {
    unwrapWrite(
      await sessions.setChunkRead(key, { chunkId, read: true }),
      "read mark",
    );
  }
  for (const changeGroupId of groupIds) {
    unwrapWrite(
      await sessions.reclassifyGroup(key, {
        changeGroupId,
        category: ChangeGroupCategories.BUGFIX,
      }),
      "reclassification",
    );
  }
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

describe("preview, what carries, per subject", () => {
  async function twoBriefs(
    carriedChunkIds: readonly string[],
    previousChunkIds: readonly string[] = ["c5"],
  ): Promise<{ world: World; previous: BriefRowId; current: BriefRowId }> {
    const world = await makeWorld();
    const previous = await seedBrief(world, 1);
    const current = await seedBrief(world, 2, carriedChunkIds);
    await seedHop(world, 1, 2);
    await seedPreviousWork(world, previous, previousChunkIds);
    return { world, previous, current };
  }

  it("carries a read mark, a surviving group and a draft, not a posted one", async () => {
    const { world, current } = await twoBriefs(["c5"]);

    await seedBriefFacts(world, current, ["g1"], FIRING);
    const view = await unwrapPreview(
      createTenantRepository(world.handle, CTX).reviewSessions.preview({
        briefId: current,
        reviewerId: REVIEWER,
      }),
    );

    expect(view.carried.readMarks).toEqual(["c5"]);
    expect(
      view.carried.reclassifications.map((row) => row.changeGroupId),
    ).toEqual(["g1"]);
    expect(view.carried.draftComments.map((row) => row.body)).toEqual([
      "draft",
    ]);
  });

  it("refuses read marks on re-minted chunks that merely reuse ids", async () => {
    // `c5` exists in the new Brief but was NOT carried, chunk ids get a
    // collision guard, not descent, so this is a Chunk the reviewer never
    // opened. Marking it read would be a silent rubber-stamp.
    const { world, current } = await twoBriefs([]);

    await seedBriefFacts(world, current, ["g1"], FIRING);
    const view = await unwrapPreview(
      createTenantRepository(world.handle, CTX).reviewSessions.preview({
        briefId: current,
        reviewerId: REVIEWER,
      }),
    );

    expect(view.carried.readMarks).toEqual([]);
  });

  it("does NOT carry a reclassification across a fresh-restart brief", async () => {
    // The current Brief re-derived its groups from scratch: `g1` being
    // present again is numbering coincidence, not the group the reviewer
    // judged, the override must drop, exactly as a read mark would.
    const world = await makeWorld();
    const previous = await seedBrief(world, 1);
    const current = await seedBrief(world, 2, [], "base", "fresh-restart");
    await seedHop(world, 1, 2);
    await seedPreviousWork(world, previous, ["c5"]);

    await seedBriefFacts(world, current, ["g1"], FIRING);
    const view = await unwrapPreview(
      createTenantRepository(world.handle, CTX).reviewSessions.preview({
        briefId: current,
        reviewerId: REVIEWER,
      }),
    );

    expect(view.carried.reclassifications).toEqual([]);
  });

  it("does NOT carry a reclassification across a brief with no anchor stamp", async () => {
    // NULL anchor state (a row predating the stamp) is not proof of descent,
    // ambiguity biases to dropping.
    const world = await makeWorld();
    const previous = await seedBrief(world, 1);
    const current = await seedBrief(world, 2, [], "base", null);
    await seedHop(world, 1, 2);
    await seedPreviousWork(world, previous, ["c5"]);

    await seedBriefFacts(world, current, ["g1"], FIRING);
    const view = await unwrapPreview(
      createTenantRepository(world.handle, CTX).reviewSessions.preview({
        briefId: current,
        reviewerId: REVIEWER,
      }),
    );

    expect(view.carried.reclassifications).toEqual([]);
  });

  it("does NOT carry a reclassification when the restart sits mid-chain", async () => {
    // Brief 2 re-derived from scratch; brief 3 descending from IT proves
    // nothing about brief 1's groups, the whole span must have descended.
    const world = await makeWorld();
    const previous = await seedBrief(world, 1);
    await seedBrief(world, 2, [], "base", "fresh-restart");
    const current = await seedBrief(world, 3);
    await seedHop(world, 1, 2);
    await seedHop(world, 2, 3);
    await seedPreviousWork(world, previous, ["c5"]);

    await seedBriefFacts(world, current, ["g1"], FIRING);
    const view = await unwrapPreview(
      createTenantRepository(world.handle, CTX).reviewSessions.preview({
        briefId: current,
        reviewerId: REVIEWER,
      }),
    );

    expect(view.carried.reclassifications).toEqual([]);
  });

  it("carries when only the previous session's OWN brief was a restart", async () => {
    // That brief's stamp describes the hop BEFORE the carried span, the
    // reviewer judged its groups directly, so it must not gate the carry.
    const world = await makeWorld();
    const previous = await seedBrief(world, 1, [], "base", "fresh-restart");
    const current = await seedBrief(world, 2, []);
    await seedHop(world, 1, 2);
    await seedPreviousWork(world, previous, ["c5"]);

    await seedBriefFacts(world, current, ["g1"], FIRING);
    const view = await unwrapPreview(
      createTenantRepository(world.handle, CTX).reviewSessions.preview({
        briefId: current,
        reviewerId: REVIEWER,
      }),
    );

    expect(
      view.carried.reclassifications.map((row) => row.changeGroupId),
    ).toEqual(["g1"]);
  });

  it("does NOT carry a reclassification across a same-head retarget hop", async () => {
    // A base retarget re-briefs the same head: the generation anchors to the
    // nearest DIFFERENT head, skipping the chain-adjacent brief, so its
    // `anchored` stamp says nothing about the groups the reviewer judged.
    const world = await makeWorld();
    const previous = await seedBrief(world, 1);
    const current = await seedBrief(
      world,
      2,
      [],
      "base-2",
      "anchored",
      "head-1",
    );
    await seedPreviousWork(world, previous, ["c5"]);

    await seedBriefFacts(world, current, ["g1"], FIRING);
    const view = await unwrapPreview(
      createTenantRepository(world.handle, CTX).reviewSessions.preview({
        briefId: current,
        reviewerId: REVIEWER,
      }),
    );

    expect(view.carried.reclassifications).toEqual([]);
  });

  it("settles a disposition no hop touched", async () => {
    const { world, current } = await twoBriefs(["c5"]);

    await seedBriefFacts(world, current, [], FIRING);
    const settled = await unwrapPreview(
      createTenantRepository(world.handle, CTX).reviewSessions.preview({
        briefId: current,
        reviewerId: REVIEWER,
      }),
    );
    expect(settled.carried.dispositions).toEqual([
      expect.objectContaining({
        carryStatus: "settled",
        regionStart: 33,
        regionEnd: 35,
      }),
    ]);
  });

  it("reopens a disposition a hop landed inside", async () => {
    const touched = await makeWorld();
    const previous = await seedBrief(touched, 1);
    const currentTouched = await seedBrief(touched, 2);
    await seedHop(touched, 1, 2, [
      {
        file: "src/app.ts",
        hunks: [{ oldStart: 31, oldLines: 1, newStart: 31, newLines: 4 }],
      },
    ]);
    await seedPreviousWork(touched, previous);

    await seedBriefFacts(touched, currentTouched, [], FIRING);
    const view = await unwrapPreview(
      createTenantRepository(touched.handle, CTX).reviewSessions.preview({
        briefId: currentTouched,
        reviewerId: REVIEWER,
      }),
    );
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
    const world = await makeWorld();
    const previous = await seedBrief(world, 1);
    const current = await seedBrief(world, 2);
    await seedHop(world, 1, 2);
    await seedPreviousWork(world, previous);
    await seedDisposition(world, previous, 60, 62);

    await seedBriefFacts(world, current, [], FIRING);
    const view = await unwrapPreview(
      createTenantRepository(world.handle, CTX).reviewSessions.preview({
        briefId: current,
        reviewerId: REVIEWER,
      }),
    );

    // Row order is the previous session's insertion order: 30-32, then 60-62.
    // Both are remapped, a dropped row ships on current coordinates too, or
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

    await seedBriefFacts(world, current, [], FIRING);
    const view = await unwrapPreview(
      createTenantRepository(world.handle, CTX).reviewSessions.preview({
        briefId: current,
        reviewerId: REVIEWER,
      }),
    );

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

    await seedBriefFacts(world, current, [], FIRING);
    const held = await unwrapPreview(
      createTenantRepository(world.handle, CTX).reviewSessions.preview({
        briefId: current,
        reviewerId: REVIEWER,
      }),
    );
    expect(held.carried.dispositions).toEqual([
      expect.objectContaining({
        evidenceStatus: null,
        evidence: { kind: "chunk-reviewed", ref: "c5" },
      }),
    ]);

    // A note is the reviewer's own words, there is nothing for it to dangle
    // against, whatever the new Brief dropped.
    await world.client.query(
      `update disposition set evidence_kind = 'manual-note', evidence_ref =
         'checked by hand'`,
    );
    await seedBriefFacts(world, current, [], FIRING);
    const note = await unwrapPreview(
      createTenantRepository(world.handle, CTX).reviewSessions.preview({
        briefId: current,
        reviewerId: REVIEWER,
      }),
    );
    expect(note.carried.dispositions).toEqual([
      expect.objectContaining({ evidenceStatus: null }),
    ]);
  });

  it("keeps evidence naming a comment the reviewer published", async () => {
    // The submitted comment does not carry, GitHub holds it now, but the
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

    await seedBriefFacts(world, current, [], FIRING);
    const view = await unwrapPreview(
      createTenantRepository(world.handle, CTX).reviewSessions.preview({
        briefId: current,
        reviewerId: REVIEWER,
      }),
    );

    expect(view.carried.dispositions).toEqual([
      expect.objectContaining({ evidenceStatus: null }),
    ]);
  });

  it("drops a disposition whose flag no longer fires", async () => {
    const { world, current } = await twoBriefs(["c5"]);

    const view = await unwrapPreview(
      createTenantRepository(world.handle, CTX).reviewSessions.preview({
        briefId: current,
        reviewerId: REVIEWER,
      }),
    );

    expect(view.carried.dispositions).toEqual([
      expect.objectContaining({ carryStatus: "dropped" }),
    ]);
  });
});

describe("preview, the rules a multi-push chain must not loosen", () => {
  it("does NOT carry a read mark that any step of the chain dropped", async () => {
    const world = await makeWorld();
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

    const current = await briefIdFor(world, 10);
    await seedBriefFacts(world, current, [], FIRING);
    const view = await unwrapPreview(
      createTenantRepository(world.handle, CTX).reviewSessions.preview({
        briefId: current,
        reviewerId: REVIEWER,
      }),
    );

    expect(view.carried.readMarks).toEqual([]);
  });

  it("carries a read mark that survived every step", async () => {
    const world = await makeWorld();
    const previous = await seedBrief(world, 7);
    for (const index of [8, 9, 10]) {
      await seedBrief(world, index, ["c5"]);
    }
    await seedHop(world, 7, 8);
    await seedHop(world, 8, 9);
    await seedHop(world, 9, 10);
    await seedPreviousWork(world, previous);

    const current = await briefIdFor(world, 10);
    await seedBriefFacts(world, current, [], FIRING);
    const view = await unwrapPreview(
      createTenantRepository(world.handle, CTX).reviewSessions.preview({
        briefId: current,
        reviewerId: REVIEWER,
      }),
    );

    expect(view.carried.readMarks).toEqual(["c5"]);
  });

  it("orphans an old-side draft when the chain cannot be trusted", async () => {
    const world = await makeWorld();
    const previous = await seedBrief(world, 1);
    const current = await seedBrief(world, 2);
    // No hop row: nothing places anything, whichever side it sits on.
    const repo = createTenantRepository(world.handle, CTX);
    await seedDraft(
      world,
      previous,
      makeLineAnchor(10, 12, DiffSides.OLD),
      "on the removed side",
    );

    const view = await unwrapPreview(
      repo.reviewSessions.preview({
        briefId: current,
        reviewerId: REVIEWER,
      }),
    );

    expect(view.carried.draftComments).toEqual([
      expect.objectContaining({
        anchor: expect.objectContaining({ startLine: 10 }),
        anchorStatus: "orphaned",
      }),
    ]);
  });

  it("merges two decisions that remap onto one anchor, keeping the re-look", async () => {
    const world = await makeWorld();
    const previous = await seedBrief(world, 1);
    const current = await seedBrief(world, 2);
    // The hunk covers 30-32 (reopened, stays put) and shifts 50-52 back onto
    // 30-32 (settled). One anchor, one row, and the anchor is a unique key,
    // so a second row would abort the whole materialization.
    await seedHop(world, 1, 2, [
      {
        file: "src/app.ts",
        hunks: [{ oldStart: 30, oldLines: 25, newStart: 30, newLines: 0 }],
      },
    ]);
    const repo = createTenantRepository(world.handle, CTX);
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

    await seedBriefFacts(world, current, [], FIRING);
    const view = await unwrapPreview(
      repo.reviewSessions.preview({
        briefId: current,
        reviewerId: REVIEWER,
      }),
    );

    expect(view.carried.dispositions).toEqual([
      expect.objectContaining({
        regionStart: 30,
        regionEnd: 32,
        carryStatus: "reopened",
      }),
    ]);
  });

  it("returns the session and no carry-over once one exists", async () => {
    const world = await makeWorld();
    const previous = await seedBrief(world, 1);
    const current = await seedBrief(world, 2, ["c5"]);
    await seedHop(world, 1, 2);
    await seedPreviousWork(world, previous);
    const repo = createTenantRepository(world.handle, CTX);
    const createdId = await openSession(world, current);

    await seedBriefFacts(world, current, ["g1"], FIRING);
    const view = await unwrapPreview(
      repo.reviewSessions.preview({
        briefId: current,
        reviewerId: REVIEWER,
      }),
    );

    expect(view.session?.session.id).toBe(createdId);
    expect(view.carried.draftComments).toEqual([]);
    expect(view.carried.readMarks).toEqual([]);
    // The source still reports: "carried in" outlives the evaluation, and the
    // reviewer's row has to survive the write that materialized the session.
    expect(view.carriedFrom).toBeDefined();
  });

  it("reports no source for a materialized first-ever session", async () => {
    const world = await makeWorld();
    const only = await seedBrief(world, 1);
    const repo = createTenantRepository(world.handle, CTX);
    const createdId = await openSession(world, only);

    const view = await unwrapPreview(
      repo.reviewSessions.preview({
        briefId: only,
        reviewerId: REVIEWER,
      }),
    );

    expect(view.session?.session.id).toBe(createdId);
    expect(view.carriedFrom).toBeUndefined();
  });

  it("needs no readable body when there is nothing to evaluate", async () => {
    const world = await makeWorld();
    const first = await seedBrief(world, 1);
    await seedBriefBody(world, first, UNREADABLE_BODY);
    const repo = createTenantRepository(world.handle, CTX);
    const key = { briefId: first, reviewerId: REVIEWER };

    const firstEver = await repo.reviewSessions.preview(key);
    const created = await repo.reviewSessions.setOutcome(
      key,
      ReviewOutcomes.APPROVE,
    );
    const again = await repo.reviewSessions.setOutcome(
      key,
      ReviewOutcomes.COMMENT,
    );

    expect(firstEver.ok).toBe(true);
    expect(created.ok).toBe(true);
    expect(again.ok).toBe(true);
  });

  it("needs no readable body once the session holds its carry-over", async () => {
    const world = await makeWorld();
    const previous = await seedBrief(world, 1);
    const current = await seedBrief(world, 2);
    await seedHop(world, 1, 2);
    await seedPreviousComment(world, previous);
    const repo = createTenantRepository(world.handle, CTX);
    const key = { briefId: current, reviewerId: REVIEWER };
    await repo.reviewSessions.setOutcome(key, ReviewOutcomes.APPROVE);
    await seedBriefBody(world, current, UNREADABLE_BODY);

    const view = await unwrapPreview(repo.reviewSessions.preview(key));
    const written = await repo.reviewSessions.setOutcome(
      key,
      ReviewOutcomes.COMMENT,
    );
    const marked = await repo.reviewSessions.setChunkRead(key, {
      chunkId: "c1",
      read: true,
    });

    expect(view.session?.draftComments).toHaveLength(1);
    expect(written.ok).toBe(true);
    expect(marked.ok).toBe(true);
  });

  it.each([
    ["a body that is not JSON", UNREADABLE_BODY],
    ["a body missing the carry lists", '{"summary":"the brief"}'],
  ])("refuses a pending carry-over over %s", async (_label, body) => {
    const world = await makeWorld();
    const previous = await seedBrief(world, 1);
    const current = await seedBrief(world, 2);
    await seedHop(world, 1, 2);
    await seedPreviousComment(world, previous);
    await seedBriefBody(world, current, body);
    const repo = createTenantRepository(world.handle, CTX);
    const key = { briefId: current, reviewerId: REVIEWER };
    const before = await countRows(world.client, "review_session");

    const previewed = await repo.reviewSessions.preview(key);
    const written = await repo.reviewSessions.setOutcome(
      key,
      ReviewOutcomes.APPROVE,
    );
    const marked = await repo.reviewSessions.setChunkRead(key, {
      chunkId: "c1",
      read: true,
    });

    const unreadable = {
      ok: false,
      error: expect.objectContaining({
        code: ReviewSessionErrorCodes.BRIEF_UNREADABLE,
      }),
    };
    expect(previewed).toEqual(unreadable);
    expect(written).toEqual(unreadable);
    expect(marked).toEqual(unreadable);
    expect(await countRows(world.client, "review_session")).toBe(before);
  });
});

describe("old-side drafts against the PR base", () => {
  /** A previous session holding one old-side draft on `src/app.ts:10-12`. */
  async function seedOldSideDraft(
    world: World,
    briefId: BriefRowId,
  ): Promise<void> {
    await seedDraft(
      world,
      briefId,
      makeLineAnchor(10, 12, DiffSides.OLD),
      "on the removed side",
    );
  }

  it("keeps an old-side draft exact while the base holds still", async () => {
    const world = await makeWorld();
    const previous = await seedBrief(world, 1);
    const current = await seedBrief(world, 2);
    await seedHop(world, 1, 2);
    await seedOldSideDraft(world, previous);

    const view = await unwrapPreview(
      createTenantRepository(world.handle, CTX).reviewSessions.preview({
        briefId: current,
        reviewerId: REVIEWER,
      }),
    );

    // The hops say nothing about the base, and the base did not move.
    expect(view.carried.draftComments).toEqual([
      expect.objectContaining({
        anchor: expect.objectContaining({
          startLine: 10,
          endLine: 12,
        }),
        anchorStatus: null,
      }),
    ]);
  });

  it("orphans an old-side draft when the PR is retargeted", async () => {
    const world = await makeWorld();
    const previous = await seedBrief(world, 1);
    // A retarget: the head chain still links, but the coordinates the draft
    // was written against belong to a base that is no longer the PR's.
    const current = await seedBrief(world, 2, [], "other-base");
    await seedHop(world, 1, 2);
    await seedOldSideDraft(world, previous);

    const view = await unwrapPreview(
      createTenantRepository(world.handle, CTX).reviewSessions.preview({
        briefId: current,
        reviewerId: REVIEWER,
      }),
    );

    expect(view.carried.draftComments).toEqual([
      expect.objectContaining({
        anchor: expect.objectContaining({
          startLine: 10,
          endLine: 12,
        }),
        anchorStatus: "orphaned",
      }),
    ]);
  });
});

describe("two-side drafts, both legs or orphan", () => {
  /** One two-side draft; direction picked by which side holds the start. */
  async function seedTwoSideDraft(
    world: World,
    briefId: BriefRowId,
    anchor: {
      startSide: DiffSide;
      side: DiffSide;
      startLine: number;
      endLine: number;
    },
  ): Promise<void> {
    await seedDraft(
      world,
      briefId,
      { kind: CommentAnchorKinds.LINE, file: "src/app.ts", ...anchor },
      "spans both sides",
    );
  }

  async function previewCurrent(world: World, current: BriefRowId) {
    return await unwrapPreview(
      createTenantRepository(world.handle, CTX).reviewSessions.preview({
        briefId: current,
        reviewerId: REVIEWER,
      }),
    );
  }

  it("moves only the new leg through an old-to-new hop", async () => {
    const world = await makeWorld();
    const previous = await seedBrief(world, 1);
    const current = await seedBrief(world, 2);
    await seedHop(world, 1, 2);
    await seedTwoSideDraft(world, previous, {
      startSide: DiffSides.OLD,
      side: DiffSides.NEW,
      startLine: 10,
      endLine: 12,
    });

    const view = await previewCurrent(world, current);

    // The old leg rides the base, which held; the new leg shifts by three.
    expect(view.carried.draftComments).toEqual([
      expect.objectContaining({
        anchor: expect.objectContaining({
          startSide: DiffSides.OLD,
          startLine: 10,
          endLine: 15,
        }),
        anchorStatus: "moved",
      }),
    ]);
  });

  it("moves only the new leg through a new-to-old hop", async () => {
    const world = await makeWorld();
    const previous = await seedBrief(world, 1);
    const current = await seedBrief(world, 2);
    await seedHop(world, 1, 2);
    await seedTwoSideDraft(world, previous, {
      startSide: DiffSides.NEW,
      side: DiffSides.OLD,
      startLine: 10,
      endLine: 20,
    });

    const view = await previewCurrent(world, current);

    expect(view.carried.draftComments).toEqual([
      expect.objectContaining({
        anchor: expect.objectContaining({
          startSide: DiffSides.NEW,
          startLine: 13,
          endLine: 20,
        }),
        anchorStatus: "moved",
      }),
    ]);
  });

  it("keeps a two-side draft exact when the push touched another file", async () => {
    const world = await makeWorld();
    const previous = await seedBrief(world, 1);
    const current = await seedBrief(world, 2);
    await seedHop(world, 1, 2, [
      {
        file: "src/other.ts",
        hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 4 }],
      },
    ]);
    await seedTwoSideDraft(world, previous, {
      startSide: DiffSides.OLD,
      side: DiffSides.NEW,
      startLine: 10,
      endLine: 12,
    });

    const view = await previewCurrent(world, current);

    expect(view.carried.draftComments).toEqual([
      expect.objectContaining({
        anchor: expect.objectContaining({
          startSide: DiffSides.OLD,
          startLine: 10,
          endLine: 12,
        }),
        anchorStatus: null,
      }),
    ]);
  });

  it("orphans the whole draft when the push rewrote the new leg's line", async () => {
    const world = await makeWorld();
    const previous = await seedBrief(world, 1);
    const current = await seedBrief(world, 2);
    // The hunk overlaps line 12 itself: the new leg demotes, and the intact
    // old leg must not shrink the range to single-side.
    await seedHop(world, 1, 2, [
      {
        file: "src/app.ts",
        hunks: [{ oldStart: 12, oldLines: 1, newStart: 12, newLines: 2 }],
      },
    ]);
    await seedTwoSideDraft(world, previous, {
      startSide: DiffSides.OLD,
      side: DiffSides.NEW,
      startLine: 10,
      endLine: 12,
    });

    const view = await previewCurrent(world, current);

    expect(view.carried.draftComments).toEqual([
      expect.objectContaining({
        anchor: expect.objectContaining({
          startSide: DiffSides.OLD,
          startLine: 10,
          endLine: 12,
        }),
        anchorStatus: "orphaned",
      }),
    ]);
  });

  it("orphans the whole draft on a retarget, even with the hop intact", async () => {
    const world = await makeWorld();
    const previous = await seedBrief(world, 1);
    const current = await seedBrief(world, 2, [], "other-base");
    await seedHop(world, 1, 2);
    await seedTwoSideDraft(world, previous, {
      startSide: DiffSides.NEW,
      side: DiffSides.OLD,
      startLine: 10,
      endLine: 20,
    });

    const view = await previewCurrent(world, current);

    // The old leg lost its base; the placeable new leg must not survive alone.
    expect(view.carried.draftComments).toEqual([
      expect.objectContaining({
        anchor: expect.objectContaining({
          startSide: DiffSides.NEW,
          startLine: 10,
          endLine: 20,
        }),
        anchorStatus: "orphaned",
      }),
    ]);
  });

  it("orphans the whole draft when the hop chain cannot be linked", async () => {
    const world = await makeWorld();
    const previous = await seedBrief(world, 1);
    const current = await seedBrief(world, 2);
    // No hop row at all.
    await seedTwoSideDraft(world, previous, {
      startSide: DiffSides.OLD,
      side: DiffSides.NEW,
      startLine: 10,
      endLine: 12,
    });

    const view = await previewCurrent(world, current);

    expect(view.carried.draftComments).toEqual([
      expect.objectContaining({ anchorStatus: "orphaned" }),
    ]);
  });
});

describe("the first write, one transaction", () => {
  /** Brief 1 carries work; brief 2 is where the reviewer writes next. */
  async function pending(): Promise<{ world: World; current: BriefRowId }> {
    const world = await makeWorld();
    const previous = await seedBrief(world, 1);
    const current = await seedBrief(world, 2, ["c5"]);
    await seedHop(world, 1, 2);
    await seedPreviousWork(world, previous);
    await seedBriefFacts(world, current, ["g1"], FIRING);
    return { world, current };
  }

  const OTHER_FILE_ANCHOR: DraftAnchor = {
    kind: CommentAnchorKinds.LINE,
    file: "src/other.ts",
    side: DiffSides.NEW,
    startLine: 1,
    endLine: 2,
  };

  it("creates the session, copies the carried rows, and applies the write", async () => {
    const { world, current } = await pending();

    const written = await createTenantRepository(
      world.handle,
      CTX,
    ).reviewSessions.addDraft(
      { briefId: current, reviewerId: REVIEWER },
      { anchor: OTHER_FILE_ANCHOR, body: "the triggering write" },
    );

    expect(written.ok).toBe(true);
    const snapshot = await createTenantRepository(
      world.handle,
      CTX,
    ).reviewSessions.get({
      briefId: current,
      reviewerId: REVIEWER,
    });
    expect(snapshot?.draftComments.map((row) => row.body)).toEqual([
      "draft",
      "the triggering write",
    ]);
    const carried = snapshot?.draftComments[0];
    expect(carried?.anchor).toEqual(
      expect.objectContaining({
        kind: CommentAnchorKinds.LINE,
        startLine: 13,
      }),
    );
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
    const repo = createTenantRepository(world.handle, CTX);
    const key = { briefId: current, reviewerId: REVIEWER };
    const previewed = await unwrapPreview(repo.reviewSessions.preview(key));
    const sourceId = previewed.carried.draftComments[0]?.id;

    // The id the read handed out, used AFTER a different write materialized,
    // it still names the copy, because the copy points back at its source.
    await repo.reviewSessions.setOutcome(key, ReviewOutcomes.REQUEST_CHANGES);
    const edited = await repo.reviewSessions.editDraft(
      key,
      sourceId ?? 0n,
      "re-worded",
    );

    expect(edited.ok && edited.value.body).toBe("re-worded");
    const snapshot = await repo.reviewSessions.get(key);
    expect(snapshot?.draftComments.map((row) => row.body)).toEqual([
      "re-worded",
    ]);
  });

  it("edits and deletes a carried draft by its source id", async () => {
    const { world, current } = await pending();
    const sessions = createTenantRepository(world.handle, CTX).reviewSessions;
    const key = { briefId: current, reviewerId: REVIEWER };
    const previewed = await unwrapPreview(sessions.preview(key));
    const sourceId = previewed.carried.draftComments[0]?.id ?? 0n;

    const edited = await sessions.editDraft(key, sourceId, "re-worded");
    const deleted = await sessions.deleteDraft(key, sourceId);

    expect(edited.ok && edited.value.body).toBe("re-worded");
    expect(deleted.ok && deleted.value.carriedFromCommentId).toBe(sourceId);
    expect((await sessions.get(key))?.draftComments).toEqual([]);
  });

  it("rolls a refused first draft edit back, carry and session too", async () => {
    const { world, current } = await pending();
    const sessions = createTenantRepository(world.handle, CTX).reviewSessions;
    const draftsBefore = await countRows(world.client, "review_draft_comment");

    await expect(
      sessions.editDraft(
        { briefId: current, reviewerId: REVIEWER },
        987654321n,
        "edited",
      ),
    ).rejects.toBeInstanceOf(ScopeViolationError);

    expect(await countRows(world.client, "review_session")).toBe(1);
    expect(await countRows(world.client, "review_draft_comment")).toBe(
      draftsBefore,
    );
  });

  it("rolls a refused first capped write back, carry and session too", async () => {
    const { world, current } = await pending();
    const sessions = createTenantRepository(world.handle, CTX).reviewSessions;
    const marksBefore = await countRows(world.client, "review_read_mark");

    const refused = await sessions.reclassifyGroup(
      { briefId: current, reviewerId: REVIEWER },
      { changeGroupId: "g2", category: ChangeGroupCategories.BUGFIX },
    );

    expect(!refused.ok && refused.error.code).toBe(
      ReviewSessionErrorCodes.SESSION_RECORD_LIMIT_REACHED,
    );
    expect(await countRows(world.client, "review_session")).toBe(1);
    expect(await countRows(world.client, "review_read_mark")).toBe(marksBefore);
  });

  it("never carries the review outcome", async () => {
    const { world, current } = await pending();

    await createTenantRepository(world.handle, CTX).reviewSessions.addDraft(
      { briefId: current, reviewerId: REVIEWER },
      { anchor: OTHER_FILE_ANCHOR, body: "the triggering write" },
    );

    const snapshot = await createTenantRepository(
      world.handle,
      CTX,
    ).reviewSessions.get({
      briefId: current,
      reviewerId: REVIEWER,
    });
    // The previous session approved; an approve riding onto new commits is the
    // one carry that does real damage.
    expect(snapshot?.session.reviewOutcome).toBe(ReviewOutcomes.COMMENT);
  });

  // PGlite serializes transactions on one connection, so these two calls
  // cannot overlap here, what this pins is the mechanism that makes an
  // overlap safe: whichever writer loses the session insert never copies.
  it("copies each carried row once when a second first-write follows", async () => {
    const { world, current } = await pending();
    const repo = createTenantRepository(world.handle, CTX);
    const key = { briefId: current, reviewerId: REVIEWER };

    const [first, second] = await Promise.all([
      repo.reviewSessions.addDraft(key, {
        anchor: OTHER_FILE_ANCHOR,
        body: "first",
      }),
      repo.reviewSessions.addDraft(key, {
        anchor: OTHER_FILE_ANCHOR,
        body: "second",
      }),
    ]);

    expect(first.ok && second.ok).toBe(true);
    // Both writes landed; only one of them brought the carried rows.
    const snapshot = await repo.reviewSessions.get(key);
    expect(snapshot?.draftComments.map((row) => row.body).toSorted()).toEqual([
      "draft",
      "first",
      "second",
    ]);
    expect(snapshot?.readMarks.map((row) => row.chunkId)).toEqual(["c5"]);
  });

  it("re-reads the previous session inside the transaction", async () => {
    const { world, current } = await pending();
    const repo = createTenantRepository(world.handle, CTX);
    const key = { briefId: current, reviewerId: REVIEWER };

    // The read happened; the reviewer's other tab keeps typing on the old
    // Brief; then the write lands. The late row must still carry.
    await unwrapPreview(repo.reviewSessions.preview(key));
    await seedDraft(
      world,
      await briefIdFor(world, 1),
      makeLineAnchor(20, 20),
      "typed after the read",
    );

    await repo.reviewSessions.setOutcome(key, ReviewOutcomes.REQUEST_CHANGES);

    const snapshot = await repo.reviewSessions.get(key);
    expect(snapshot?.draftComments.map((row) => row.body)).toEqual([
      "draft",
      "typed after the read",
    ]);
  });

  it("keeps an orphaned draft's last known coordinates", async () => {
    const world = await makeWorld();
    const previous = await seedBrief(world, 1);
    const current = await seedBrief(world, 2, ["c5"]);
    // No hop row at all: the chain is untrustworthy, so every anchor orphans.
    await seedPreviousWork(world, previous);

    await openSession(world, current);

    const snapshot = await createTenantRepository(
      world.handle,
      CTX,
    ).reviewSessions.get({
      briefId: current,
      reviewerId: REVIEWER,
    });
    // There is no sentinel for "unplaced", the CHECK forbids one, so the
    // row keeps the file and line it was last placed at.
    expect(snapshot?.draftComments[0]).toEqual(
      expect.objectContaining({
        anchor: expect.objectContaining({
          file: "src/app.ts",
          startLine: 10,
          endLine: 12,
        }),
        anchorStatus: "orphaned",
      }),
    );
  });
});

describe("publish claims across a carry-over", () => {
  /** A claimed draft on brief 1, then the reviewer's first write on brief 2. */
  async function claimedThenCarried() {
    const world = await makeWorld();
    const previous = await seedBrief(world, 1);
    const current = await seedBrief(world, 2);
    await seedHop(world, 1, 2);
    const sessions = createTenantRepository(world.handle, CTX).reviewSessions;
    const older = { briefId: previous, reviewerId: REVIEWER };
    const newer = { briefId: current, reviewerId: REVIEWER };
    const source = await seedDraft(
      world,
      previous,
      makeLineAnchor(10, 12),
      "x",
    );
    const claimed = unwrapWrite(
      await sessions.claimDrafts(older, { draftIds: [source.id] }),
      "claim",
    );
    await openSession(world, current);
    return { sessions, older, newer, source, claim: claimed.claim };
  }

  async function readClaimColumns(world: World) {
    const result = await world.client.query<{
      status: string;
      publish_claim: string | null;
    }>("select status, publish_claim from review_draft_comment order by id");
    return result.rows.map((row) => [row.status, row.publish_claim]);
  }

  it("copies the source's claim onto the carried draft", async () => {
    const { sessions, older, newer, source, claim } =
      await claimedThenCarried();

    const copy = (await sessions.get(newer))?.draftComments[0];
    const held = (await sessions.get(older))?.draftComments[0];

    expect(copy?.carriedFromCommentId).toBe(source.id);
    expect(copy?.publishClaim).toBe(claim);
    expect(held?.publishClaimedAt).toBeInstanceOf(Date);
    expect(copy?.publishClaimedAt).toEqual(held?.publishClaimedAt);
  });

  it("refuses an edit of the carried copy while the claim is pending", async () => {
    const { sessions, newer, source } = await claimedThenCarried();

    const refused = await sessions.editDraft(newer, source.id, "edited");

    expect(!refused.ok && refused.error.code).toBe(
      ReviewSessionErrorCodes.DRAFT_PUBLISH_PENDING,
    );
  });

  it("settles both rows through the frozen source session", async () => {
    const world = await makeWorld();
    const previous = await seedBrief(world, 1);
    const current = await seedBrief(world, 2);
    await seedHop(world, 1, 2);
    const sessions = createTenantRepository(world.handle, CTX).reviewSessions;
    const older = { briefId: previous, reviewerId: REVIEWER };
    const source = await seedDraft(
      world,
      previous,
      makeLineAnchor(10, 12),
      "x",
    );
    const { claim } = unwrapWrite(
      await sessions.claimDrafts(older, { draftIds: [source.id] }),
      "claim",
    );
    await openSession(world, current);

    const settled = await sessions.settleClaim(older, {
      claim,
      githubReviewId: 77n,
    });

    expect(settled).toEqual({ ok: true, value: 2 });
    expect(await readClaimColumns(world)).toEqual([
      ["submitted", null],
      ["submitted", null],
    ]);
    const snapshot = await sessions.get(older);
    expect(snapshot?.submittedReviews.map((row) => row.githubReviewId)).toEqual(
      [77n],
    );
  });

  it("releases both rows through the frozen source session", async () => {
    const world = await makeWorld();
    const previous = await seedBrief(world, 1);
    const current = await seedBrief(world, 2);
    await seedHop(world, 1, 2);
    const sessions = createTenantRepository(world.handle, CTX).reviewSessions;
    const older = { briefId: previous, reviewerId: REVIEWER };
    const source = await seedDraft(
      world,
      previous,
      makeLineAnchor(10, 12),
      "x",
    );
    const { claim } = unwrapWrite(
      await sessions.claimDrafts(older, { draftIds: [source.id] }),
      "claim",
    );
    await openSession(world, current);

    const released = await sessions.releaseClaim(older, { claim });

    expect(released).toEqual({ ok: true, value: 2 });
    expect(await readClaimColumns(world)).toEqual([
      ["draft", null],
      ["draft", null],
    ]);
  });

  it("leaves another reviewer's rows alone on settle", async () => {
    const world = await makeWorld();
    const previous = await seedBrief(world, 1);
    const sessions = createTenantRepository(world.handle, CTX).reviewSessions;
    const mine = { briefId: previous, reviewerId: REVIEWER };
    const theirs = { briefId: previous, reviewerId: OTHER_REVIEWER };
    const anchor = makeLineAnchor(10, 12);
    const own = await seedDraft(world, previous, anchor, "mine");
    const other = await seedDraft(
      world,
      previous,
      anchor,
      "theirs",
      OTHER_REVIEWER,
    );
    const { claim } = unwrapWrite(
      await sessions.claimDrafts(mine, { draftIds: [own.id] }),
      "claim",
    );
    unwrapWrite(
      await sessions.claimDrafts(theirs, { draftIds: [other.id] }),
      "their claim",
    );

    const settled = await sessions.settleClaim(theirs, { claim });

    expect(settled).toEqual({ ok: true, value: 0 });
    const held = (await sessions.get(mine))?.draftComments[0];
    expect(held?.status).toBe("draft");
    expect(held?.publishClaim).toBe(claim);
  });
});

describe("freeze, a session freezes only when a newer one is materialized", () => {
  it("accepts a write while a newer Brief merely exists", async () => {
    const world = await makeWorld();
    const first = await seedBrief(world, 1);
    await seedBrief(world, 2);
    await seedHop(world, 1, 2);

    const written = await createTenantRepository(
      world.handle,
      CTX,
    ).reviewSessions.setOutcome(
      { briefId: first, reviewerId: REVIEWER },
      ReviewOutcomes.APPROVE,
    );

    expect(written.ok).toBe(true);
  });

  it("refuses every review work operation on a frozen session", async () => {
    const world = await makeWorld();
    const first = await seedBrief(world, 1);
    const second = await seedBrief(world, 2);
    await seedHop(world, 1, 2);
    await seedBriefFacts(world, first, ["g1"], FIRING);
    const sessions = createTenantRepository(world.handle, CTX).reviewSessions;
    const older = { briefId: first, reviewerId: REVIEWER };
    await sessions.setOutcome(older, ReviewOutcomes.APPROVE);
    await openSession(world, second);
    const flag = {
      filePath: "src/app.ts",
      attribute: "sql-injection",
      regionStart: 30,
      regionEnd: 40,
    };

    const refusals = [
      await sessions.setChunkRead(older, { chunkId: "flag-0", read: true }),
      await sessions.setChunkRead(older, { chunkId: "flag-0", read: false }),
      await sessions.reclassifyGroup(older, {
        changeGroupId: "g1",
        category: ChangeGroupCategories.BUGFIX,
      }),
      await sessions.decideRisks(older, [
        { ...flag, decision: DispositionDecisions.DISMISSED, reason: "x" },
      ]),
      await sessions.reopenRisks(older, [flag]),
      await sessions.setOutcome(older, ReviewOutcomes.COMMENT),
      await sessions.listDrafts(older),
      await sessions.recordPublishedDrafts(older, { draftIds: [] }),
      await sessions.recordReplyReview(older, 77n),
    ];

    expect(
      refusals.map((refusal) => !refusal.ok && refusal.error.code),
    ).toEqual(Array(9).fill(ReviewSessionErrorCodes.SESSION_FROZEN));
    const snapshot = await sessions.get(older);
    expect(snapshot?.session.reviewOutcome).toBe(ReviewOutcomes.APPROVE);
  });

  it("refuses every draft operation on a frozen session", async () => {
    const world = await makeWorld();
    const first = await seedBrief(world, 1);
    const second = await seedBrief(world, 2);
    await seedHop(world, 1, 2);
    const sessions = createTenantRepository(world.handle, CTX).reviewSessions;
    const older = { briefId: first, reviewerId: REVIEWER };
    const anchor = { kind: CommentAnchorKinds.FILE, file: "src/app.ts" };
    const added = await sessions.addDraft(older, { anchor, body: "first" });
    if (!added.ok) {
      throw new Error("draft seed failed");
    }
    await openSession(world, second);

    const refusals = [
      await sessions.addDraft(older, { anchor, body: "late" }),
      await sessions.editDraft(older, added.value.id, "edited"),
      await sessions.reanchorDraft(older, added.value.id, anchor),
      await sessions.deleteDraft(older, added.value.id),
    ];

    expect(
      refusals.map((refusal) => !refusal.ok && refusal.error.code),
    ).toEqual(Array(4).fill(ReviewSessionErrorCodes.SESSION_FROZEN));
    const snapshot = await sessions.get(older);
    expect(snapshot?.draftComments.map((row) => row.body)).toEqual(["first"]);
  });

  it("a refused first write leaves no session row", async () => {
    const world = await makeWorld();
    const first = await seedBrief(world, 1);
    const second = await seedBrief(world, 2);
    await seedHop(world, 1, 2);
    const repo = createTenantRepository(world.handle, CTX);
    await openSession(world, second);

    const refused = await repo.reviewSessions.setOutcome(
      { briefId: first, reviewerId: REVIEWER },
      ReviewOutcomes.APPROVE,
    );

    expect(!refused.ok && refused.error.code).toBe(
      ReviewSessionErrorCodes.SESSION_FROZEN,
    );
    expect(await countRows(world.client, "review_session")).toBe(1);
  });

  it("leaves another reviewer's newer session out of it", async () => {
    const world = await makeWorld();
    const first = await seedBrief(world, 1);
    const second = await seedBrief(world, 2);
    await seedHop(world, 1, 2);
    const repo = createTenantRepository(world.handle, CTX);

    await openSession(world, second, OTHER_REVIEWER);
    const written = await repo.reviewSessions.setOutcome(
      { briefId: first, reviewerId: REVIEWER },
      ReviewOutcomes.APPROVE,
    );

    expect(written.ok).toBe(true);
  });
});

describe("the risk operations on a session", () => {
  const ANCHOR = {
    filePath: "src/app.ts",
    attribute: "sql-injection",
    regionStart: 10,
    regionEnd: 20,
  };

  it("records a disposition with no carry verdict", async () => {
    const world = await makeWorld();
    const briefId = await seedBrief(world, 1);
    await seedBriefFacts(world, briefId, [], FIRING);
    const repo = createTenantRepository(world.handle, CTX);
    const key = { briefId, reviewerId: REVIEWER };

    const written = await repo.reviewSessions.decideRisks(key, [
      {
        ...ANCHOR,
        decision: DispositionDecisions.DISMISSED,
        reason: "test-only path",
      },
    ]);

    expect(written).toEqual({ ok: true, value: 1 });
    const snapshot = await repo.reviewSessions.get(key);
    expect(snapshot?.dispositions).toEqual([
      expect.objectContaining({
        attribute: "sql-injection",
        decision: DispositionDecisions.DISMISSED,
        reason: "test-only path",
        carryStatus: null,
      }),
    ]);
  });

  it("clears the carried status when the reviewer decides again", async () => {
    const world = await makeWorld();
    const previous = await seedBrief(world, 1);
    const current = await seedBrief(world, 2, ["c5"]);
    await seedHop(world, 1, 2);
    await seedPreviousWork(world, previous);
    const repo = createTenantRepository(world.handle, CTX);
    await seedBriefFacts(world, current, [], FIRING);
    const key = {
      briefId: current,
      reviewerId: REVIEWER,
    };

    await repo.reviewSessions.setOutcome(key, ReviewOutcomes.COMMENT);
    // The carried row sits at the remapped anchor; deciding on it again is an
    // upsert, not a second row.
    const decided = await repo.reviewSessions.decideRisks(key, [
      {
        filePath: "src/app.ts",
        attribute: "sql-injection",
        regionStart: 33,
        regionEnd: 35,
        decision: DispositionDecisions.ADDRESSED,
      },
    ]);

    expect(decided.ok).toBe(true);
    const snapshot = await repo.reviewSessions.get(key);
    expect(snapshot?.dispositions).toEqual([
      expect.objectContaining({
        decision: DispositionDecisions.ADDRESSED,
        carryStatus: null,
      }),
    ]);
  });

  it("reopens a disposition by its anchor, and says so when none was held", async () => {
    const world = await makeWorld();
    const briefId = await seedBrief(world, 1);
    await seedBriefFacts(world, briefId, [], FIRING);
    const repo = createTenantRepository(world.handle, CTX);
    const key = { briefId, reviewerId: REVIEWER };
    await repo.reviewSessions.decideRisks(key, [
      {
        ...ANCHOR,
        decision: DispositionDecisions.DISMISSED,
        reason: "test-only path",
      },
    ]);

    // Undoing twice is the same undo: an undecided flag is a row that does
    // not exist, so the repeat has nothing left to remove.
    const undone = await repo.reviewSessions.reopenRisks(key, [ANCHOR]);
    const again = await repo.reviewSessions.reopenRisks(key, [ANCHOR]);

    expect([undone, again]).toEqual([
      { ok: true, value: 1 },
      { ok: true, value: 0 },
    ]);
    expect((await repo.reviewSessions.get(key))?.dispositions).toEqual([]);
  });
});
