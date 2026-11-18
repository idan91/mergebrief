import type { ReviewerRepoClient } from "github";
import type { Logger } from "logging";
import type { PullRequestAccess } from "../../../../access/types";
import { releaseUnsentClaim } from "../publish";
import {
  checkInDoubtDraft,
  claimDraft,
  isClaimInDoubt,
  postClaimedDraft,
  readHeldDraft,
  recordPublishedDraft,
} from "./logic/claim";
import { bindFreshRepoClient } from "./logic/repo-client";
import type { PostNowRequest, PostNowResult } from "./types";

/**
 * Claim the draft, then post it on a repo client re-resolved after the
 * claim; a re-resolve GitHub refuses never reached GitHub, so the claim goes
 * back. `known` is the client an in-doubt check already re-resolved.
 */
async function claimAndPost(
  log: Logger,
  access: PullRequestAccess,
  request: PostNowRequest,
  known: ReviewerRepoClient | undefined,
): Promise<PostNowResult> {
  const { session } = request;
  const claimed = await claimDraft(session, request.draftId);
  if (!claimed.ok) {
    return claimed;
  }
  const claim = claimed.value;

  let repo = known;
  if (repo === undefined) {
    const fresh = await bindFreshRepoClient(access);
    if (!fresh.ok) {
      await releaseUnsentClaim(session.publish, log, claim.claim);
      return fresh;
    }
    repo = fresh.value;
  }

  const pin = { prNumber: access.prNumber, commitId: request.commitId };
  const posted = await postClaimedDraft(log, session.publish, repo, pin, claim);
  if (!posted.ok) {
    return posted;
  }
  await recordPublishedDraft(log, session, claim.claim, posted.value);
  return posted;
}

/**
 * Publish one held draft at once, as an inline comment on the viewer's
 * retry-off client. The session answers first, with no GitHub call spent: a
 * frozen tab, an unknown draft and one already published or held by another
 * attempt are all decided off rows this server holds. An in-doubt draft is
 * looked for on GitHub before it is posted again.
 */
export async function postDraftNow(
  log: Logger,
  access: PullRequestAccess,
  request: PostNowRequest,
): Promise<PostNowResult> {
  const held = await readHeldDraft(request.session, request.draftId);
  if (!held.ok) {
    return held;
  }
  const draft = held.value;
  if (draft === undefined || !isClaimInDoubt(draft)) {
    return claimAndPost(log, access, request, undefined);
  }

  const repo = await bindFreshRepoClient(access);
  if (!repo.ok) {
    return repo;
  }
  const found = await checkInDoubtDraft(
    {
      log,
      session: request.session,
      repo: repo.value,
      prNumber: access.prNumber,
      viewerId: access.session.reviewerId,
    },
    draft,
  );
  if (!found.ok) {
    return found;
  }
  if (found.value !== undefined) {
    return { ok: true, value: found.value };
  }
  return claimAndPost(log, access, request, repo.value);
}
