// The session row locks cannot be proven on PGlite, which runs one
// connection. This suite runs only against a real Postgres named by
// MERGEBRIEF_TEST_POSTGRES_URL: skipped locally when unset, red under CI.
import { and, eq } from "drizzle-orm";
import { CommentAnchorKinds } from "types";
import { describe, expect, it } from "vitest";
import { internal } from "../src/db/handle";
import {
  createArtifactStore,
  createTenantRepository,
  ReviewSessionErrorCodes,
} from "../src/index";
import type {
  AppDatabase,
  ReviewSessionKey,
  TenantRepository,
} from "../src/index";
import { reviewDraftComment } from "../src/schema/review-draft-comment";
import { reviewSession } from "../src/schema/review-session";
import {
  isReviewerId,
  type BriefRowId,
  type PullRequestRowId,
  type ReviewerId,
} from "../src/types";
import { PrStates } from "types/pull-requests";
import { ReviewOutcomes } from "types/reviews";
import {
  brandWith,
  connectMigrated,
  deleteTenantRows,
  makeFixture,
  waitMs,
  type TenantFixture,
} from "./helpers";
import { readTestPostgresUrl } from "../src/testing";

const databaseUrl = readTestPostgresUrl(process.env);
const REVIEWER: ReviewerId = brandWith(isReviewerId, 31337n);
const HOLD_MS = 300;
const DRAFT_CAP = 64;

interface World {
  readonly handle: AppDatabase;
  readonly sessions: TenantRepository["reviewSessions"];
  readonly older: ReviewSessionKey;
  readonly newer: ReviewSessionKey;
}

interface Gate {
  readonly opened: Promise<void>;
  open(): void;
}

function makeGate(): Gate {
  let open = (): void => {};
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { opened, open: () => open() };
}

async function seedBrief(
  handle: AppDatabase,
  fixture: TenantFixture,
  pullRequestId: PullRequestRowId,
  headIndex: number,
): Promise<BriefRowId> {
  const written = await createArtifactStore(handle, fixture.ctx).briefs.write({
    pullRequestId,
    baseSha: "base",
    headSha: `head-${headIndex}`,
    headIndex,
    commitCount: headIndex,
    provider: "anthropic",
    model: "test",
    effort: "high",
    body: '{"changeGroups":[],"chunks":[]}',
    carriedChunkIds: [],
    anchorState: "anchored",
    usedGroupIds: [],
  });
  return written.id;
}

/** One PR with two Briefs, the reviewer's session keys on each. */
async function seedWorld(
  handle: AppDatabase,
  fixture: TenantFixture,
): Promise<World> {
  const repo = createTenantRepository(handle, fixture.ctx);
  const pr = await repo.pullRequests.upsert({
    repoId: fixture.repoId,
    prNumber: 1,
    state: PrStates.OPEN,
    repoSlug: "acme/lock",
  });
  const older = await seedBrief(handle, fixture, pr.id, 1);
  const newer = await seedBrief(handle, fixture, pr.id, 2);
  return {
    handle,
    sessions: repo.reviewSessions,
    older: { briefId: older, reviewerId: REVIEWER },
    newer: { briefId: newer, reviewerId: REVIEWER },
  };
}

/** Run a test body against a seeded world, then drop the tenant's rows. */
async function runInWorld(body: (world: World) => Promise<void>) {
  if (databaseUrl === undefined) {
    throw new Error("unreachable");
  }
  const fixture = makeFixture();
  const handle = await connectMigrated(databaseUrl);
  try {
    await body(await seedWorld(handle, fixture));
  } finally {
    await deleteTenantRows(handle, fixture.tenant);
  }
}

const FILE_ANCHOR = { kind: CommentAnchorKinds.FILE, file: "src/app.ts" };

async function addDraft(world: World, key: ReviewSessionKey, body: string) {
  return world.sessions.addDraft(key, { anchor: FILE_ANCHOR, body });
}

/**
 * Stand in for a session write in flight: lock the session row the way every
 * write does, insert a draft under it, then hold the transaction open until
 * `release` opens.
 */
async function holdSessionWrite(
  world: World,
  key: ReviewSessionKey,
  body: string,
  gates: { readonly entered: Gate; readonly release: Gate },
): Promise<void> {
  await internal(world.handle).transaction(async (tx) => {
    const locked = await tx
      .select({
        id: reviewSession.id,
        installationId: reviewSession.installationId,
      })
      .from(reviewSession)
      .where(
        and(
          eq(reviewSession.briefId, key.briefId),
          eq(reviewSession.reviewerId, key.reviewerId),
        ),
      )
      .for("update");
    const session = locked[0];
    if (session === undefined) {
      throw new Error("no session to hold");
    }
    await tx.insert(reviewDraftComment).values({
      installationId: session.installationId,
      reviewSessionId: session.id,
      kind: CommentAnchorKinds.FILE,
      filePath: "src/app.ts",
      body,
    });
    gates.entered.open();
    await gates.release.opened;
  });
}

async function readDraftBodies(
  world: World,
  key: ReviewSessionKey,
): Promise<string[]> {
  const snapshot = await world.sessions.get(key);
  return (snapshot?.draftComments ?? []).map((row) => row.body);
}

describe.skipIf(databaseUrl === undefined)(
  "session operations on real Postgres",
  () => {
    it("a write to the previous session waits behind a materialization", async () => {
      await runInWorld(async (world) => {
        const gates = { entered: makeGate(), release: makeGate() };
        await addDraft(world, world.older, "first");
        const holding = holdSessionWrite(world, world.older, "held", gates);
        await gates.entered.opened;

        const materializing = world.sessions.setOutcome(
          world.newer,
          ReviewOutcomes.COMMENT,
        );
        await waitMs(HOLD_MS);
        const late = addDraft(world, world.older, "late");
        const whileHeld = await Promise.race([late, waitMs(HOLD_MS)]);
        gates.release.open();
        await holding;
        await materializing;
        const settled = await late;

        expect(whileHeld).toBe("timer");
        expect(!settled.ok && settled.error.code).toBe(
          ReviewSessionErrorCodes.SESSION_FROZEN,
        );
        expect(await readDraftBodies(world, world.older)).toEqual([
          "first",
          "held",
        ]);
        expect(await readDraftBodies(world, world.newer)).toEqual([
          "first",
          "held",
        ]);
      });
    });

    it("a materialization waits for a write to the previous session", async () => {
      await runInWorld(async (world) => {
        const gates = { entered: makeGate(), release: makeGate() };
        await addDraft(world, world.older, "first");
        const holding = holdSessionWrite(world, world.older, "late", gates);
        await gates.entered.opened;

        const materializing = world.sessions.setOutcome(
          world.newer,
          ReviewOutcomes.COMMENT,
        );
        const whileHeld = await Promise.race([materializing, waitMs(HOLD_MS)]);
        gates.release.open();
        await holding;
        await materializing;

        expect(whileHeld).toBe("timer");
        expect(await readDraftBodies(world, world.newer)).toEqual([
          "first",
          "late",
        ]);
      });
    });

    it("a second write to one session waits for the first", async () => {
      await runInWorld(async (world) => {
        const gates = { entered: makeGate(), release: makeGate() };
        await addDraft(world, world.older, "first");
        const holding = holdSessionWrite(world, world.older, "second", gates);
        await gates.entered.opened;

        const second = addDraft(world, world.older, "third");
        const whileHeld = await Promise.race([second, waitMs(HOLD_MS)]);
        gates.release.open();
        await holding;
        const settled = await second;

        expect(whileHeld).toBe("timer");
        expect(settled.ok).toBe(true);
        expect(await readDraftBodies(world, world.older)).toEqual([
          "first",
          "second",
          "third",
        ]);
      });
    });

    it("two parallel adds one under the draft cap add exactly one", async () => {
      await runInWorld(async (world) => {
        for (let index = 1; index < DRAFT_CAP; index++) {
          await addDraft(world, world.older, `draft ${index}`);
        }

        const outcomes = await Promise.all(
          [1, 2].map(() => addDraft(world, world.older, "under the cap")),
        );

        const refusals = outcomes.flatMap((outcome) =>
          outcome.ok ? [] : [outcome.error.code],
        );
        expect(refusals).toEqual([ReviewSessionErrorCodes.DRAFT_LIMIT_REACHED]);
        expect(await readDraftBodies(world, world.older)).toHaveLength(
          DRAFT_CAP,
        );
      });
    });
  },
);
