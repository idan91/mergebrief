import type {
  GenerationClaimsResponse,
  GenerationClaimsView,
  TakeoverView,
} from "contract";
import {
  createGenerationProjection,
  MAX_GENERATION_ATTEMPTS,
  type AppDatabase,
  type TakeoverJob,
} from "persistence";
import { TakeoverJobStates, type Mutable } from "types";
import type { PullRequestAccess } from "../../../../access/types";

function shapeTakeover(job: TakeoverJob): TakeoverView {
  if (job.state === TakeoverJobStates.SCHEDULED) {
    const runsAt = job.runsAt.toISOString();
    return { state: job.state, runsAt };
  }
  return { state: job.state };
}

export async function readGenerationClaims(
  handle: AppDatabase,
  access: PullRequestAccess,
): Promise<GenerationClaimsResponse> {
  const generations = createGenerationProjection(handle, access.rowScope);
  const claims = await generations.readBriefClaims(access.row.id);
  if (claims === undefined) {
    return {};
  }

  const row = claims.generation;
  const takeover = await generations.readTakeoverJob(
    row.pullRequestId,
    row.headSha,
  );
  const view: Mutable<GenerationClaimsView> = {
    headSha: row.headSha,
    status: row.status,
    claims: row.claims,
    claimLimit: MAX_GENERATION_ATTEMPTS,
    exhausted: claims.exhausted,
  };
  if (row.errorCode !== null) {
    view.errorCode = row.errorCode;
  }
  if (row.errorParams !== null) {
    view.errorParams = row.errorParams;
  }
  if (takeover !== undefined) {
    view.takeover = shapeTakeover(takeover);
  }
  return { generation: view };
}
