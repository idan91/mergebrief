import type { ReviewDraftCommentRow } from "persistence";
import type { PullRequestAccess } from "../../../../access/types";
import { openSessionWrite } from "./logic/session-writes";
import type {
  ReanchorDraftRequest,
  SessionRequestResult,
  SessionStoreDeps,
} from "./types";

/** Re-placing a draft is what clears its orphaned anchor. */
export async function reanchorDraftComment(
  deps: SessionStoreDeps,
  access: PullRequestAccess,
  request: ReanchorDraftRequest,
): Promise<SessionRequestResult<ReviewDraftCommentRow>> {
  const session = await openSessionWrite(deps, access, request.span);
  if (!session.ok) {
    return session;
  }

  return session.value.drafts.reanchor(request.draftId, request.anchor);
}
