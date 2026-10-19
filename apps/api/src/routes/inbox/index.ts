// The Inbox: `GET /api/inbox`, the one list across every installation the
// viewer reaches plus their own url rows, and the owner-only purge of one
// pasted row. Session-gated only: the reachable installations and the
// readable repositories come from the SHARED resolvers, and a GitHub
// failure fails the list (401/502), never a DB-only listing that would leak
// rows the viewer can no longer see. The purge makes no GitHub call at all,
// so a pasted row whose repository nobody can read any more still goes.
import { InboxQueryKeys, ProductActionIds, ProductQueryIds } from "contract";
import type { Context, Handler } from "hono";
import { HttpStatuses } from "types/http";
import { bindOperatorReader } from "../../access/operator-token";
import { bindRequestGitHub } from "../../access/reviewer-binding";
import { accessStampLayer, sessionLayer } from "../../access/session-layer";
import type { AuthzEnv } from "../../access/types";
import { stampAuditTarget } from "../../product-operations/audit";
import {
  productRouter,
  type ProductRouter,
} from "../../product-operations/product-router";
import { BadRequest, NotFound } from "../../shared-errors/api-error";
import type { AuthRouteDeps } from "../auth/session/types";
import { parseRepoIdParam, prNumberSchema } from "../wire-bounds";
import { deleteOwnPull } from "./delete-own-pull";
import { listInbox } from "./list-inbox";
import { throwListInboxFailure } from "./logic/wire-failures";
import { inboxQuerySchema, type InboxQuery } from "./schemas";
import type { InboxShared } from "./types";

const NO_STORE = { "cache-control": "no-store" } as const;

function parseInboxQuery(c: Context<AuthzEnv>): InboxQuery {
  const query = inboxQuerySchema.safeParse({
    [InboxQueryKeys.PAGE]: c.req.query(InboxQueryKeys.PAGE),
    [InboxQueryKeys.SORT]: c.req.query(InboxQueryKeys.SORT),
    [InboxQueryKeys.LAYOUT]: c.req.query(InboxQueryKeys.LAYOUT),
    [InboxQueryKeys.STATE]: c.req.queries(InboxQueryKeys.STATE),
    [InboxQueryKeys.REPO]: c.req.queries(InboxQueryKeys.REPO),
    [InboxQueryKeys.REVIEW]: c.req.queries(InboxQueryKeys.REVIEW),
    [InboxQueryKeys.AUTHOR]: c.req.query(InboxQueryKeys.AUTHOR),
    [InboxQueryKeys.INSTALLATION]: c.req.queries(InboxQueryKeys.INSTALLATION),
    [InboxQueryKeys.ARCHIVED]: c.req.query(InboxQueryKeys.ARCHIVED),
  });
  if (!query.success) {
    throw new BadRequest();
  }
  return query.data;
}

function createListInboxHandler(
  deps: AuthRouteDeps,
  shared: InboxShared,
): Handler<AuthzEnv> {
  return async (c) => {
    const query = parseInboxQuery(c);
    const log = c.get("logger");
    const session = c.get("session");
    const request = bindRequestGitHub(deps, session, log);
    const listDeps = {
      ...shared,
      handle: deps.handle,
      operator: bindOperatorReader(deps, session.reviewerId),
      githubAppSlug: deps.githubAppSlug,
      log,
    };
    const listed = await listInbox(listDeps, request, query);
    if (!listed.ok) {
      throwListInboxFailure(listed.error);
    }

    return c.json(listed.value, HttpStatuses.OK, NO_STORE);
  };
}

function createDeleteOwnPullHandler(deps: AuthRouteDeps): Handler<AuthzEnv> {
  return async (c) => {
    const repoId = parseRepoIdParam(c.req.param("repoId"));
    if (repoId === undefined) {
      throw new NotFound();
    }
    const prNumber = prNumberSchema.safeParse(c.req.param("prNumber"));
    if (!prNumber.success) {
      throw new BadRequest();
    }

    const ownerUserId = c.get("session").reviewerId;
    const coordinates = { repoId, prNumber: prNumber.data };
    const deleted = await deleteOwnPull(deps.handle, ownerUserId, coordinates);
    if (!deleted.ok) {
      throw new NotFound();
    }

    stampAuditTarget(c, "pull_request", deleted.value);
    return c.body(null, HttpStatuses.NO_CONTENT, NO_STORE);
  };
}

export function inboxRoutes(
  deps: AuthRouteDeps,
  shared: InboxShared,
): ProductRouter<AuthzEnv> {
  const app = productRouter<AuthzEnv>();
  app.use("*", sessionLayer(deps), accessStampLayer());
  app.query(
    {
      id: ProductQueryIds.LIST_INBOX,
      browserSessionOnly: false,
      requiresOperator: false,
      requiresPushAccess: false,
      requiresInstallation: false,
      requiresStoredPullRequest: false,
    },
    "/",
    createListInboxHandler(deps, shared),
  );
  app.action(
    {
      id: ProductActionIds.DELETE_OWN_PULL,
      browserSessionOnly: true,
      requiresOperator: false,
      requiresPushAccess: false,
      requiresInstallation: false,
      requiresStoredPullRequest: false,
    },
    "/:repoId/:prNumber",
    createDeleteOwnPullHandler(deps),
  );
  return app;
}
