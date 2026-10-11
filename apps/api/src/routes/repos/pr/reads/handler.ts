import type { Context } from "hono";
import {
  createArtifactStore,
  createGenerationProjection,
  createTenantRepository,
  isOwnerContext,
} from "persistence";
import type { AppDatabase } from "persistence";
import { DEFAULT_DRAFT_POLICY } from "generators/instance-policy";
import { NotFound } from "../../../../shared-errors/api-error";
import { createReviewerGitHubClient } from "../../../auth/reviewer-github-client";
import type { AuthRouteDeps } from "../../../auth/session/types";
import { readFallbackTokenFor } from "../../../../access/operator-token";
import type { AuthzEnv } from "../../../../access/types";
import { refreshUrlPullRequest } from "../../../live-read";
import type { OpenPullRequest } from "brief-core/pr-stack";
import type { TtlCache } from "../../../ttl-cache";
import { readsController } from "./controller";
import {
  briefQuerySchema,
  deltaQuerySchema,
  diffQuerySchema,
  fileRangeQuerySchema,
  marksQuerySchema,
  narrativeQuerySchema,
} from "./schemas";
import {
  resolveDiffError,
  resolveFileRangeError,
  resolveStackError,
} from "./logic/wire-failures";
import type { ReadsControllerDeps } from "./types";
import { parseOwnerAndName } from "../../utils";
import { resolvePrScopeFrom } from "../scope";
import { parseQuery, parsePrNumber } from "./utils";
import { HttpStatuses } from "types/http";

/**
 * Return a stored artifact `body` verbatim as JSON. The body is ALREADY a
 * JSON string (persistence passthrough), do NOT re-parse/re-serialize it.
 * `no-store`: these are per-viewer, authz-gated responses.
 */
function artifactJson(c: Context<AuthzEnv>, body: string): Response {
  return c.body(body, HttpStatuses.OK, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
}

async function buildDeps(
  c: Context<AuthzEnv>,
  handle: AppDatabase,
  prNumber: number,
): Promise<ReadsControllerDeps> {
  // Per-row world resolution: an installation-bound viewer still reads the
  // url-box briefs they own (see ../scope.ts).
  const ctx = await resolvePrScopeFrom(c, handle, prNumber);
  return {
    tenant: createTenantRepository(handle, ctx),
    artifacts: createArtifactStore(handle, ctx),
  };
}

export function createReadsHandlers(
  deps: AuthRouteDeps,
  diffCache: TtlCache<string>,
  fileCache: TtlCache<readonly string[]>,
  openPullsCache: TtlCache<readonly OpenPullRequest[]>,
) {
  const handle = deps.handle;
  const readBrief = async (c: Context<AuthzEnv>) => {
    const query = parseQuery(c, briefQuerySchema, ["base", "head"]);
    const prNumber = parsePrNumber(c);
    const body = await readsController.readBrief(
      await buildDeps(c, handle, prNumber),
      {
        repoId: c.get("repoId"),
        prNumber,
        base: query.base,
        head: query.head,
      },
    );
    return artifactJson(c, body);
  };

  const readMarks = async (c: Context<AuthzEnv>) => {
    const query = parseQuery(c, marksQuerySchema, ["baseline", "head"]);
    const prNumber = parsePrNumber(c);
    const body = await readsController.readMarks(
      await buildDeps(c, handle, prNumber),
      {
        repoId: c.get("repoId"),
        prNumber,
        baseline: query.baseline,
        head: query.head,
      },
    );
    return artifactJson(c, body);
  };

  const readDelta = async (c: Context<AuthzEnv>) => {
    const query = parseQuery(c, deltaQuerySchema, ["baseline", "head"]);
    const prNumber = parsePrNumber(c);
    const body = await readsController.readDelta(
      await buildDeps(c, handle, prNumber),
      {
        repoId: c.get("repoId"),
        prNumber,
        baseline: query.baseline,
        head: query.head,
      },
    );
    return artifactJson(c, body);
  };

  const readNarrative = async (c: Context<AuthzEnv>) => {
    const query = parseQuery(c, narrativeQuerySchema, ["prevHead", "head"]);
    const prNumber = parsePrNumber(c);
    const body = await readsController.readNarrative(
      await buildDeps(c, handle, prNumber),
      {
        repoId: c.get("repoId"),
        prNumber,
        prevHead: query.prevHead,
        head: query.head,
      },
    );
    return artifactJson(c, body);
  };

  const readBriefContext = async (c: Context<AuthzEnv>) => {
    const query = parseQuery(c, briefQuerySchema, ["base", "head"]);
    const prNumber = parsePrNumber(c);
    const body = await readsController.readBriefContext(
      await buildDeps(c, handle, prNumber),
      {
        repoId: c.get("repoId"),
        prNumber,
        base: query.base,
        head: query.head,
      },
    );
    return artifactJson(c, body);
  };

  const readPull = async (c: Context<AuthzEnv>) => {
    const prNumber = parsePrNumber(c);
    const ctx = await resolvePrScopeFrom(c, deps.handle, prNumber);
    // A url row is read live before it is served, under the same window as
    // the Inbox, so a reader arriving from a bookmark sees the same facts.
    if (isOwnerContext(ctx)) {
      await refreshUrlPullRequest(
        {
          handle: deps.handle,
          github: createReviewerGitHubClient(
            deps,
            c.get("session"),
            c.get("logger"),
          ),
          fallbackToken: readFallbackTokenFor(c, deps),
          log: c.get("logger"),
        },
        ctx.ownerUserId,
        c.get("repoId"),
        prNumber,
        c.get("repoFullName"),
      );
    }
    const body = await readsController.readPullMeta(
      {
        tenant: createTenantRepository(deps.handle, ctx),
        artifacts: createArtifactStore(deps.handle, ctx),
        generations: createGenerationProjection(deps.handle, ctx),
      },
      {
        repoId: c.get("repoId"),
        prNumber,
        repoFullName: c.get("repoFullName"),
        reviewerLogin: c.get("session").reviewerLogin,
        reviewerId: c.get("session").reviewerId,
        viewerCanPush: c.get("viewerCanPush"),
        appInstalled: !isOwnerContext(ctx),
        draftPolicy: deps.draftPolicy ?? DEFAULT_DRAFT_POLICY,
      },
    );
    return c.json(body, HttpStatuses.OK, { "cache-control": "no-store" });
  };

  const readDiff = async (c: Context<AuthzEnv>) => {
    const query = parseQuery(c, diffQuerySchema, ["base", "head"]);
    const prNumber = parsePrNumber(c);
    // Fetch by the AUTHZ-VERIFIED full name (set by the gate from its GitHub
    // access check / positive cache), never the row's stored repo_slug, a
    // rename + name-reuse could point the stored slug at a different repo
    // than the numeric id the gate authorized.
    const target = parseOwnerAndName(c.get("repoFullName"));
    if (target === undefined) {
      throw new NotFound();
    }
    const session = c.get("session");
    const result = await readsController.readDiff(
      {
        ...(await buildDeps(c, deps.handle, prNumber)),
        github: createReviewerGitHubClient(
          deps,
          session,
          c.get("logger"),
          readFallbackTokenFor(c, deps),
        ),
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
        urlBoxOnly: c.get("urlBoxOnly") === true,
      },
    );
    if (!result.ok) {
      throw resolveDiffError(result.error);
    }
    return c.body(result.body, HttpStatuses.OK, {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    });
  };

  const readStack = async (c: Context<AuthzEnv>) => {
    const prNumber = parsePrNumber(c);
    // The authz-verified full name, as the diff proxy reads it.
    const target = parseOwnerAndName(c.get("repoFullName"));
    if (target === undefined) {
      throw new NotFound();
    }
    const session = c.get("session");
    const result = await readsController.readStack(
      {
        ...(await buildDeps(c, deps.handle, prNumber)),
        github: createReviewerGitHubClient(deps, session, c.get("logger")),
        openPullsCache,
        log: c.get("logger"),
      },
      {
        repoId: c.get("repoId"),
        prNumber,
        owner: target.owner,
        repo: target.repo,
        sessionTokenHash: session.sessionTokenHash,
        urlBoxOnly: c.get("urlBoxOnly") === true,
      },
    );
    if (!result.ok) {
      throw resolveStackError(result.error);
    }
    return c.json(result.value, HttpStatuses.OK, {
      "cache-control": "no-store",
    });
  };

  const readFileRange = async (c: Context<AuthzEnv>) => {
    const query = parseQuery(c, fileRangeQuerySchema, [
      "ref",
      "path",
      "from",
      "to",
    ]);
    const prNumber = parsePrNumber(c);
    // The AUTHZ-VERIFIED full name, never the row's stored slug: see readDiff.
    const target = parseOwnerAndName(c.get("repoFullName"));
    if (target === undefined) {
      throw new NotFound();
    }

    const session = c.get("session");
    const result = await readsController.readFileRange(
      {
        ...(await buildDeps(c, deps.handle, prNumber)),
        github: createReviewerGitHubClient(
          deps,
          session,
          c.get("logger"),
          readFallbackTokenFor(c, deps),
        ),
        fileCache,
      },
      {
        repoId: c.get("repoId"),
        prNumber,
        owner: target.owner,
        repo: target.repo,
        ref: query.ref,
        path: query.path,
        from: query.from,
        to: query.to,
        sessionTokenHash: session.sessionTokenHash,
        urlBoxOnly: c.get("urlBoxOnly") === true,
      },
    );

    if (!result.ok) {
      throw resolveFileRangeError(result.error);
    }
    return c.json(result.value, HttpStatuses.OK, {
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
    readFileRange,
    readStack,
  };
}
