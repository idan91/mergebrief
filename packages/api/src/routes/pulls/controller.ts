// Hono-free. The caller resolved the allowed set (GitHub, fail-closed) and
// judges its failures; this op only reads tenant rows and shapes views.
import { buildPrView } from "../pr-view";
import type { ListPullsInput, PullsControllerDeps } from "./types";

export default {
  async listPulls(deps: PullsControllerDeps, input: ListPullsInput) {
    const rows = await deps.tenant.pullRequests.listForRepos(
      [...input.allowed.keys()],
      input.limit,
    );
    const ids = rows.map((row) => row.id);
    const [latestBriefs, latestGenerations] = await Promise.all([
      deps.artifacts.briefs.latestForPullRequests(ids),
      deps.generations.latestBriefForPullRequests(ids),
    ]);
    const pulls = rows.map((row) =>
      // List path: the allowed-set intersection proves access but carries no
      // permissions block, so push capability is UNKNOWN here — fail closed
      // (authorship-only viewerCanResolve; the brief page reads PR meta).
      buildPrView(
        row,
        latestBriefs.get(row.id),
        latestGenerations.get(row.id),
        input.allowed.get(row.repoId),
        input.viewerLogin,
        false,
      ),
    );
    return { pulls };
  },
};
