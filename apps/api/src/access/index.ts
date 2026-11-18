/* oxlint-disable house/comment-run -- the gate's contract: what it decides,
   what is cached and never cached, and what the access line carries. */
// The repo gate, the SINGLE enforcement point for `/api/repos/:repoId/*`:
// `sessionLayer` then `repoAuthzLayer`. The repo layer brands `:repoId` and
// verifies the reviewer's read access by NUMERIC id (`GET /repositories/{id}`
// on their own token, rename-proof). A 403/404 collapses to 404 and names the
// denial for the audit choke point; a 401 is 401 and an outage or rate limit
// is 502. On success it resolves the installation holding the repo among
// those the reviewer reaches (else the owner world) and shapes the context.
//
// CACHING: a POSITIVE cache keyed (credential, repo) with a 60s TTL skips the
// GitHub round-trip. NEGATIVES ARE NEVER CACHED: a revoked grant re-denies on
// the very next request. The cache is created once per `repoAuthzLayer`, so
// one per app. The operator-PAT rung caches a restricted entry pinned to its
// own PR, so a reader stays on that footing for the TTL.
//
// REFRESH: the gate binds the request's one credential and hands it on as
// `repoAccess`, so the repo read, the installation walk and the route share
// one renewal. A refresh GitHub refused retired the grant and is a 401; one
// GitHub did not answer is a 502, and one the session key failed is a 500.
//
// LOGGING: the gate only STAMPS its decision via `stampAccess`, numeric ids
// only; `requestLogging` emits the line after the handler. On the allowed
// path the stamp lands after `next()`, so the line's status is the handler's.
/* oxlint-enable house/comment-run */
import { ApiErrorCodes, ApiErrorStatusByCode } from "contract";
import type { Context, MiddlewareHandler, Next } from "hono";
import { every } from "hono/combine";
import { routePath } from "hono/route";
import { CredentialFailureCodes } from "github";
import { traceStep } from "logging";
import type { RepoId } from "persistence";
import { HttpStatuses } from "types/http";
import {
  AUDIT_REASON_NO_REPO_ACCESS,
  stampAuditReason,
  stampAuditScope,
  stampAuditTarget,
} from "../product-operations/audit";
import { stampAccess } from "../request-logging";
import type { AuthRouteDeps } from "../routes/auth/session/types";
import type {
  InstallationResolver,
  ResolvedRepoWorld,
} from "../routes/installation-resolver";
import { createTtlCache } from "../routes/ttl-cache";
import {
  parsePrNumberParam,
  parseRepoIdParam,
  type PrNumberParamResult,
} from "../routes/wire-bounds";
import { BadGateway, NotFound, Unauthorized } from "../shared-errors/api-error";
import { resolveGitHubDenialError } from "../shared-errors/github-denial";
import { isServerFault } from "../shared-errors/on-error";
import { DenialPostures } from "../shared-errors/github-denial/types";
import {
  AUTHZ_CACHE_TTL_MS,
  POSITIVE_CACHE_MAX_ENTRIES,
  PULLS_SEGMENT,
  REPO_ID_PARAM,
} from "./consts";
import { resolveOperatorRepoAccess } from "./operator-token";
import { bindRequestGitHub, type RequestGitHub } from "./reviewer-binding";
import { sessionLayer } from "./session-layer";
import { deriveScopeContext } from "./utils";
import {
  AccessFootings,
  type AuthzEnv,
  type CachedOperatorRepoAccess,
  type CachedRepoAccess,
  type CachedReviewerRepoAccess,
  type OperatorRungRequest,
  type RepoAccess,
} from "./types";

/**
 * Keyed by credential and repo. The entry carries the world the repo was
 * resolved into, so a pass replays under the installation it was proven
 * for and never under another.
 */
function buildPositiveCacheKey(
  sessionTokenHash: string,
  repoId: RepoId,
): string {
  return `${sessionTokenHash}:${String(repoId)}`;
}

/**
 * The `:prNumber` segment under `:repoId/pulls/`, read off the path: the gate
 * mounts above the per-PR subtree, so Hono binds no such param for it.
 */
function readPullNumberSegment(c: Context<AuthzEnv>): string | undefined {
  const repoIdIndex = routePath(c).split("/").indexOf(REPO_ID_PARAM);
  const segments = c.req.path.split("/");
  if (repoIdIndex === -1 || segments[repoIdIndex + 1] !== PULLS_SEGMENT) {
    return undefined;
  }
  return segments[repoIdIndex + 2];
}

/** An operator-footed entry serves only the PR it was granted for. */
function isServedFromCache(
  cached: CachedRepoAccess,
  requestedPr: PrNumberParamResult,
): boolean {
  if (cached.footing === AccessFootings.REVIEWER) {
    return true;
  }
  return requestedPr.ok && cached.prNumber === requestedPr.value;
}

/** A proven grant, the request's GitHub, and the access line. */
interface ServedRepoAccess {
  readonly grant: CachedRepoAccess;
  readonly bound: RequestGitHub;
  readonly decision: string;
}

async function serveRepoAccess(
  c: Context<AuthzEnv>,
  next: Next,
  { grant, bound, decision }: ServedRepoAccess,
): Promise<void> {
  const session = bound.credential.session();
  const access: RepoAccess = { ...grant, session, ...bound };
  const reviewerId = session.reviewerId;
  const repoScope = deriveScopeContext(access.installation, reviewerId);
  c.set("repoAccess", access);
  c.set("session", access.session);
  stampAuditScope(c, repoScope);
  await next();
  stampAccess(c, decision, { repoId: access.repoId, reviewerId });
}

/**
 * The reviewer's own token was refused: the operator rung's access, or a
 * throw. A 401 is re-login and an outage is 502, neither cached nor taken to
 * the rung; only a 403/404 reads as absence, and with no rung it is the
 * uniform 404, never cached. The ledger names the real reason, though a read
 * is never audited and the gate cannot tell the two apart.
 */
async function resolveRefusedRepoAccess(
  deps: AuthRouteDeps,
  c: Context<AuthzEnv>,
  bound: RequestGitHub,
  refused: OperatorRungRequest,
): Promise<CachedOperatorRepoAccess> {
  const { repoId, error } = refused;
  const stampFields = {
    repoId,
    reviewerId: bound.credential.session().reviewerId,
  };
  if (error.code === CredentialFailureCodes.CREDENTIAL_UNREADABLE) {
    stampAccess(c, "401", stampFields);
    throw new Unauthorized();
  }

  const denial = resolveGitHubDenialError(error, DenialPostures.COLLAPSE);
  if (!(denial instanceof NotFound)) {
    stampAuditTarget(c, "repo", repoId);
    stampAccess(c, String(ApiErrorStatusByCode[denial.code]), stampFields);
    throw denial;
  }

  // The url-box door generates behind the operator PAT, so without the rung
  // a reader holds briefs they cannot open.
  const operatorAccess = await resolveOperatorRepoAccess(
    deps,
    stampFields.reviewerId,
    refused,
  );
  if (operatorAccess !== undefined) {
    return operatorAccess;
  }
  stampAuditReason(c, AUDIT_REASON_NO_REPO_ACCESS);
  stampAuditTarget(c, "repo", repoId);
  stampAccess(c, "404", stampFields);
  throw denial;
}

/** Which installation holds a readable repo; a failure is never cached. */
async function resolveRepoInstallation(
  installations: InstallationResolver,
  c: Context<AuthzEnv>,
  bound: RequestGitHub,
  repoId: RepoId,
): Promise<ResolvedRepoWorld> {
  const resolved = await installations.resolveInstallationForRepo(
    bound,
    repoId,
    c.get("logger"),
  );
  if (resolved.ok) {
    return resolved.value;
  }
  const { status } = resolved.error;
  stampAccess(c, String(status), {
    repoId,
    reviewerId: bound.credential.session().reviewerId,
  });
  if (status === HttpStatuses.UNAUTHORIZED) {
    throw new Unauthorized();
  }
  throw new BadGateway(ApiErrorCodes.GITHUB_UNAVAILABLE);
}

interface RepoGateContext {
  readonly deps: AuthRouteDeps;
  readonly installations: InstallationResolver;
  readonly context: Context<AuthzEnv>;
  readonly bound: RequestGitHub;
}

interface ProvenRepoAccess {
  readonly access: CachedRepoAccess;
  readonly decision: "200" | "200-url-box";
  readonly expiresAt: number;
}

async function proveRepoAccess(
  { deps, installations, context, bound }: RepoGateContext,
  { repoId, requestedPr }: Omit<OperatorRungRequest, "error">,
): Promise<ProvenRepoAccess> {
  const repo = await bound.github.fetchRepositoryById(repoId);
  if (!repo.ok) {
    const refused = { repoId, requestedPr, error: repo.error };
    const access = await resolveRefusedRepoAccess(
      deps,
      context,
      bound,
      refused,
    );
    const expiresAt = Date.now() + AUTHZ_CACHE_TTL_MS;
    return { access, decision: "200-url-box", expiresAt };
  }

  const resolved = await traceStep(
    "authz.installation",
    {},
    () => resolveRepoInstallation(installations, context, bound, repoId),
    { isFailure: isServerFault },
  );
  const access: CachedReviewerRepoAccess = {
    footing: AccessFootings.REVIEWER,
    repoId,
    repoFullName: repo.value.fullName,
    viewerCanPush: repo.value.viewerCanPush,
    installation: resolved.world,
  };
  // Capped to the world's own expiry, so the three caches never stack.
  const ttlExpiry = Date.now() + AUTHZ_CACHE_TTL_MS;
  const expiresAt = Math.min(ttlExpiry, resolved.expiresAt);
  return { access, decision: "200", expiresAt };
}

/**
 * Verify the resolved session's GitHub access to `:repoId` and set the
 * `RepoAccess`. Requires `sessionLayer` to have run.
 */
export function repoAuthzLayer(
  deps: AuthRouteDeps,
  installations: InstallationResolver,
): MiddlewareHandler<AuthzEnv> {
  const positiveCache = createTtlCache<CachedRepoAccess>(
    POSITIVE_CACHE_MAX_ENTRIES,
  );

  return async (c, next) => {
    const session = c.get("session");
    // An ill-shaped id is a 404 (never 400, no shape leak either).
    const repoId = parseRepoIdParam(c.req.param("repoId"));
    if (repoId === undefined) {
      stampAccess(c, "404", { reviewerId: session.reviewerId });
      throw new NotFound();
    }
    const requestedPr = parsePrNumberParam(readPullNumberSegment(c));

    const cacheKey = buildPositiveCacheKey(session.sessionTokenHash, repoId);
    const bound = bindRequestGitHub(deps, session, c.get("logger"));
    const proven = await traceStep(
      "authz.repo",
      {},
      async (span) => {
        const cached = positiveCache.get(cacheKey);
        const cacheHit =
          cached !== undefined && isServedFromCache(cached, requestedPr);
        span.setAttributes({ "mergebrief.cache_hit": cacheHit });
        if (cacheHit) {
          return { grant: cached, decision: "200" };
        }
        const proof = await proveRepoAccess(
          { deps, installations, context: c, bound },
          { repoId, requestedPr },
        );
        positiveCache.set(cacheKey, proof.access, proof.expiresAt);
        return { grant: proof.access, decision: proof.decision };
      },
      { isFailure: isServerFault },
    );
    await serveRepoAccess(c, next, { ...proven, bound });
  };
}

/**
 * The repo gate: `sessionLayer` ∘ `repoAuthzLayer`, built once per app
 * instance so the positive cache is app-scoped.
 */
export function createAuthzMiddleware(
  deps: AuthRouteDeps,
  installations: InstallationResolver,
): MiddlewareHandler<AuthzEnv> {
  return every(sessionLayer(deps), repoAuthzLayer(deps, installations));
}
