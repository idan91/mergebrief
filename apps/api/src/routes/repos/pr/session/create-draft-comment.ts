import type { ReviewDraftCommentRow } from "persistence";
import type { PullRequestAccess } from "../../../../access/types";
import { openSessionWrite } from "./logic/session-writes";
import type {
  CreateDraftRequest,
  SessionRequestResult,
  SessionStoreDeps,
} from "./types";

/** A new draft on the named Brief, counted against the session's cap. */
export async function createDraftComment(
  deps: SessionStoreDeps,
  access: PullRequestAccess,
  request: CreateDraftRequest,
): Promise<SessionRequestResult<ReviewDraftCommentRow>> {
  const session = await openSessionWrite(deps, access, request.span);
  if (!session.ok) {
    return session;
  }

  return session.value.drafts.add(request.draft);
}
