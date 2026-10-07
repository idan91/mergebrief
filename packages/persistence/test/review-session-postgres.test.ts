// The session row locks cannot be proven on PGlite, which runs one
// connection. This suite runs only against a real Postgres named by
// MERGEBRIEF_TEST_POSTGRES_URL: skipped locally when unset, red under CI.
import { CommentAnchorKinds } from "types";
import { describe, expect, it } from "vitest";
import {
  createArtifactStore,
  createTenantRepository,
  ReviewSessionErrorCodes,
} from "../src/index";
import type {
  AppDatabase,
  ReviewSessionKey,
  SessionWriter,
  TenantRepository,
} from "../src/index";
import {
  isReviewerId,
  type BriefRowId,
  type PullRequestRowId,
  type ReviewerId,
} from "../src/types";
import { DraftCommentSides } from "types/comments";
import { PrStates } from "types/pull-requests";
import {
  brandWith,
  connectMigrated,
  deleteTenantRows,
  makeFixture,
  readTestPostgresUrl,
  waitMs,
  type TenantFixture,
} from "./helpers";

const databaseUrl = readTestPostgresUrl(process.env);
const REVIEWER: ReviewerId = brandWith(isReviewerId, 31337n);
const HOLD_MS = 300;
const OVERLAP_MS = 100;
const DRAFT_LIMIT = 2;

interface World {
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
  });
  if (!written.ok) {
    throw new Error(`brief seed failed: ${written.error.message}`);
  }
  return written.value.id;
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

function addDraft(writer: SessionWriter, body: string) {
  return writer.addDraftComment({
    kind: CommentAnchorKinds.LINE,
    filePath: "src/app.ts",
    side: DraftCommentSides.NEW,
    startLine: 1,
    endLine: 1,
    body,
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
  "writeToSession on real Postgres",
  () => {
    it("a write to the previous session waits for a materialization", async () => {
      await runInWorld(async (world) => {
        const entered = makeGate();
        const release = makeGate();
        await world.sessions.writeToSession(world.older, (writer) =>
          addDraft(writer, "first"),
        );

        const materializing = world.sessions.writeToSession(
          world.newer,
          async (writer) => {
            entered.open();
            await release.opened;
            return writer.session.id;
          },
        );
        await Promise.race([entered.opened, materializing]);
        const late = world.sessions.writeToSession(world.older, (writer) =>
          addDraft(writer, "late"),
        );
        const whileHeld = await Promise.race([late, waitMs(HOLD_MS)]);
        release.open();
        await materializing;
        const settled = await late;

        expect(whileHeld).toBe("timer");
        expect(settled.ok).toBe(false);
        expect(!settled.ok && settled.error.code).toBe(
          ReviewSessionErrorCodes.SESSION_FROZEN,
        );
        expect(await readDraftBodies(world, world.older)).toEqual(["first"]);
        expect(await readDraftBodies(world, world.newer)).toEqual(["first"]);
      });
    });

    it("a materialization waits for a write to the previous session", async () => {
      await runInWorld(async (world) => {
        const entered = makeGate();
        const release = makeGate();
        await world.sessions.writeToSession(world.older, (writer) =>
          addDraft(writer, "first"),
        );

        const writing = world.sessions.writeToSession(
          world.older,
          async (writer) => {
            await addDraft(writer, "late");
            entered.open();
            await release.opened;
          },
        );
        await Promise.race([entered.opened, writing]);
        const materializing = world.sessions.writeToSession(
          world.newer,
          async (writer) => writer.session.id,
        );
        const whileHeld = await Promise.race([materializing, waitMs(HOLD_MS)]);
        release.open();
        await writing;
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
        const entered = makeGate();
        const release = makeGate();
        await world.sessions.writeToSession(world.older, (writer) =>
          addDraft(writer, "first"),
        );

        const first = world.sessions.writeToSession(
          world.older,
          async (writer) => {
            entered.open();
            await release.opened;
            return addDraft(writer, "second");
          },
        );
        await Promise.race([entered.opened, first]);
        const second = world.sessions.writeToSession(world.older, (writer) =>
          addDraft(writer, "third"),
        );
        const whileHeld = await Promise.race([second, waitMs(HOLD_MS)]);
        release.open();
        await first;
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

    it("two parallel adds one under a limit add exactly one", async () => {
      await runInWorld(async (world) => {
        await world.sessions.writeToSession(world.older, (writer) =>
          addDraft(writer, "first"),
        );
        async function addUnderLimit(writer: SessionWriter): Promise<boolean> {
          const held = await writer.draftComments();
          if (held.length >= DRAFT_LIMIT) {
            return false;
          }
          await waitMs(OVERLAP_MS);
          await addDraft(writer, "under the limit");
          return true;
        }

        const outcomes = await Promise.all(
          [1, 2].map(() =>
            world.sessions.writeToSession(world.older, addUnderLimit),
          ),
        );

        const added = outcomes.filter((outcome) => outcome.ok && outcome.value);
        expect(added).toHaveLength(1);
        expect(await readDraftBodies(world, world.older)).toHaveLength(
          DRAFT_LIMIT,
        );
      });
    });
  },
);
