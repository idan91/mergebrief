// Hono-free. The Inbox page from the store, plus the generation slice each
// row's world holds.
import type { InboxResponse } from "contract";
import {
  createGenerationProjection,
  createInboxStore,
  type GenerationRow,
  type InboxRow,
  type PullRequestRow,
  type PullRequestRowId,
  type ScopeContext,
} from "persistence";
import { shapeViewer } from "../viewer";
import { resolveViewerCanDelete, shapeInboxItem } from "./logic/shape-item";
import type { Result } from "types/utils";
import { purgeRowIn, type RowPurgeFailure } from "../purge-row";
import type {
  DeleteOwnPullInput,
  InboxControllerDeps,
  ListInboxInput,
} from "./types";

type DeleteOwnPullResult = Result<
  { readonly pullRequestId: PullRequestRowId },
  RowPurgeFailure
>;

const NOT_FOUND: DeleteOwnPullResult = {
  ok: false,
  error: { kind: "not-found" },
};
import { INBOX_PAGE_SIZE } from "../wire-bounds";

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

export const inboxController = {
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
      archivedTotal: page.archivedTotal,
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
   * Erase the viewer's own pasted row and everything hanging off it. The
   * owner scope is the wall: a row in any installation, or another
   * reviewer's paste, is indistinguishable from none. No GitHub call.
   */
  async deleteOwnPull(
    deps: InboxControllerDeps,
    input: DeleteOwnPullInput,
  ): Promise<DeleteOwnPullResult> {
    const pullRequestId = await purgeRowIn(
      deps.handle,
      { ownerUserId: input.ownerUserId },
      input,
      input.ownerUserId,
    );
    if (pullRequestId === undefined) {
      return NOT_FOUND;
    }
    return { ok: true, value: { pullRequestId } };
  },
};
