import type { Context } from "hono";
import { createArtifactStore, createTenantRepository } from "persistence";
import type { AppDatabase } from "persistence";
import { NotFound } from "../../../../shared-errors/api-error";
import { createReviewerGitHubClient } from "../../../auth/reviewer-github-client";
import type { AuthRouteDeps } from "../../../auth/session/types";
import { readFallbackTokenFor } from "../../../../access/operator-token";
import type { AuthzEnv } from "../../../../access/types";
import type { OpenPullRequest } from "brief-core/pr-stack";
import type { TtlCache } from "../../../ttl-cache";
import { readsController } from "./controller";
import { diffQuerySchema, fileRangeQuerySchema } from "./schemas";
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
    readDiff,
    readFileRange,
    readStack,
  };
}
