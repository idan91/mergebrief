// The Review Session suites' shared world: one tenant, one repo, one PR, and
// the seeds that put Briefs and a previous session's work behind it. Shared
// because the read suite and the write suite must agree on the fixture, a
// carry-over the read reports and a write writes is the same work.
import {
  createArtifactStore,
  createTenantRepository,
  type AppDatabase,
  type BriefRowId,
  type TenantContext,
} from "persistence";
import { ChangeGroupCategories } from "types/reviews";
import { DispositionDecisions } from "types/dispositions";
import { PrStates } from "types/pull-requests";
import { CommentAnchorKinds, DiffSides } from "types/comments";
import {
  INSTALLATION_ID,
  PR_NUMBER,
  REPO_SLUG,
  REVIEWER_ID,
  brandInstallationId,
  brandRepoId,
  brandReviewerId,
} from "../fixtures";

export const REPO_ID = 424242;

/** Two flags firing on one file, and one change group, the carry inputs. */
export const BRIEF_BODY = JSON.stringify({
  summary: "the brief",
  changeGroups: [{ id: "g1", title: "t" }],
  chunks: [
    {
      id: "c1",
      file: "src/app.ts",
      addedRanges: [{ start: 5, end: 40 }],
      removedRanges: [],
      riskSurface: ["no-tests", "no-error-path"],
    },
    {
      id: "c2",
      file: "src/other.ts",
      addedRanges: [],
      removedRanges: [],
      riskSurface: [],
    },
  ],
});

export const CTX: TenantContext = {
  installationId: brandInstallationId(BigInt(INSTALLATION_ID)),
};
export const REVIEWER = brandReviewerId(BigInt(REVIEWER_ID));

export async function seedPullRequest(handle: AppDatabase): Promise<void> {
  await createTenantRepository(handle, CTX).pullRequests.upsert({
    repoId: brandRepoId(BigInt(REPO_ID)),
    prNumber: PR_NUMBER,
    repoSlug: REPO_SLUG,
    state: PrStates.OPEN,
  });
}

/** One Brief at `head-<index>`; the base never moves. */
export async function seedBrief(
  handle: AppDatabase,
  headIndex: number,
  body: string = BRIEF_BODY,
  carriedChunkIds: readonly string[] = [],
): Promise<BriefRowId> {
  const pr = await createTenantRepository(handle, CTX).pullRequests.getByNumber(
    brandRepoId(BigInt(REPO_ID)),
    PR_NUMBER,
  );
  if (pr === undefined) {
    throw new Error("seedBrief: pr missing");
  }
  const written = await createArtifactStore(handle, CTX).briefs.write({
    pullRequestId: pr.id,
    baseSha: "base",
    headSha: `head-${headIndex}`,
    headIndex,
    commitCount: 1,
    provider: "anthropic",
    model: "claude",
    effort: "high",
    body,
    carriedChunkIds,
    // The carry suite's chain must read as descended, or reclassifications
    // (correctly) drop across the seeded span.
    anchorState: "anchored",
  });
  if (!written.ok) {
    throw new Error(`seedBrief: ${written.error.code}`);
  }
  return written.value.id;
}

/**
 * The durable hop between two Brief heads. Its one hunk sits above every
 * anchor the fixtures place, so the chain links and nothing moves, which is
 * what lets a carried decision settle rather than reopen.
 */
export async function seedHop(
  handle: AppDatabase,
  fromIndex: number,
  toIndex: number,
): Promise<void> {
  await writeHop(handle, fromIndex, toIndex, [
    {
      file: "src/app.ts",
      hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1 }],
    },
  ]);
}

async function writeHop(
  handle: AppDatabase,
  fromIndex: number,
  toIndex: number,
  spans: unknown,
): Promise<void> {
  const pr = await createTenantRepository(handle, CTX).pullRequests.getByNumber(
    brandRepoId(BigInt(REPO_ID)),
    PR_NUMBER,
  );
  if (pr === undefined) {
    throw new Error("seedHop: pr missing");
  }
  const written = await createArtifactStore(handle, CTX).hunkSpans.write({
    pullRequestId: pr.id,
    baselineSha: `head-${fromIndex}`,
    headSha: `head-${toIndex}`,
    spans,
  });
  if (!written.ok) {
    throw new Error(`seedHop: ${written.error.code}`);
  }
}

/** A hop whose hunk lands inside the flagged region, so a decision reopens. */
export async function seedHopInsideFlaggedRegion(
  handle: AppDatabase,
  fromIndex: number,
  toIndex: number,
): Promise<void> {
  await writeHop(handle, fromIndex, toIndex, [
    {
      file: "src/app.ts",
      hunks: [{ oldStart: 10, oldLines: 3, newStart: 10, newLines: 3 }],
    },
  ]);
}

/**
 * A second draft on the previous session, orphaning the same way the first
 * does, an attention list with more than one item to walk.
 */
export async function seedOrphanedDraft(
  handle: AppDatabase,
  briefId: BriefRowId,
): Promise<void> {
  const repo = createTenantRepository(handle, CTX);
  const added = await repo.reviewSessions.addDraft(
    { briefId, reviewerId: REVIEWER },
    {
      anchor: {
        kind: CommentAnchorKinds.LINE,
        file: "src/other.ts",
        side: DiffSides.NEW,
        startLine: 10,
        endLine: 12,
      },
      body: "and this one too",
    },
  );
  if (!added.ok) {
    throw new Error("second draft comment seed failed");
  }
}

/**
 * A previous session holding work that cannot be re-placed: no `hunk_span`
 * row links the two heads, so the chain is untrustworthy and every anchor
 * orphans, an orphaned draft comment and a reopened disposition.
 */
export async function seedPreviousWork(
  handle: AppDatabase,
  briefId: BriefRowId,
): Promise<void> {
  const sessions = createTenantRepository(handle, CTX).reviewSessions;
  const key = { briefId, reviewerId: REVIEWER };
  const outcomes = [
    await sessions.addDraft(key, {
      anchor: {
        kind: CommentAnchorKinds.LINE,
        file: "src/app.ts",
        side: DiffSides.NEW,
        startLine: 10,
        endLine: 12,
      },
      body: "this allocation is unbounded",
    }),
    await sessions.reclassifyGroup(key, {
      changeGroupId: "g1",
      category: ChangeGroupCategories.LOGIC_REFACTOR,
    }),
    await sessions.decideRisks(key, [
      {
        filePath: "src/app.ts",
        attribute: "no-tests",
        regionStart: 10,
        regionEnd: 12,
        decision: DispositionDecisions.DISMISSED,
        reason: "covered by the integration suite",
      },
    ]),
  ];
  if (outcomes.some((outcome) => !outcome.ok)) {
    throw new Error("previous session seed failed");
  }
}
