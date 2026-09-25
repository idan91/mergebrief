// Hono-free. The Inbox page from the store, plus the generation slice each
// row's world holds, and the owner-scoped erase of one url row.
import type { InboxResponse } from "contract";
import {
  createGenerationProjection,
  createInboxStore,
  createPurgeRoutines,
  createTenantRepository,
  type GenerationRow,
  type InboxRow,
  type PullRequestRow,
  type PullRequestRowId,
  type RepoId,
  type ReviewerId,
  type ScopeContext,
} from "persistence";
import type { Result } from "types/utils";
import { shapeViewer } from "../viewer";
import { resolveViewerCanDelete, shapeInboxItem } from "./logic/shape-item";
import type { InboxControllerDeps, ListInboxInput } from "./types";
import { INBOX_PAGE_SIZE } from "../wire-bounds";

interface DeleteInboxItemInput {
  readonly ownerUserId: ReviewerId;
  readonly repoId: RepoId;
  readonly prNumber: number;
}

type DeleteInboxItemResult = Result<
  { readonly pullRequestId: PullRequestRowId },
  { readonly kind: "not-found" }
>;

const INSTALL_URL_PREFIX = "https://github.com/apps/";

/** GitHub's new-installation page for the App, by its URL name. */
function buildInstallUrl(slug: string | undefined): string | null {
  if (slug === undefined) return null;
  return `${INSTALL_URL_PREFIX}${encodeURIComponent(slug)}/installations/new`;
}

/** A row's world by its columns; the CHECK makes exactly one of the two set. */
function resolveRowWorld(row: PullRequestRow): ScopeContext | undefined {
  if (row.installationId !== null) {
    return { installationId: row.installationId };
  }
  if (row.ownerUserId !== null) return { ownerUserId: row.ownerUserId };
  return undefined;
}

/** The projection is scoped, so the page's rows are read back per world. */
async function readLatestGenerations(
  deps: InboxControllerDeps,
  rows: readonly InboxRow[],
): Promise<ReadonlyMap<PullRequestRowId, GenerationRow>> {
  const byWorld = new Map<
    string,
    { ctx: ScopeContext; ids: PullRequestRowId[] }
  >();
  for (const { pullRequest } of rows) {
    const ctx = resolveRowWorld(pullRequest);
    if (ctx === undefined) continue;
    const key = JSON.stringify(ctx, (_, value: unknown) =>
      typeof value === "bigint" ? String(value) : value,
    );
    const world = byWorld.get(key) ?? { ctx, ids: [] };
    world.ids.push(pullRequest.id);
    byWorld.set(key, world);
  }

  const merged = new Map<PullRequestRowId, GenerationRow>();
  const pages = await Promise.all(
    [...byWorld.values()].map(({ ctx, ids }) =>
      createGenerationProjection(deps.handle, ctx).latestBriefForPullRequests(
        ids,
      ),
    ),
  );
  for (const page of pages) {
    for (const [id, row] of page) merged.set(id, row);
  }
  return merged;
}

export default {
  async listInbox(
    deps: InboxControllerDeps,
    input: ListInboxInput,
  ): Promise<InboxResponse> {
    const page = await createInboxStore(deps.handle).list({
      installationIds: input.installations.map((entry) => entry.installationId),
      allowedRepoIds: input.allowedRepoIds,
      ownerUserId: input.reviewerId,
      reviewerId: input.reviewerId,
      reviewerLogin: input.reviewerLogin,
      filters: input.filters,
      sort: input.sort,
      layout: input.layout,
      page: input.page,
      pageSize: INBOX_PAGE_SIZE,
    });
    const [generations, liveStacks] = await Promise.all([
      readLatestGenerations(deps, page.items),
      deps.readLiveStacks?.(page.items),
    ]);

    return {
      items: page.items.map((row) =>
        shapeInboxItem(
          row,
          generations.get(row.pullRequest.id),
          resolveViewerCanDelete(row, input.adminRepoIds),
          liveStacks?.get(row.pullRequest.id),
        ),
      ),
      page: page.page,
      pageSize: page.pageSize,
      total: page.total,
      counts: page.counts,
      viewer: shapeViewer(input.reviewerId, input.reviewerLogin),
      reachableInstallations: input.installations.map((entry) => ({
        installationId: String(entry.installationId),
        accountLogin: entry.accountLogin,
      })),
      repositories: page.repositories.map((repository) => ({
        repoId: String(repository.repoId),
        repoSlug: repository.repoSlug,
      })),
      installUrl: buildInstallUrl(input.githubAppSlug),
    };
  },

  /**
   * Erase one of the viewer's url rows through the owner-scoped purge; the
   * FK cascade takes every artifact and session with it, and the purge
   * appends its own `delete` audit entry atomically.
   */
  async deleteInboxItem(
    deps: InboxControllerDeps,
    input: DeleteInboxItemInput,
  ): Promise<DeleteInboxItemResult> {
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
