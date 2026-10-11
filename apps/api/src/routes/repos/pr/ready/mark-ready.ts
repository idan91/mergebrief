import {
  createTenantRepository,
  type AppDatabase,
  type PullRequestRowId,
} from "persistence";
import type { Result } from "types/utils";
import type { PullRequestAccess } from "../../../../access/types";
import { FailureKinds } from "../../../../shared-errors/failures";
import { fetchFreshRepository } from "../../logic/fresh-repository";
import type { MarkReadyFailure } from "./types";

/**
 * GitHub enforces who may mark ready, and the write converges, so a replay
 * after a renewal is safe. Success mirrors `draft = false` so the next page
 * read shows it; a row gone mid-request is the webhook's to reconcile, never
 * a failure of a write GitHub already took.
 */
export async function markPullRequestReady(
  handle: AppDatabase,
  access: PullRequestAccess,
): Promise<Result<PullRequestRowId, MarkReadyFailure>> {
  const fresh = await fetchFreshRepository(access.github, access.repoId);
  if (!fresh.ok) {
    return fresh;
  }

  const repo = access.github.forRepo(fresh.value.ownerAndName);
  const marked = await repo.markPullRequestReadyForReview(access.prNumber);
  if (!marked.ok) {
    const error = marked.error;
    return {
      ok: false,
      error: { kind: FailureKinds.GITHUB_DENIED, phase: "mutation", error },
    };
  }

  const tenant = createTenantRepository(handle, access.rowScope);
  await tenant.pullRequests.setDraft(access.row.id, false);
  return { ok: true, value: access.row.id };
}
