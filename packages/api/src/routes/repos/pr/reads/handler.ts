import type { Context } from "hono";
import { GitHubApiErrorCode } from "github";
import {
  createArtifactStore,
  createGenerationProjection,
  createTenantRepository,
} from "persistence";
import type { AppDatabase } from "persistence";
import { DEFAULT_DRAFT_POLICY } from "../../../../draft-policy";
import { ApiErrorCode } from "../../../../error-response";
import {
  BadGateway,
  NotFound,
  PayloadTooLarge,
  Unauthorized,
} from "../../../../shared-errors/api-error";
import { createReviewerGitHubClient } from "../../../auth/reviewer-github-client";
import type { AuthRouteDeps } from "../../../auth/session";
import type { AuthzEnv } from "../../../authz";
import type { TtlCache } from "../../../ttl-cache";
import readsController from "./controller";
import {
  briefQuerySchema,
  deltaQuerySchema,
  diffQuerySchema,
  marksQuerySchema,
  narrativeQuerySchema,
} from "./schemas";
import type { ReadsControllerDeps } from "./types";
import { parseQuery, parsePrNumber, splitRepoSlug } from "./utils";

/**
 * Return a stored artifact `body` verbatim as JSON. The body is ALREADY a
 * JSON string (persistence passthrough) — do NOT re-parse/re-serialize it.
 * `no-store`: these are per-viewer, authz-gated responses.
 */
function artifactJson(c: Context<AuthzEnv>, body: string): Response {
  return c.body(body, 200, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
}

function buildDeps(
  c: Context<AuthzEnv>,
  handle: AppDatabase,
): ReadsControllerDeps {
  const ctx = c.get("ctx");
  return {
    tenant: createTenantRepository(handle, ctx),
    artifacts: createArtifactStore(handle, ctx),
  };
}

export default function createHandlers(
  deps: AuthRouteDeps,
  diffCache: TtlCache<string>,
) {
  const handle = deps.handle;
  const readBrief = async (c: Context<AuthzEnv>) => {
    const query = parseQuery(c, briefQuerySchema, ["base", "head"]);
    const prNumber = parsePrNumber(c);
    const body = await readsController.readBrief(buildDeps(c, handle), {
      repoId: c.get("repoId"),
      prNumber,
      base: query.base,
      head: query.head,
    });
    return artifactJson(c, body);
  };

  const readMarks = async (c: Context<AuthzEnv>) => {
    const query = parseQuery(c, marksQuerySchema, ["baseline", "head"]);
    const prNumber = parsePrNumber(c);
    const body = await readsController.readMarks(buildDeps(c, handle), {
      repoId: c.get("repoId"),
      prNumber,
      baseline: query.baseline,
      head: query.head,
    });
    return artifactJson(c, body);
  };

  const readDelta = async (c: Context<AuthzEnv>) => {
    const query = parseQuery(c, deltaQuerySchema, ["baseline", "head"]);
    const prNumber = parsePrNumber(c);
    const body = await readsController.readDelta(buildDeps(c, handle), {
      repoId: c.get("repoId"),
      prNumber,
      baseline: query.baseline,
      head: query.head,
    });
    return artifactJson(c, body);
  };

  const readNarrative = async (c: Context<AuthzEnv>) => {
    const query = parseQuery(c, narrativeQuerySchema, ["prevHead", "head"]);
    const prNumber = parsePrNumber(c);
    const body = await readsController.readNarrative(buildDeps(c, handle), {
      repoId: c.get("repoId"),
      prNumber,
      prevHead: query.prevHead,
      head: query.head,
    });
    return artifactJson(c, body);
  };

  const readBriefContext = async (c: Context<AuthzEnv>) => {
    const query = parseQuery(c, briefQuerySchema, ["base", "head"]);
    const prNumber = parsePrNumber(c);
    const body = await readsController.readBriefContext(buildDeps(c, handle), {
      repoId: c.get("repoId"),
      prNumber,
      base: query.base,
      head: query.head,
    });
    return artifactJson(c, body);
  };

  const readPull = async (c: Context<AuthzEnv>) => {
    const prNumber = parsePrNumber(c);
    const ctx = c.get("ctx");
    const body = await readsController.readPullMeta(
      {
        ...buildDeps(c, deps.handle),
        generations: createGenerationProjection(deps.handle, ctx),
      },
      {
        repoId: c.get("repoId"),
        prNumber,
        repoFullName: c.get("repoFullName"),
        reviewerLogin: c.get("session").reviewerLogin,
        reviewerId: c.get("session").reviewerId,
        viewerCanPush: c.get("viewerCanPush"),
        draftPolicy: deps.draftPolicy ?? DEFAULT_DRAFT_POLICY,
      },
    );
    return c.json(body, 200, { "cache-control": "no-store" });
  };

  const readDiff = async (c: Context<AuthzEnv>) => {
    const query = parseQuery(c, diffQuerySchema, ["base", "head"]);
    const prNumber = parsePrNumber(c);
    // Fetch by the AUTHZ-VERIFIED full name (set by the gate from its GitHub
    // access check / positive cache), never the row's stored repo_slug — a
    // rename + name-reuse could point the stored slug at a different repo
    // than the numeric id the gate authorized.
    const target = splitRepoSlug(c.get("repoFullName"));
    if (target === undefined) {
      throw new NotFound(ApiErrorCode.NOT_FOUND);
    }
    const session = c.get("session");
    const result = await readsController.readDiff(
      {
        ...buildDeps(c, deps.handle),
        github: createReviewerGitHubClient(deps, session, c.get("logger")),
        diffCache,
      },
      {
        repoId: c.get("repoId"),
        prNumber,
        owner: target.owner,
        repo: target.repo,
        base: query.base,
        head: query.head,
        sessionTokenHash: session.sessionTokenHash,
      },
    );
    if (!result.ok) {
      if (result.error.kind === "token-unreadable") {
        throw new Unauthorized(ApiErrorCode.UNAUTHORIZED);
      }
      const denied = result.error;
      // 406 = GitHub refuses to render the diff (too large: >300 files/20k
      // lines) — a PERMANENT condition for this span, so surface it as 413
      // rather than a retryable-looking 502.
      if (denied.error.status === 406) {
        throw new PayloadTooLarge(ApiErrorCode.DIFF_TOO_LARGE);
      }
      // A 401 with the refresh spent and no retry is the refresh-failed
      // re-login prompt; a retried-still-401 is an upstream error like any
      // other non-404.
      if (
        denied.error.code === GitHubApiErrorCode.UNAUTHORIZED &&
        !denied.retried
      ) {
        throw new Unauthorized(ApiErrorCode.UNAUTHORIZED);
      }
      if (denied.error.code === GitHubApiErrorCode.NOT_FOUND) {
        throw new NotFound(ApiErrorCode.NOT_FOUND);
      }
      throw new BadGateway(ApiErrorCode.GITHUB_UNAVAILABLE);
    }
    return c.body(result.body, 200, {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    });
  };

  return {
    readPull,
    readBrief,
    readBriefContext,
    readMarks,
    readDelta,
    readNarrative,
    readDiff,
  };
}
