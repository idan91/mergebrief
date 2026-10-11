import type { PullRequestAccess } from "../../../../access/types";
import { openSessionWrite } from "./logic/session-writes";
import type {
  ReopenRiskRequest,
  SessionRequestResult,
  SessionStoreDeps,
} from "./types";

/** The bare undo: an undecided flag is a row that does not exist. */
export async function reopenRisk(
  deps: SessionStoreDeps,
  access: PullRequestAccess,
  request: ReopenRiskRequest,
): Promise<SessionRequestResult<number>> {
  const session = await openSessionWrite(deps, access, request.span);
  if (!session.ok) {
    return session;
  }

  return session.value.work.reopenRisks(request.flags);
}
