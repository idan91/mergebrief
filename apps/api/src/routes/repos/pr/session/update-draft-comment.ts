import type { ReviewDraftCommentRow } from "persistence";
import type { PullRequestAccess } from "../../../../access/types";
import { openSessionWrite } from "./logic/session-writes";
import type {
  UpdateDraftRequest,
  SessionRequestResult,
  SessionStoreDeps,
} from "./types";

/** A carried id resolves to the copy the first write made. */
export async function updateDraftComment(
  deps: SessionStoreDeps,
  access: PullRequestAccess,
  request: UpdateDraftRequest,
): Promise<SessionRequestResult<ReviewDraftCommentRow>> {
  const session = await openSessionWrite(deps, access, request.span);
  if (!session.ok) {
    return session;
  }

  return session.value.drafts.edit(request.draftId, request.body);
}
