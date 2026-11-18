import type { Logger } from "logging";
import { ReviewSessionErrorCodes } from "persistence";
import type { PullRequestAccess } from "../../../../access/types";
import { FailureKinds } from "../../../../shared-errors/failures";
import type { AuthRouteDeps } from "../../../auth/session/types";
import { recordSessionReplyReview } from "../session/logic/session-writes";
import type { BriefSpan } from "../session/schemas";
import type { ExistingSessionWriteFailure } from "../session/types";
import { bindFreshRepoClient, shapeMutationDenied } from "./logic/repo-client";
import type { ReplyInput, ReplyResult } from "./types";

/** Refusals a reply meets in ordinary use: nothing is wrong, nothing to alert on. */
function isOrdinaryReplyRecordRefusal(
  failure: ExistingSessionWriteFailure,
): boolean {
  if (failure.kind === "target-not-found" || failure.kind === "no-session") {
    return true;
  }
  return failure.error.code === ReviewSessionErrorCodes.SESSION_FROZEN;
}

/**
 * The reply is already on GitHub. When the request names the Brief it was
 * written from and the reviewer holds a session there, the wrapping review id
 * is recorded on it, so a later read knows the reply as the reviewer's own.
 * It never creates a session, and a refusal never reaches the response.
 */
async function recordReplyReview(
  deps: AuthRouteDeps,
  log: Logger,
  access: PullRequestAccess,
  span: BriefSpan,
  reviewId: number,
): Promise<void> {
  try {
    const recorded = await recordSessionReplyReview(
      { handle: deps.handle, log },
      access,
      span,
      BigInt(reviewId),
    );
    if (recorded.ok) {
      return;
    }

    const reason =
      recorded.error.kind === FailureKinds.SESSION_REJECTED
        ? recorded.error.error.code
        : recorded.error.kind;
    const fields = { reviewId: String(reviewId), reason };
    if (isOrdinaryReplyRecordRefusal(recorded.error)) {
      log.debug("reply review id not recorded", fields);
    } else {
      log.warn("reply review id stayed unrecorded", fields);
    }
  } catch (recordError) {
    log.error("reply review id stayed unrecorded", {
      reviewId: String(reviewId),
      err: recordError,
    });
  }
}

/** Reply under a review comment with the VIEWER's token, on the retry-off client. */
export async function replyToComment(
  deps: AuthRouteDeps,
  log: Logger,
  access: PullRequestAccess,
  input: ReplyInput,
): Promise<ReplyResult> {
  const repo = await bindFreshRepoClient(access);
  if (!repo.ok) {
    return repo;
  }

  const created = await repo.value.createReviewCommentReply({
    prNumber: access.prNumber,
    commentId: input.commentId,
    body: input.body,
  });
  if (!created.ok) {
    return shapeMutationDenied(created.error);
  }

  const { reviewId } = created.value;
  if (reviewId !== undefined && input.span !== undefined) {
    await recordReplyReview(deps, log, access, input.span, reviewId);
  }
  return created;
}
