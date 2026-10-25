import type {
  PullMetaView,
  RevisionComparisons,
  RevisionView,
  WaitReason,
} from "contract";
import {
  createArtifactStore,
  createGenerationProjection,
  createTenantRepository,
  isOwnerContext,
  type ArtifactStore,
  type GenerationProjection,
  type GenerationRow,
  type PullRequestRow,
  type ReviewerId,
  type TenantRepository,
} from "persistence";
import { GenerationStatuses } from "types/generations";
import type { PullRequestAccess } from "../../../../access/types";
import { readPullRequestRowLive } from "../../../live-read";
import { buildPrView } from "../../../pr-view";
import {
  comparisonSpanSet,
  makeLatestPendingProbe,
  narrativeSpanSet,
} from "./logic/revision-comparisons";
import { buildRevisionView } from "./logic/revision-views";
import { deriveWaitReason } from "./logic/wait-reason";
import type { ReadPullDeps } from "./types";

interface MetaStores {
  readonly tenant: TenantRepository;
  readonly artifacts: ArtifactStore;
  readonly generations: GenerationProjection;
}

/**
 * The row is read live before it is served, under the Inbox's window, so a
 * reader arriving from a bookmark sees the same facts. Only a url row may
 * fall back to the operator. What the read wrote is the write's own return,
 * never the access step's snapshot.
 */
async function readLiveRow(
  deps: ReadPullDeps,
  access: PullRequestAccess,
): Promise<PullRequestRow> {
  const scope = access.rowScope;
  const operator = isOwnerContext(scope) ? deps.operator : undefined;
  const read = await readPullRequestRowLive(
    {
      handle: deps.handle,
      github: access.github,
      readerId: access.session.reviewerId,
      operator,
      log: deps.log,
    },
    { scope, row: access.row, repoFullName: access.repoFullName },
  );
  return read.row;
}

/** The queue is read only for a pending generation; any other poll costs no query. */
async function readWaitReason(
  generations: GenerationProjection,
  latestGeneration: GenerationRow | undefined,
): Promise<WaitReason | undefined> {
  if (latestGeneration?.status !== GenerationStatuses.PENDING) {
    return undefined;
  }

  const { pullRequestId, headSha, status } = latestGeneration;
  const timing = await generations.getGenerateJobTiming(pullRequestId);
  const spent = timing !== undefined && !timing.hasAttemptsLeft;
  const takeover = spent
    ? await generations.readTakeoverJob(pullRequestId, headSha)
    : undefined;
  return deriveWaitReason(status, timing, takeover);
}

/**
 * Per-revision comparison availability from ONE lean listing per artifact
 * kind, joined in memory. The generation-pending probe is wired for the
 * current head only, since history is never actively warming.
 */
async function readRevisions(
  stores: MetaStores,
  pr: PullRequestRow,
  headSha: string,
  latestGeneration: GenerationRow | undefined,
  reviewerId: ReviewerId,
): Promise<RevisionView[]> {
  const [briefs, markRows, deltaRows, narrativeRows, checkpoint, generated] =
    await Promise.all([
      stores.artifacts.briefs.listForPullRequest(pr.id),
      stores.artifacts.comparisonMarks.listForPullRequest(pr.id),
      stores.artifacts.deltas.listForPullRequest(pr.id),
      stores.artifacts.revisionNarratives.listForPullRequest(pr.id),
      stores.tenant.checkpoints.get(pr.id, reviewerId),
      stores.generations.listBriefsForPullRequest(pr.id),
    ]);

  // `created_at` is the first enqueue for that head, shared by duplicate-head
  // (retarget) revisions.
  const generatedAtByHead = new Map(
    generated.map((row) => [row.headSha, row.createdAt]),
  );
  const context = {
    briefs,
    markSpans: comparisonSpanSet(markRows),
    deltaSpans: comparisonSpanSet(deltaRows),
    narrativeSpans: narrativeSpanSet(narrativeRows),
    checkpoint,
    generatedAtByHead,
    currentHeadSha: headSha,
    latestPendingProbe: makeLatestPendingProbe(
      stores.generations,
      pr.id,
      headSha,
      latestGeneration,
    ),
  };
  return Promise.all(briefs.map((entry) => buildRevisionView(entry, context)));
}

/**
 * The regenerate route's own test: a brief stored for the PR's current base
 * and head. A brief for this head on a base the PR has left does not count,
 * so a retargeted head that failed still offers its rerun.
 */
function isCurrentSpanBriefed(
  pr: PullRequestRow,
  headSha: string | null,
  revisions: readonly RevisionView[] | undefined,
): boolean {
  if (revisions === undefined) {
    return false;
  }
  return revisions.some((revision) => {
    const currentSpan =
      revision.headSha === headSha && revision.baseSha === pr.baseSha;
    return currentSpan;
  });
}

/**
 * PR meta: the row, its current-span derivation, the latest brief-kind
 * generation, and every stored revision while a newer head generates.
 */
export async function readPull(
  deps: ReadPullDeps,
  access: PullRequestAccess,
): Promise<PullMetaView> {
  const pr = await readLiveRow(deps, access);
  const stores: MetaStores = {
    tenant: createTenantRepository(deps.handle, access.rowScope),
    artifacts: createArtifactStore(deps.handle, access.rowScope),
    generations: createGenerationProjection(deps.handle, access.rowScope),
  };

  const ids = [pr.id];
  const [latestBriefs, latestGenerations] = await Promise.all([
    stores.artifacts.briefs.latestForPullRequests(ids),
    stores.generations.latestBriefForPullRequests(ids),
  ]);
  const latestBrief = latestBriefs.get(pr.id);
  const latestGeneration = latestGenerations.get(pr.id);
  const waitReason = await readWaitReason(stores.generations, latestGeneration);
  const view = buildPrView(
    pr,
    latestBrief,
    latestGeneration,
    access.repoFullName,
    access.session.reviewerLogin,
    access.viewerCanPush,
    waitReason,
  );

  // A stored brief implies a head (`brief.head_sha` is NOT NULL), so the
  // null check narrows only and never skips stored revisions.
  let comparisons: RevisionComparisons = {};
  let revisions: RevisionView[] | undefined;
  if (latestBrief !== undefined && view.headSha !== null) {
    const reviewerId = access.session.reviewerId;
    revisions = await readRevisions(
      stores,
      pr,
      view.headSha,
      latestGeneration,
      reviewerId,
    );
    if (view.headBriefStored) {
      comparisons = revisions.at(-1)?.comparisons ?? {};
    }
  }

  const briefAvailable = isCurrentSpanBriefed(pr, view.headSha, revisions);
  const appInstalled = !isOwnerContext(access.rowScope);
  const draftPolicy = deps.draftPolicy;
  const meta = {
    ...view,
    briefAvailable,
    comparisons,
    appInstalled,
    draftPolicy,
  };
  if (revisions === undefined) {
    return meta;
  }
  return { ...meta, revisions };
}
