import { ApiErrorCodes, InboxQueryKeys } from "contract";
import {
  createUserOctokit,
  listOpenPullRequests,
  type OpenPullRequest,
  type RepositoryRef,
} from "github";
import type { Context } from "hono";
import type { InboxFilters } from "persistence";
import type { Mutable } from "types/utils";
import {
  BadGateway,
  BadRequest,
  NotFound,
  Unauthorized,
} from "../../shared-errors/api-error";
import { isGitHubDenial } from "../../shared-errors/failures";
import { stampAuditTarget } from "../../product-operations/audit";
import type { AccessibleInstallationsResolver } from "../auth/accessible-installations";
import type { InstallationResolver } from "../installation-resolver";
import { createReviewerGitHubClient } from "../auth/reviewer-github-client";
import type { AuthRouteDeps } from "../auth/session/types";
import type { AuthzEnv } from "../authz";
import { refreshUrlPullRequests } from "../live-read";
import type { TtlCache } from "../ttl-cache";
import { parseRepoIdParam, prNumberSchema } from "../wire-bounds";
import { INBOX_LIVE_BUDGET_MS } from "./consts";
import inboxController from "./controller";
import { readLiveStacks } from "./logic/live-stacks";
import { inboxQuerySchema, type InboxQuery } from "./schemas";

const NO_STORE = { "cache-control": "no-store" } as const;

function shapeFilters(query: InboxQuery): InboxFilters {
  const filters: Mutable<InboxFilters> = {
    statuses: query.state,
    author: query.author,
  };
  if (query.repo !== undefined) filters.repoIds = query.repo;
  if (query.review !== undefined) filters.reviewStates = query.review;
  if (query.installation !== undefined) {
    filters.installationIds = query.installation;
  }
  return filters;
}

export default function createHandlers(
  deps: AuthRouteDeps,
  installations: AccessibleInstallationsResolver,
  repos: InstallationResolver,
  openPullsCache: TtlCache<readonly OpenPullRequest[]>,
) {
  return {
    listInbox: async (c: Context<AuthzEnv>) => {
      const query = inboxQuerySchema.safeParse({
        [InboxQueryKeys.PAGE]: c.req.query(InboxQueryKeys.PAGE),
        [InboxQueryKeys.SORT]: c.req.query(InboxQueryKeys.SORT),
        [InboxQueryKeys.LAYOUT]: c.req.query(InboxQueryKeys.LAYOUT),
        [InboxQueryKeys.STATE]: c.req.queries(InboxQueryKeys.STATE),
        [InboxQueryKeys.REPO]: c.req.queries(InboxQueryKeys.REPO),
        [InboxQueryKeys.REVIEW]: c.req.queries(InboxQueryKeys.REVIEW),
        [InboxQueryKeys.AUTHOR]: c.req.query(InboxQueryKeys.AUTHOR),
        [InboxQueryKeys.INSTALLATION]: c.req.queries(
          InboxQueryKeys.INSTALLATION,
        ),
      });
      if (!query.success) {
        throw new BadRequest();
      }
      const log = c.get("logger");
      const reachable = await installations.resolve(c.get("session"), log);
      if (!reachable.ok) {
        if (reachable.error.kind === "auth-dead") {
          throw new Unauthorized();
        }
        throw new BadGateway(ApiErrorCodes.GITHUB_UNAVAILABLE);
      }
      // The row set is the viewer's readable repositories, the same
      // installation-and-user intersection the per-repo gate proves, never
      // the installation alone: a private repository they cannot read must
      // not list its pull requests.
      const allowed = await repos.listAllowedRepos(
        reachable.value.session,
        log,
      );
      if (!allowed.ok) {
        if (allowed.error.status === 401) throw new Unauthorized();
        throw new BadGateway(ApiErrorCodes.GITHUB_UNAVAILABLE);
      }
      const session = allowed.value.session;

      // The viewer's own url rows are read live first, under the ceiling;
      // the rows are theirs, so the operator PAT may answer for a brief
      // generated through it. A failure serves the stored rows.
      const github = createReviewerGitHubClient(deps, session, log);
      const listOpenPulls = (target: RepositoryRef) =>
        github.runRead(
          (token) => listOpenPullRequests(createUserOctokit(token), target),
          isGitHubDenial,
        );
      const startedAt = Date.now();
      await refreshUrlPullRequests(
        {
          handle: deps.handle,
          github,
          fallbackToken: deps.urlBoxFallbackToken,
          log,
        },
        session.reviewerId,
      );

      const body = await inboxController.listInbox(
        {
          handle: deps.handle,
          readLiveStacks: (rows) =>
            readLiveStacks(
              { listOpenPulls, openPullsCache, log },
              {
                sessionTokenHash: session.sessionTokenHash,
                rows,
                repoNames: allowed.value.allowed,
                budgetMs: Math.max(
                  0,
                  INBOX_LIVE_BUDGET_MS - (Date.now() - startedAt),
                ),
              },
            ),
        },
        {
          installations: reachable.value.installations,
          allowedRepoIds: [...allowed.value.allowed.keys()],
          reviewerId: session.reviewerId,
          reviewerLogin: session.reviewerLogin,
          filters: shapeFilters(query.data),
          sort: query.data.sort,
          layout: query.data.layout,
          page: query.data.page,
          githubAppSlug: deps.githubAppSlug,
        },
      );
      return c.json(body, 200, NO_STORE);
    },

    deleteInboxItem: async (c: Context<AuthzEnv>) => {
      const repoId = parseRepoIdParam(c.req.param("repoId"));
      if (repoId === undefined) {
        throw new NotFound();
      }
      const prNumber = prNumberSchema.safeParse(c.req.param("prNumber"));
      if (!prNumber.success) {
        throw new BadRequest();
      }
      const deleted = await inboxController.deleteInboxItem(
        { handle: deps.handle },
        {
          // Ownership derives from the CREDENTIAL, never a caller value:
          // only the viewer's own url rows are addressable.
          ownerUserId: c.get("session").reviewerId,
          repoId,
          prNumber: prNumber.data,
        },
      );
      if (!deleted.ok) {
        throw new NotFound();
      }
      stampAuditTarget(c, "pull_request", deleted.value.pullRequestId);
      return c.json({ ok: true }, 200, NO_STORE);
    },
  };
}
