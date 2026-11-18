import { DispositionDecisions } from "types/dispositions";
import type { PullRequestAccess } from "../../../../access/types";
import { openSessionWrite } from "./logic/session-writes";
import type {
  DismissRiskRequest,
  SessionRequestResult,
  SessionStoreDeps,
} from "./types";

/**
 * One decision over the whole array: a half-applied bulk is not a state the
 * reviewer asked for. Answers the rows that changed.
 */
export async function dismissRisk(
  deps: SessionStoreDeps,
  access: PullRequestAccess,
  request: DismissRiskRequest,
): Promise<SessionRequestResult<number>> {
  const session = await openSessionWrite(deps, access, request.span);
  if (!session.ok) {
    return session;
  }

  const decisions = request.flags.map((flag) => ({
    ...flag,
    decision: DispositionDecisions.DISMISSED,
    reason: request.reason,
  }));
  return session.value.work.decideRisks(decisions);
}
