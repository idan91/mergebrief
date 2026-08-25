// Hono-free. Resolve the viewer's own url-box row, then erase it through the
// owner-scoped purge — the FK cascade takes every artifact and session with
// it, and the purge appends its own `delete` audit entry atomically.
import {
  createPurgeRoutines,
  createTenantRepository,
  type AppDatabase,
  type PullRequestRowId,
  type RepoId,
  type ReviewerId,
} from "persistence";
import type { Result } from "types";

interface DeleteUrlBriefInput {
  readonly ownerUserId: ReviewerId;
  readonly repoId: RepoId;
  readonly prNumber: number;
}

type DeleteUrlBriefResult = Result<
  { readonly pullRequestId: PullRequestRowId },
  { readonly kind: "not-found" }
>;

export default {
  async deleteUrlBrief(
    deps: { readonly handle: AppDatabase },
    input: DeleteUrlBriefInput,
  ): Promise<DeleteUrlBriefResult> {
    const ctx = { ownerUserId: input.ownerUserId };
    const row = await createTenantRepository(
      deps.handle,
      ctx,
    ).pullRequests.getByNumber(input.repoId, input.prNumber);
    if (row === undefined) {
      return { ok: false, error: { kind: "not-found" } };
    }
    const purged = await createPurgeRoutines(deps.handle, ctx).purgePullRequest(
      row.id,
    );
    if (!purged.ok) {
      return { ok: false, error: { kind: "not-found" } };
    }
    return { ok: true, value: { pullRequestId: row.id } };
  },
};
