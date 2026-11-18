import { DispositionDecisions } from "types/dispositions";
import type { PullRequestAccess } from "../../../../access/types";
import { openSessionWrite } from "./logic/session-writes";
import type {
  AddressRiskRequest,
  SessionRequestResult,
  SessionStoreDeps,
} from "./types";

/**
 * Deciding again also settles the evidence question a carry raised: the
 * reviewer just named what this decision stands on.
 */
export async function addressRisk(
  deps: SessionStoreDeps,
  access: PullRequestAccess,
  request: AddressRiskRequest,
): Promise<SessionRequestResult<number>> {
  const session = await openSessionWrite(deps, access, request.span);
  if (!session.ok) {
    return session;
  }

  const decisions = request.flags.map(({ evidence, ...anchor }) => ({
    ...anchor,
    decision: DispositionDecisions.ADDRESSED,
    evidence,
  }));
  return session.value.work.decideRisks(decisions);
}
