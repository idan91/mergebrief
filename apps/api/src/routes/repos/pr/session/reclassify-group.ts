import type { ReviewGroupReclassificationRow } from "persistence";
import type { PullRequestAccess } from "../../../../access/types";
import { openSessionWrite } from "./logic/session-writes";
import type {
  ReclassifyGroupRequest,
  SessionRequestResult,
  SessionStoreDeps,
} from "./types";

/**
 * Overrides only: the Brief supplies every default, so an unchanged group
 * never reaches this operation.
 */
export async function reclassifyGroup(
  deps: SessionStoreDeps,
  access: PullRequestAccess,
  request: ReclassifyGroupRequest,
): Promise<SessionRequestResult<ReviewGroupReclassificationRow>> {
  const session = await openSessionWrite(deps, access, request.span);
  if (!session.ok) {
    return session;
  }

  return session.value.work.reclassifyGroup(request.reclassification);
}
