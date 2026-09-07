// Hono-free. The viewer's own url-box world: list it, or erase one row
// through the owner-scoped purge — the FK cascade takes every artifact and
// session with it, and the purge appends its own `delete` audit entry
// atomically.
import {
  createArtifactStore,
  createGenerationProjection,
  createPurgeRoutines,
  createTenantRepository,
  type AppDatabase,
  type PullRequestRowId,
  type RepoId,
  type ReviewerId,
} from "persistence";
import type { Result } from "types";
import { buildPrView, type PrView } from "../pr-view";

interface DeleteUrlBriefInput {
  readonly ownerUserId: ReviewerId;
  readonly repoId: RepoId;
  readonly prNumber: number;
}

type DeleteUrlBriefResult = Result<
  { readonly pullRequestId: PullRequestRowId },
  { readonly kind: "not-found" }
>;

interface ListUrlBriefsInput {
  readonly ownerUserId: ReviewerId;
  readonly viewerLogin: string | null;
  readonly limit: number;
}

export default {
  async listUrlBriefs(
    deps: { readonly handle: AppDatabase },
    input: ListUrlBriefsInput,
  ): Promise<{ readonly pulls: PrView[] }> {
    const ctx = { ownerUserId: input.ownerUserId };
    const rows = await createTenantRepository(
      deps.handle,
      ctx,
    ).pullRequests.listOwned(input.limit);
    const ids = rows.map((row) => row.id);
    const [latestBriefs, latestGenerations] = await Promise.all([
      createArtifactStore(deps.handle, ctx).briefs.latestForPullRequests(ids),
      createGenerationProjection(deps.handle, ctx).latestBriefForPullRequests(
        ids,
      ),
    ]);
    const pulls = rows.map((row) =>
      // Owner rows carry no live-verified slug and no permissions block:
      // the stored repo_slug serves display, push capability fails closed.
      buildPrView(
        row,
        latestBriefs.get(row.id),
        latestGenerations.get(row.id),
        undefined,
        input.viewerLogin,
        false,
      ),
    );
    return { pulls };
  },

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
