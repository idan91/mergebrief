// In the owner world `matchesWorld` matches every owner's rows, so these reads
// are safe only through the parent check before them. Two owners hold a mirror
// of one PR, and owner B calls with owner A's ids.
import { STORED_BODY_VERSION } from "brief-core/artifact";
import { CommentAnchorKinds, DiffSides } from "types/comments";
import { AnchorStates } from "types/generations";
import { DispositionDecisions } from "types/dispositions";
import { PrStates } from "types/pull-requests";
import { ChangeGroupCategories, ReviewOutcomes } from "types/reviews";
import { describe, expect, it } from "vitest";
import {
  ClaimOutcomes,
  createArtifactStore,
  createGenerationProjection,
  createIngestRoutines,
  createTenantRepository,
  ScopeViolationError,
  type OwnerContext,
  type ReviewSessionRepository,
} from "../src/index";
import {
  isGrantRowId,
  isRepoId,
  isReviewerId,
  type BriefRowId,
  type ReviewerId,
} from "../src/types";
import {
  brandWith,
  makeBriefTarget,
  registerSharedPglite,
  seedDraftCopies,
} from "./helpers";

const shared = registerSharedPglite();

const OWNER_A: ReviewerId = brandWith(isReviewerId, 501n);
const OWNER_B: ReviewerId = brandWith(isReviewerId, 502n);
const SHARED_REVIEWER: ReviewerId = brandWith(isReviewerId, 503n);
const REPO = brandWith(isRepoId, 777n);
const GRANT = brandWith(isGrantRowId, 1n);
const PR_NUMBER = 7;

const CTX_A: OwnerContext = { ownerUserId: OWNER_A };
const CTX_B: OwnerContext = { ownerUserId: OWNER_B };

const BASE = "a".repeat(40);
const HEAD = "b".repeat(40);
const OTHER_HEAD = "c".repeat(40);
const LATER_HEAD = "d".repeat(40);

const CHUNK_ID = "c1";
const GROUP_ID = "g1";
const LEASE_MS = 60_000;
const RECOVERY_DELAY_SECONDS = 125;
const OTHER_REGION_START = 30;
const OTHER_REGION_END = 40;
const DRAFT_LIMIT = 64;
/** The draft-limit case sends its last drafts through the store, the rest in one insert. */
const STORE_WRITTEN_DRAFTS = 2;
const WINDOW = {
  from: new Date("2000-01-01T00:00:00.000Z"),
  to: new Date("2100-01-01T00:00:00.000Z"),
};

const BRIEF_BODY = JSON.stringify({
  changeGroups: [{ id: GROUP_ID }],
  chunks: [
    {
      id: CHUNK_ID,
      file: "src/app.ts",
      addedRanges: [{ start: 10, end: 20 }],
      riskSurface: ["sql-injection"],
    },
  ],
});

const LINE_ANCHOR = {
  kind: CommentAnchorKinds.LINE,
  file: "src/app.ts",
  side: DiffSides.NEW,
  startLine: 1,
  endLine: 1,
} as const;

const FLAG = {
  filePath: "src/app.ts",
  attribute: "sql-injection",
  regionStart: 10,
  regionEnd: 20,
};

const CHUNK_COUNTS = {
  rows: 7,
  hunkRows: 1,
  expandRows: 1,
  splitRows: 6,
  lineWidths: { counts: [3, 2, 0, 0, 0, 0, 0, 0, 0], overflowColumns: 0 },
  rowRuns: "h1c5e1",
};

interface BriefFixture {
  readonly headSha: string;
  readonly headIndex: number;
  readonly chunkLayout?: unknown;
  readonly carriedChunkIds?: readonly string[];
  readonly anchorState?: string;
}

async function openMirroredPullRequest(ctx: OwnerContext) {
  return createTenantRepository(shared.handle, ctx).pullRequests.upsert({
    repoId: REPO,
    prNumber: PR_NUMBER,
    repoSlug: "acme/widgets",
    state: PrStates.OPEN,
  });
}

async function writeBrief(ctx: OwnerContext, fixture: BriefFixture) {
  const pr = await openMirroredPullRequest(ctx);
  const brief = await createArtifactStore(shared.handle, ctx).briefs.write({
    pullRequestId: pr.id,
    baseSha: BASE,
    commitCount: 1,
    provider: "anthropic",
    model: "m",
    effort: "high",
    bodyVersion: STORED_BODY_VERSION,
    body: BRIEF_BODY,
    usedGroupIds: [],
    ...fixture,
  });
  return { pullRequestId: pr.id, briefId: brief.id };
}

function openSessions(ctx: OwnerContext): ReviewSessionRepository {
  return createTenantRepository(shared.handle, ctx).reviewSessions;
}

function readDraftId(
  added: Awaited<ReturnType<ReviewSessionRepository["addDraft"]>>,
): bigint {
  if (!added.ok) {
    throw new Error(`expected a draft, got ${added.error.code}`);
  }
  return added.value.id;
}

/** Owner A's PR, brief and session, holding one row of every session table. */
async function seedOwnerWork(reviewerId: ReviewerId = OWNER_A) {
  const { briefId, pullRequestId } = await writeBrief(CTX_A, {
    headSha: HEAD,
    headIndex: 1,
  });
  const key = { briefId, reviewerId };
  const sessions = openSessions(CTX_A);

  const draftId = readDraftId(
    await sessions.addDraft(key, { anchor: LINE_ANCHOR, body: "a's draft" }),
  );
  const seeded = [
    await sessions.setChunkRead(key, { chunkId: CHUNK_ID, read: true }),
    await sessions.reclassifyGroup(key, {
      changeGroupId: GROUP_ID,
      category: ChangeGroupCategories.BUGFIX,
    }),
    await sessions.decideRisks(key, [
      {
        ...FLAG,
        decision: DispositionDecisions.DISMISSED,
        reason: "a's reason",
      },
    ]),
    await sessions.recordReplyReview(key, 91n),
  ];
  expect(seeded.map((written) => written.ok)).toEqual([true, true, true, true]);

  return { briefId, pullRequestId, key, draftId, sessions };
}

type ForeignKey = Parameters<ReviewSessionRepository["get"]>[0];
type ForeignCall = (
  sessions: ReviewSessionRepository,
  key: ForeignKey,
  draftId: bigint,
) => Promise<unknown>;

const REFUSED_CALLS: Record<
  Exclude<keyof ReviewSessionRepository, "get" | "preview">,
  ForeignCall
> = {
  addDraft: (sessions, key) =>
    sessions.addDraft(key, { anchor: LINE_ANCHOR, body: "b's draft" }),
  editDraft: (sessions, key, draftId) =>
    sessions.editDraft(key, draftId, "edited by b"),
  reanchorDraft: (sessions, key, draftId) =>
    sessions.reanchorDraft(key, draftId, LINE_ANCHOR),
  deleteDraft: (sessions, key, draftId) => sessions.deleteDraft(key, draftId),
  setChunkRead: (sessions, key) =>
    sessions.setChunkRead(key, { chunkId: CHUNK_ID, read: false }),
  reclassifyGroup: (sessions, key) =>
    sessions.reclassifyGroup(key, {
      changeGroupId: GROUP_ID,
      category: ChangeGroupCategories.NEW_FEATURE,
    }),
  decideRisks: (sessions, key) =>
    sessions.decideRisks(key, [
      { ...FLAG, decision: DispositionDecisions.DISMISSED, reason: "b" },
    ]),
  reopenRisks: (sessions, key) => sessions.reopenRisks(key, [FLAG]),
  setOutcome: (sessions, key) =>
    sessions.setOutcome(key, ReviewOutcomes.COMMENT),
  listDrafts: (sessions, key) => sessions.listDrafts(key),
  recordPublishedDrafts: (sessions, key, draftId) =>
    sessions.recordPublishedDrafts(key, { draftIds: [draftId] }),
  recordReplyReview: (sessions, key) => sessions.recordReplyReview(key, 92n),
  claimDrafts: (sessions, key, draftId) =>
    sessions.claimDrafts(key, { draftIds: [draftId] }),
  settleClaim: (sessions, key) =>
    sessions.settleClaim(key, { claim: "a-claim" }),
  releaseClaim: (sessions, key) =>
    sessions.releaseClaim(key, { claim: "a-claim" }),
};

describe("another owner calling with the owner's session key", () => {
  it("reads nothing through get or preview", async () => {
    const { key } = await seedOwnerWork();

    const other = openSessions(CTX_B);

    expect(await other.get(key)).toBeUndefined();
    const preview = await other.preview(key);
    expect(preview).toMatchObject({
      ok: true,
      value: { session: undefined, carriedFrom: undefined },
    });
  });

  it.each(Object.entries(REFUSED_CALLS))(
    "%s refuses and leaves the session untouched",
    async (_method, call) => {
      const { key, draftId, sessions } = await seedOwnerWork();
      const before = await sessions.get(key);

      const other = openSessions(CTX_B);

      await expect(call(other, key, draftId)).rejects.toBeInstanceOf(
        ScopeViolationError,
      );

      expect(await sessions.get(key)).toEqual(before);
    },
  );
});

describe("another owner on its own session addressing the owner's rows", () => {
  async function openMirror(reviewers = { owner: OWNER_A, other: OWNER_B }) {
    const owner = await seedOwnerWork(reviewers.owner);
    const { briefId } = await writeBrief(CTX_B, {
      headSha: HEAD,
      headIndex: 1,
    });
    const otherKey = { briefId, reviewerId: reviewers.other };
    const other = openSessions(CTX_B);
    await other.setOutcome(otherKey, ReviewOutcomes.COMMENT);
    return { owner, other, otherKey };
  }

  it.each<[string, ForeignCall]>([
    ["editDraft", REFUSED_CALLS.editDraft],
    ["reanchorDraft", REFUSED_CALLS.reanchorDraft],
    ["deleteDraft", REFUSED_CALLS.deleteDraft],
    ["claimDrafts", REFUSED_CALLS.claimDrafts],
  ])("%s refuses the owner's draft id", async (_method, call) => {
    const { owner, other, otherKey } = await openMirror();
    const before = await owner.sessions.get(owner.key);

    await expect(call(other, otherKey, owner.draftId)).rejects.toBeInstanceOf(
      ScopeViolationError,
    );

    expect(await owner.sessions.get(owner.key)).toEqual(before);
  });

  it("recordPublishedDrafts flips none of the owner's drafts", async () => {
    const { owner, other, otherKey } = await openMirror();
    const before = await owner.sessions.get(owner.key);

    const flipped = await other.recordPublishedDrafts(otherKey, {
      draftIds: [owner.draftId],
    });

    expect(flipped).toEqual({ ok: true, value: 0 });
    expect(await owner.sessions.get(owner.key)).toEqual(before);
  });

  it.each(["settleClaim", "releaseClaim"] as const)(
    "%s with the owner's claim touches no row",
    async (method) => {
      const { owner, other, otherKey } = await openMirror({
        owner: SHARED_REVIEWER,
        other: SHARED_REVIEWER,
      });
      const claimed = await owner.sessions.claimDrafts(owner.key, {
        draftIds: [owner.draftId],
      });
      if (!claimed.ok) {
        throw new Error(`expected a claim, got ${claimed.error.code}`);
      }
      const before = await owner.sessions.get(owner.key);

      const settled = await other[method](otherKey, {
        claim: claimed.value.claim,
      });

      expect(settled).toEqual({ ok: true, value: 0 });
      expect(await owner.sessions.get(owner.key)).toEqual(before);
    },
  );

  it("clearing a read mark and reopening a risk leave the owner's rows", async () => {
    const { owner, other, otherKey } = await openMirror();
    const before = await owner.sessions.get(owner.key);

    await other.setChunkRead(otherKey, { chunkId: CHUNK_ID, read: false });
    await other.reopenRisks(otherKey, [FLAG]);

    expect(await owner.sessions.get(owner.key)).toEqual(before);
  });

  it("the owner's rows take none of the other session's record limits", async () => {
    const { other, otherKey } = await openMirror();

    const marked = await other.setChunkRead(otherKey, {
      chunkId: CHUNK_ID,
      read: true,
    });
    const reclassified = await other.reclassifyGroup(otherKey, {
      changeGroupId: GROUP_ID,
      category: ChangeGroupCategories.NEW_FEATURE,
    });
    const decided = await other.decideRisks(otherKey, [
      {
        ...FLAG,
        regionStart: OTHER_REGION_START,
        regionEnd: OTHER_REGION_END,
        decision: DispositionDecisions.DISMISSED,
        reason: "b",
      },
    ]);

    expect([marked.ok, reclassified.ok, decided.ok]).toEqual([
      true,
      true,
      true,
    ]);
  });

  it("a second reclassify leaves the owner's category", async () => {
    const { owner, other, otherKey } = await openMirror();
    const before = await owner.sessions.get(owner.key);
    const input = {
      changeGroupId: GROUP_ID,
      category: ChangeGroupCategories.NEW_FEATURE,
    };

    await other.reclassifyGroup(otherKey, input);
    const second = await other.reclassifyGroup(otherKey, input);

    expect(second.ok).toBe(true);
    expect(await owner.sessions.get(owner.key)).toEqual(before);
  });

  it("listDrafts lists none of the owner's drafts", async () => {
    const { other, otherKey } = await openMirror();

    expect(await other.listDrafts(otherKey)).toEqual({ ok: true, value: [] });
  });

  it("the owner's drafts count toward none of the other's draft limit", async () => {
    const { owner, other, otherKey } = await openMirror();
    const firstStoreDraft = DRAFT_LIMIT - STORE_WRITTEN_DRAFTS;
    await seedDraftCopies(shared.client, {
      sourceDraftId: owner.draftId,
      bodyPrefix: "a's draft ",
      first: 1,
      last: firstStoreDraft - 1,
    });
    for (let held = firstStoreDraft; held < DRAFT_LIMIT; held++) {
      readDraftId(
        await owner.sessions.addDraft(owner.key, {
          anchor: LINE_ANCHOR,
          body: `a's draft ${held}`,
        }),
      );
    }

    const added = await other.addDraft(otherKey, {
      anchor: LINE_ANCHOR,
      body: "b's draft",
    });

    expect(added.ok).toBe(true);
  });

  it("the owner's snapshot rows stay out of the other owner's snapshot", async () => {
    const { other, otherKey } = await openMirror();

    const snapshot = await other.get(otherKey);

    expect(snapshot?.draftComments).toEqual([]);
    expect(snapshot?.readMarks).toEqual([]);
    expect(snapshot?.reclassifications).toEqual([]);
    expect(snapshot?.submittedReviews).toEqual([]);
    expect(snapshot?.dispositions).toEqual([]);
  });
});

describe("carry-over beside another owner's rows", () => {
  async function openLaterBrief() {
    await seedOwnerWork();
    const { briefId: earlier } = await writeBrief(CTX_B, {
      headSha: HEAD,
      headIndex: 1,
    });
    const other = openSessions(CTX_B);
    await other.setOutcome(
      { briefId: earlier, reviewerId: OWNER_B },
      ReviewOutcomes.COMMENT,
    );
    const { briefId } = await writeBrief(CTX_B, {
      headSha: LATER_HEAD,
      headIndex: 2,
      carriedChunkIds: [CHUNK_ID],
      anchorState: AnchorStates.ANCHORED,
    });
    return { other, key: { briefId, reviewerId: OWNER_B } };
  }

  it("preview evaluates the previous session without the owner's rows", async () => {
    const { other, key } = await openLaterBrief();

    const preview = await other.preview(key);
    if (!preview.ok) {
      throw new Error(`expected a preview, got ${preview.error.code}`);
    }

    expect(preview.value.carriedFrom).toBeDefined();
    expect(preview.value.carried.draftComments).toEqual([]);
    expect(preview.value.carried.readMarks).toEqual([]);
    expect(preview.value.carried.reclassifications).toEqual([]);
    expect(preview.value.carried.dispositions).toEqual([]);
  });

  it("a first write copies none of the owner's rows", async () => {
    const { other, key } = await openLaterBrief();

    const written = await other.setOutcome(key, ReviewOutcomes.COMMENT);
    const snapshot = await other.get(key);

    expect(written.ok).toBe(true);
    expect(snapshot?.session.carriedItemCount).toBe(0);
    expect(snapshot?.draftComments).toEqual([]);
    expect(snapshot?.readMarks).toEqual([]);
    expect(snapshot?.reclassifications).toEqual([]);
    expect(snapshot?.dispositions).toEqual([]);
  });
});

describe("one reviewer holding sessions under two owners", () => {
  it("carries no work across owners on a later brief", async () => {
    await seedOwnerWork(SHARED_REVIEWER);
    const { briefId } = await writeBrief(CTX_B, {
      headSha: LATER_HEAD,
      headIndex: 2,
    });
    const key = { briefId, reviewerId: SHARED_REVIEWER };
    const other = openSessions(CTX_B);

    const preview = await other.preview(key);
    expect(preview).toMatchObject({
      ok: true,
      value: { session: undefined, carriedFrom: undefined },
    });

    await other.setOutcome(key, ReviewOutcomes.COMMENT);

    const snapshot = await other.get(key);
    expect(snapshot?.session.carriedItemCount).toBe(0);
    expect(snapshot?.draftComments).toEqual([]);
  });

  it("is not frozen by a newer brief of the other owner", async () => {
    const { briefId: newerBrief } = await writeBrief(CTX_A, {
      headSha: LATER_HEAD,
      headIndex: 5,
    });
    await openSessions(CTX_A).setOutcome(
      { briefId: newerBrief, reviewerId: SHARED_REVIEWER },
      ReviewOutcomes.COMMENT,
    );
    const { briefId } = await writeBrief(CTX_B, {
      headSha: HEAD,
      headIndex: 1,
    });

    const written = await openSessions(CTX_B).setOutcome(
      { briefId, reviewerId: SHARED_REVIEWER },
      ReviewOutcomes.COMMENT,
    );

    expect(written.ok).toBe(true);
  });
});

describe("generation reads across owners", () => {
  async function claimOwnerRun() {
    const { pullRequestId } = await writeBrief(CTX_A, {
      headSha: HEAD,
      headIndex: 1,
    });
    const owner = createGenerationProjection(shared.handle, CTX_A);
    const target = makeBriefTarget(pullRequestId, HEAD);
    await owner.upsertPending(target);
    const claim = await owner.claimRun({
      target,
      leaseMs: LEASE_MS,
      ...WINDOW,
    });
    if (!claim.ok || claim.value.kind !== ClaimOutcomes.CLAIMED) {
      throw new Error("expected owner A's claim");
    }
    return { owner, target, runId: claim.value.runId, pullRequestId };
  }

  it("reads nothing of the owner's generation row or claim", async () => {
    const { owner, target, pullRequestId } = await claimOwnerRun();
    const other = createGenerationProjection(shared.handle, CTX_B);

    expect(await owner.get(target)).toBeDefined();
    expect(await owner.readBriefClaims(pullRequestId)).toBeDefined();
    expect(await owner.listBriefsForPullRequest(pullRequestId)).toHaveLength(1);
    expect(await other.get(target)).toBeUndefined();
    expect(await other.readClaim(target)).toBeUndefined();
    expect(await other.readBriefClaims(pullRequestId)).toBeUndefined();
    expect(await other.listBriefsForPullRequest(pullRequestId)).toEqual([]);
    expect(await other.latestBriefForPullRequests([pullRequestId])).toEqual(
      new Map(),
    );
    const otherHead = makeBriefTarget(pullRequestId, OTHER_HEAD);
    expect(await other.readOtherHeadLeaseMs(otherHead)).toBeUndefined();
  });

  it("reads and moves nothing of the owner's attempt row", async () => {
    const { owner, runId } = await claimOwnerRun();
    const before = await owner.readRunAttempt(runId);
    const other = createGenerationProjection(shared.handle, CTX_B);

    expect(await other.readRunAttempt(runId)).toBeUndefined();
    expect((await other.recordPartDone(runId)).ok).toBe(false);
    expect((await other.refundRun(runId)).ok).toBe(false);
    expect(
      (await other.recordPartsPlanned(runId, { total: 3, done: 0 })).ok,
    ).toBe(false);

    expect(await owner.readRunAttempt(runId)).toEqual(before);
  });

  it("reads no generate job timing on the owner's PR", async () => {
    const triggered = await createIngestRoutines(
      shared.handle,
      CTX_A,
    ).triggerGeneration({
      pullRequest: {
        repoId: REPO,
        prNumber: PR_NUMBER,
        repoSlug: "acme/widgets",
        state: PrStates.OPEN,
      },
      headSha: HEAD,
      debounceSeconds: 0,
      grantId: GRANT,
    });
    const { pullRequest } = triggered;
    const pullRequestId = pullRequest.id;
    const owner = createGenerationProjection(shared.handle, CTX_A);
    const other = createGenerationProjection(shared.handle, CTX_B);

    expect(await owner.getGenerateJobTiming(pullRequestId)).toBeDefined();
    expect(await other.getGenerateJobTiming(pullRequestId)).toBeUndefined();
  });

  it("reads no takeover job on the owner's PR", async () => {
    const { pullRequestId } = await writeBrief(CTX_A, {
      headSha: HEAD,
      headIndex: 1,
    });
    const owner = createGenerationProjection(shared.handle, CTX_A);
    const target = makeBriefTarget(pullRequestId, HEAD);
    await owner.upsertPending(target);
    await owner.claimRun({
      target,
      leaseMs: LEASE_MS,
      recovery: { delaySeconds: RECOVERY_DELAY_SECONDS, grantId: GRANT },
      ...WINDOW,
    });
    const other = createGenerationProjection(shared.handle, CTX_B);

    expect(await owner.readTakeoverJob(pullRequestId, HEAD)).toBeDefined();
    expect(await other.readTakeoverJob(pullRequestId, HEAD)).toBeUndefined();
  });
});

describe("artifact reads the other owner-scope suites leave out", () => {
  async function readAcrossOwners(briefFixture: BriefFixture) {
    const owner = await writeBrief(CTX_A, briefFixture);
    return {
      pullRequestId: owner.pullRequestId,
      ownerStore: createArtifactStore(shared.handle, CTX_A),
      otherStore: createArtifactStore(shared.handle, CTX_B),
    };
  }

  it("briefs.has answers false on the owner's span", async () => {
    const { pullRequestId, ownerStore, otherStore } = await readAcrossOwners({
      headSha: HEAD,
      headIndex: 1,
    });

    expect(await ownerStore.briefs.has(pullRequestId, BASE, HEAD)).toBe(true);
    expect(await otherStore.briefs.has(pullRequestId, BASE, HEAD)).toBe(false);
  });

  it("chunkLayouts read nothing of the owner's sidecar", async () => {
    const { pullRequestId, ownerStore, otherStore } = await readAcrossOwners({
      headSha: HEAD,
      headIndex: 1,
      chunkLayout: { chunks: { [CHUNK_ID]: CHUNK_COUNTS }, files: {} },
    });
    const brief = await ownerStore.briefs.get(pullRequestId, BASE, HEAD);
    const briefId: BriefRowId | undefined = brief?.id;
    if (briefId === undefined) {
      throw new Error("expected owner A's brief");
    }

    expect(await ownerStore.chunkLayouts.has(briefId)).toBe(true);
    expect(await otherStore.chunkLayouts.has(briefId)).toBe(false);
    expect(
      await otherStore.chunkLayouts.get(pullRequestId, BASE, HEAD),
    ).toBeUndefined();
  });

  it("checkpoint reads return none of the owner's", async () => {
    const { pullRequestId } = await writeBrief(CTX_A, {
      headSha: HEAD,
      headIndex: 1,
    });
    const owner = createTenantRepository(shared.handle, CTX_A);
    await owner.checkpoints.upsertOnSubmit({
      pullRequestId,
      reviewerId: OWNER_A,
      lastSubmittedSha: HEAD,
      submittedAt: new Date(),
    });
    const other = createTenantRepository(shared.handle, CTX_B);

    expect(await owner.checkpoints.listForPullRequest(pullRequestId)).toEqual([
      expect.objectContaining({ reviewerId: OWNER_A }),
    ]);
    expect(await other.checkpoints.listForPullRequest(pullRequestId)).toEqual(
      [],
    );
    expect(await owner.checkpoints.get(pullRequestId, OWNER_A)).toBeDefined();
    expect(await other.checkpoints.get(pullRequestId, OWNER_A)).toBeUndefined();
  });
});
