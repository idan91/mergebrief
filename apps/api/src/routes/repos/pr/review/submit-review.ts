import type { Logger } from "logging";
import type { PullRequestAccess } from "../../../../access/types";
import { fetchFreshRepository } from "../../logic/fresh-repository";
import {
  deriveWriteDeadline,
  isReviewUnsent,
  publishReview,
  releaseUnsentClaim,
} from "../publish";
import {
  isSubmitAcceptable,
  readSubmittableDrafts,
  recordSubmittedReview,
} from "./logic/claim";
import type { SubmitReviewRequest, SubmitReviewResult } from "./types";

/**
 * Post ONE formal review on the viewer's token: claim the held drafts,
 * re-resolve the repository, then pending review, threads and submit. The
 * session answers first, with no GitHub call spent: a frozen tab, an
 * orphaned draft and a draft another attempt holds are refused off rows
 * this server holds. A failure known not to have reached GitHub hands the
 * claim back; one that may have keeps it until its lease runs out.
 */
export async function submitReview(
  log: Logger,
  access: PullRequestAccess,
  request: SubmitReviewRequest,
): Promise<SubmitReviewResult> {
  const { session } = request;
  const drafts = await readSubmittableDrafts(session);
  if (!drafts.ok) {
    return drafts;
  }
  if (!isSubmitAcceptable(request, drafts.value)) {
    return { ok: false, error: { kind: "submit-invalid" } };
  }
  const claimed = await session.publish.claim(
    drafts.value.map((row) => row.id),
  );
  if (!claimed.ok) {
    return claimed;
  }
  const claim = claimed.value;

  const fresh = await fetchFreshRepository(access.github, access.repoId);
  if (!fresh.ok) {
    await releaseUnsentClaim(session.publish, log, claim.claim);
    return fresh;
  }
  const repo = access.github.forRepo(fresh.value.ownerAndName);

  const published = await publishReview(
    { repo, log },
    {
      pin: { prNumber: access.prNumber, commitId: request.commitId },
      outcome: request.outcome,
      body: request.body,
      drafts: claim.drafts,
      writeDeadline: deriveWriteDeadline(claim.drafts),
    },
  );
  if (!published.ok) {
    if (isReviewUnsent(published.error)) {
      await releaseUnsentClaim(session.publish, log, claim.claim);
    }
    return published;
  }

  await recordSubmittedReview(log, session, claim, published.value.reviewId);
  return published;
}
