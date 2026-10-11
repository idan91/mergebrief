// The per-PR access step, after the repo gate. A malformed `:prNumber` is
// the gate's uniform 404. The row itself loads only when the router asks,
// after the descriptor checks, so a refusal there never costs a query.
//
// Which scope the row lives in: the repo's Installation first, then the URL
// fallback, which is INSTANCE-wide (own row first, else the oldest), so a
// reader who proved GitHub access may open a brief another reviewer pasted;
// the Review Session's natural key keeps per-reviewer state apart. A pass on
// the operator PAT reads only the reader's own URL rows.
import type { Context, MiddlewareHandler } from "hono";
import {
  createTenantRepository,
  isOwnerContext,
  resolveUrlBoxOwner,
  type AppDatabase,
  type PullRequestRow,
  type RepoId,
  type ReviewerId,
  type ScopeContext,
} from "persistence";
import { stampAuditScope } from "../product-operations/audit";
import type { AuthRouteDeps } from "../routes/auth/session/types";
import { parsePrNumberParam } from "../routes/wire-bounds";
import { NotFound } from "../shared-errors/api-error";
import { bindPullRequestGitHub } from "./reviewer-binding";
import { AccessFootings, type PullRequestEnv, type RepoAccess } from "./types";
import { deriveScopeContext } from "./utils";

export interface PullRequestRowRequest {
  /** The scope the repo gate resolved; an owner scope skips the Installation probe. */
  readonly repoScope: ScopeContext;
  readonly reviewerId: ReviewerId;
  readonly repoId: RepoId;
  readonly prNumber: number;
}

export interface ResolvedPullRequestRow {
  readonly rowScope: ScopeContext;
  readonly row: PullRequestRow;
}

async function loadRowIn(
  handle: AppDatabase,
  rowScope: ScopeContext,
  request: PullRequestRowRequest,
): Promise<ResolvedPullRequestRow | undefined> {
  const row = await createTenantRepository(
    handle,
    rowScope,
  ).pullRequests.getByNumber(request.repoId, request.prNumber);
  return row === undefined ? undefined : { rowScope, row };
}

/** The row a request names and the scope it lives in; `undefined` is absence. */
export async function resolvePullRequestRow(
  handle: AppDatabase,
  request: PullRequestRowRequest,
): Promise<ResolvedPullRequestRow | undefined> {
  if (!isOwnerContext(request.repoScope)) {
    const installed = await loadRowIn(handle, request.repoScope, request);
    if (installed !== undefined) {
      return installed;
    }
  }
  const ownerUserId = await resolveUrlBoxOwner(
    handle,
    request.repoId,
    request.prNumber,
    request.reviewerId,
  );
  if (ownerUserId === undefined) {
    return undefined;
  }
  return loadRowIn(handle, { ownerUserId }, request);
}

function resolveAccessRow(
  handle: AppDatabase,
  access: RepoAccess,
  prNumber: number,
): Promise<ResolvedPullRequestRow | undefined> {
  const reviewerId = access.session.reviewerId;
  const request = {
    repoScope: deriveScopeContext(access.installation, reviewerId),
    reviewerId,
    repoId: access.repoId,
    prNumber,
  };
  if (access.footing === AccessFootings.OPERATOR) {
    return loadRowIn(handle, { ownerUserId: reviewerId }, request);
  }
  return resolvePullRequestRow(handle, request);
}

async function loadPullRequestAccess(
  c: Context<PullRequestEnv>,
  deps: AuthRouteDeps,
  prNumber: number,
): Promise<void> {
  const access = c.get("repoAccess");
  const resolved = await resolveAccessRow(deps.handle, access, prNumber);
  if (resolved === undefined) {
    throw new NotFound();
  }
  const log = c.get("logger");
  const github = bindPullRequestGitHub(deps, access, resolved, log);
  c.set("pullRequestAccess", { ...access, prNumber, ...resolved, github });
  stampAuditScope(c, resolved.rowScope);
}

/** Mount once over the per-PR subtree, behind the repo gate. */
export function createPullRequestAccessLayer(
  deps: AuthRouteDeps,
): MiddlewareHandler<PullRequestEnv> {
  return async (c, next) => {
    const prNumber = parsePrNumberParam(c.req.param("prNumber"));
    if (!prNumber.ok) {
      throw new NotFound();
    }
    c.set("loadOperationRow", () =>
      loadPullRequestAccess(c, deps, prNumber.value),
    );
    await next();
  };
}
