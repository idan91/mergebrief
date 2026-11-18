import type { ReviewSessionRow } from "persistence";
import type { PullRequestAccess } from "../../../../access/types";
import { openSessionWrite } from "./logic/session-writes";
import type {
  SetReviewOutcomeRequest,
  SessionRequestResult,
  SessionStoreDeps,
} from "./types";

/** Answers the session row, so the reply reads the outcome back off it. */
export async function setReviewOutcome(
  deps: SessionStoreDeps,
  access: PullRequestAccess,
  request: SetReviewOutcomeRequest,
): Promise<SessionRequestResult<ReviewSessionRow>> {
  const session = await openSessionWrite(deps, access, request.span);
  if (!session.ok) {
    return session;
  }

  return session.value.work.setOutcome(request.outcome);
}
