import type { ReviewDraftCommentRow } from "persistence";
import type { PullRequestAccess } from "../../../../access/types";
import { openSessionWrite } from "./logic/session-writes";
import type {
  DraftRequest,
  SessionRequestResult,
  SessionStoreDeps,
} from "./types";

/**
 * Answers the row that went, not the id that named it: a carried id names
 * the previous session's row, which the copy's deletion leaves alive.
 */
export async function deleteDraftComment(
  deps: SessionStoreDeps,
  access: PullRequestAccess,
  request: DraftRequest,
): Promise<SessionRequestResult<ReviewDraftCommentRow>> {
  const session = await openSessionWrite(deps, access, request.span);
  if (!session.ok) {
    return session;
  }

  return session.value.drafts.delete(request.draftId);
}
