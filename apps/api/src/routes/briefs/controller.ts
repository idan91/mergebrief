// Hono-free. The viewer's own url-box world listed; the erase moved to the
// Inbox controller, which this route's delete calls until the old lists go.
import {
  createArtifactStore,
  createGenerationProjection,
  createTenantRepository,
  type AppDatabase,
  type ReviewerId,
} from "persistence";
import { buildPrView, type PrView } from "../pr-view";

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
};
