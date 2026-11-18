import type { InboxResponse } from "contract";
import type { RepositoryRef } from "github";
import type { InboxFilters, InstallationId, RepoId } from "persistence";
import type { Mutable, Result } from "types/utils";
import type { RequestGitHub } from "../../access/reviewer-binding";
import type { AllowedRepo } from "../installation-resolver";
import { readInboxRowsLive } from "../live-read";
import { INBOX_LIVE_BUDGET_MS } from "./consts";
import { readInboxPage } from "./logic/inbox-page";
import { readLiveStacks } from "./logic/live-stacks";
import type { InboxQuery } from "./schemas";
import type { ListInboxDeps, ListInboxFailure } from "./types";

function collectAdminRepoIds(
  allowed: ReadonlyMap<RepoId, AllowedRepo>,
): ReadonlySet<RepoId> {
  const admin = new Set<RepoId>();
  for (const [repoId, repo] of allowed) {
    if (repo.viewerIsAdmin) {
      admin.add(repoId);
    }
  }
  return admin;
}

/** The viewer's readable repositories, grouped by the installation holding each. */
function groupReposByInstallation(
  allowed: ReadonlyMap<RepoId, AllowedRepo>,
): ReadonlyMap<InstallationId, RepoId[]> {
  const grouped = new Map<InstallationId, RepoId[]>();
  for (const [repoId, repo] of allowed) {
    const repoIds = grouped.get(repo.installationId) ?? [];
    repoIds.push(repoId);
    grouped.set(repo.installationId, repoIds);
  }
  return grouped;
}

/** What the live read left of the Inbox's ceiling for the open lists. */
function readRemainingBudget(startedAt: number): number {
  const spentMs = Date.now() - startedAt;
  return Math.max(0, INBOX_LIVE_BUDGET_MS - spentMs);
}

/** The caller's filters only narrow the reach the store is handed. */
function shapeFilters(query: InboxQuery): InboxFilters {
  const filters: Mutable<InboxFilters> = {
    statuses: query.state,
    author: query.author,
    archived: query.archived,
  };
  if (query.repo !== undefined) {
    filters.repoIds = query.repo;
  }
  if (query.review !== undefined) {
    filters.reviewStates = query.review;
  }
  if (query.installation !== undefined) {
    filters.installationIds = query.installation;
  }
  if (query.q !== undefined) {
    filters.searchText = query.q;
  }
  return filters;
}

/**
 * The one list across every installation the viewer reaches plus their own
 * url rows. The row set is the viewer's readable repositories, the same
 * installation-and-user intersection the per-repo gate proves, never the
 * installation alone: a private repository they cannot read must not list
 * its pull requests.
 */
export async function listInbox(
  deps: ListInboxDeps,
  request: RequestGitHub,
  query: InboxQuery,
): Promise<Result<InboxResponse, ListInboxFailure>> {
  const reachable = await deps.installations.resolve(request);
  if (!reachable.ok) {
    return reachable;
  }
  const allowed = await deps.repos.listAllowedRepos(request, deps.log);
  if (!allowed.ok) {
    return allowed;
  }
  const session = allowed.value.session;

  // Rows are read live first, under the ceiling: the viewer's own url rows,
  // where the operator may answer for a brief generated through it, and each
  // installation's rows in the repositories the viewer can read, a backstop
  // for a missed webhook. A failure serves the stored rows.
  const { handle } = deps;
  const { github } = request;
  const readerId = session.reviewerId;
  const startedAt = Date.now();
  const reposByInstallation = groupReposByInstallation(allowed.value.allowed);
  await readInboxRowsLive(
    { handle, github, readerId, operator: deps.operator, log: deps.log },
    { ownerUserId: readerId, reposByInstallation },
  );

  const stacksDeps = {
    listOpenPulls: (target: RepositoryRef) =>
      github.forRepo(target).listOpenPullRequests(),
    openPullsCache: deps.openPullsCache,
    log: deps.log,
  };
  const page = await readInboxPage(
    {
      handle,
      readLiveStacks: (rows) =>
        readLiveStacks(stacksDeps, {
          sessionTokenHash: session.sessionTokenHash,
          rows,
          repoNames: allowed.value.allowed,
          budgetMs: readRemainingBudget(startedAt),
        }),
    },
    {
      installations: reachable.value.installations,
      allowedRepoIds: [...allowed.value.allowed.keys()],
      adminRepoIds: collectAdminRepoIds(allowed.value.allowed),
      reviewerId: readerId,
      reviewerLogin: session.reviewerLogin,
      filters: shapeFilters(query),
      sort: query.sort,
      layout: query.layout,
      page: query.page,
      githubAppSlug: deps.githubAppSlug,
    },
  );
  return { ok: true, value: page };
}
