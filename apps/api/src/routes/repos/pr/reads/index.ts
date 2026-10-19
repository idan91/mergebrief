// The reviewer read API, behind the pr subtree's shared gate: PR meta, the
// stored artifacts (brief / brief-context / marks / delta / narrative), and
// the LIVE reads (span diff, file range, stack) on the viewer's binding,
// cached per session and NEVER persisted.
import { ProductQueryIds, type PullMetaView } from "contract";
import type { Handler } from "hono";
import type { OpenPullRequest } from "brief-core/pr-stack";
import { DEFAULT_DRAFT_POLICY } from "generators/instance-policy";
import type { AppDatabase } from "persistence";
import { HttpStatuses } from "types/http";
import type { z } from "zod/v4";
import { bindOperatorReader } from "../../../../access/operator-token";
import {
  AccessFootings,
  type PullRequestAccess,
  type PullRequestEnv,
} from "../../../../access/types";
import {
  productRouter,
  type ProductRouter,
} from "../../../../product-operations/product-router";
import { NotFound } from "../../../../shared-errors/api-error";
import type { AuthRouteDeps } from "../../../auth/session/types";
import type { LiveFactsReader } from "../../../live-read/types";
import { createTtlCache, type TtlCache } from "../../../ttl-cache";
import {
  DIFF_CACHE_MAX_ENTRIES,
  FILE_BLOB_CACHE_MAX_ENTRIES,
  OPEN_PULLS_CACHE_MAX_ENTRIES,
} from "./consts";
import {
  resolveDiffError,
  resolveFileRangeError,
  resolveStackError,
} from "./logic/wire-failures";
import {
  readBrief,
  readBriefContext,
  readDelta,
  readMarks,
  readNarrative,
} from "./read-artifact";
import { readDiff } from "./read-diff";
import { readFileRange } from "./read-file-range";
import { readGenerationClaims } from "./read-generation-claims";
import { readPull } from "./read-pull";
import { readStack } from "./read-stack";
import {
  briefQuerySchema,
  deltaQuerySchema,
  diffQuerySchema,
  fileRangeQuerySchema,
  marksQuerySchema,
  narrativeQuerySchema,
} from "./schemas";
import type {
  ReadArtifactResult,
  ReadDiffDeps,
  ReadFileRangeDeps,
} from "./types";
import { parseQuery } from "./utils";

const NO_STORE = { "cache-control": "no-store" } as const;

const PLAIN_TEXT = {
  "content-type": "text/plain; charset=utf-8",
  "cache-control": "no-store",
} as const;

const FILE_RANGE_KEYS = ["ref", "path", "from", "to"] as const;

/** A stored body is ALREADY JSON: served verbatim, never re-serialized. */
const STORED_JSON = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
} as const;

type ArtifactOperation<Query> = (
  handle: AppDatabase,
  access: PullRequestAccess,
  query: Query,
) => Promise<ReadArtifactResult>;

function createArtifactHandler<Schema extends z.ZodType>(
  deps: AuthRouteDeps,
  schema: Schema,
  keys: readonly string[],
  operation: ArtifactOperation<z.infer<Schema>>,
): Handler<PullRequestEnv> {
  return async (c) => {
    const query = parseQuery(c, schema, keys);
    const access = c.get("pullRequestAccess");
    const read = await operation(deps.handle, access, query);
    if (!read.ok) {
      throw new NotFound();
    }

    return c.body(read.value, HttpStatuses.OK, STORED_JSON);
  };
}

/** The operator answers the live read only behind a pass on its token. */
function selectLiveReadOperator(
  deps: AuthRouteDeps,
  access: PullRequestAccess,
): LiveFactsReader | undefined {
  if (access.footing !== AccessFootings.OPERATOR) {
    return undefined;
  }
  return bindOperatorReader(deps, access.session.reviewerId);
}

function createReadPullHandler(deps: AuthRouteDeps): Handler<PullRequestEnv> {
  return async (c) => {
    const access = c.get("pullRequestAccess");
    const readDeps = {
      handle: deps.handle,
      draftPolicy: deps.draftPolicy ?? DEFAULT_DRAFT_POLICY,
      operator: selectLiveReadOperator(deps, access),
      log: c.get("logger"),
    };
    const meta: PullMetaView = await readPull(readDeps, access);

    return c.json(meta, HttpStatuses.OK, NO_STORE);
  };
}

function createReadGenerationClaimsHandler(
  handle: AppDatabase,
): Handler<PullRequestEnv> {
  return async (c) => {
    const claims = await readGenerationClaims(
      handle,
      c.get("pullRequestAccess"),
    );

    return c.json(claims, HttpStatuses.OK, NO_STORE);
  };
}

function createReadDiffHandler(deps: ReadDiffDeps): Handler<PullRequestEnv> {
  return async (c) => {
    const query = parseQuery(c, diffQuerySchema, ["base", "head"]);
    const read = await readDiff(deps, c.get("pullRequestAccess"), query);
    if (!read.ok) {
      throw resolveDiffError(read.error);
    }

    return c.body(read.value, HttpStatuses.OK, PLAIN_TEXT);
  };
}

function createReadFileRangeHandler(
  deps: ReadFileRangeDeps,
): Handler<PullRequestEnv> {
  return async (c) => {
    const query = parseQuery(c, fileRangeQuerySchema, FILE_RANGE_KEYS);
    const read = await readFileRange(deps, c.get("pullRequestAccess"), query);
    if (!read.ok) {
      throw resolveFileRangeError(read.error);
    }

    return c.json(read.value, HttpStatuses.OK, NO_STORE);
  };
}

function createReadStackHandler(
  deps: AuthRouteDeps,
  openPullsCache: TtlCache<readonly OpenPullRequest[]>,
): Handler<PullRequestEnv> {
  return async (c) => {
    const stackDeps = {
      handle: deps.handle,
      openPullsCache,
      log: c.get("logger"),
    };
    const read = await readStack(stackDeps, c.get("pullRequestAccess"));
    if (!read.ok) {
      throw resolveStackError(read.error);
    }

    return c.json(read.value, HttpStatuses.OK, NO_STORE);
  };
}

/**
 * The reads that go to GitHub live: the span diff, the file range and the
 * stack. Their caches are created here, once per `createApp`.
 */
function declareLiveReads(
  app: ProductRouter<PullRequestEnv>,
  deps: AuthRouteDeps,
): void {
  // key `${sessionHash}:${repoId}:${prNumber}:${base}:${head}` → cached diff.
  const diffCache = createTtlCache<string>(DIFF_CACHE_MAX_ENTRIES);
  // key `${sessionHash}:${repoId}:${ref}:${path}` → the SPLIT blob, so the
  // second edge of one file costs neither a GitHub call nor a re-split.
  const fileCache = createTtlCache<readonly string[]>(
    FILE_BLOB_CACHE_MAX_ENTRIES,
  );
  // key `${sessionHash}:${repoId}` → the repo's open PRs, one list per stack walk.
  const openPullsCache = createTtlCache<readonly OpenPullRequest[]>(
    OPEN_PULLS_CACHE_MAX_ENTRIES,
  );
  app.query(
    {
      id: ProductQueryIds.READ_DIFF,
      browserSessionOnly: false,
      requiresOperator: false,
      requiresPushAccess: false,
      requiresInstallation: false,
      requiresStoredPullRequest: true,
    },
    "/diff",
    createReadDiffHandler({ diffCache }),
  );
  app.query(
    {
      id: ProductQueryIds.READ_FILE_RANGE,
      browserSessionOnly: false,
      requiresOperator: false,
      requiresPushAccess: false,
      requiresInstallation: false,
      requiresStoredPullRequest: true,
    },
    "/file-range",
    createReadFileRangeHandler({ fileCache }),
  );
  app.query(
    {
      id: ProductQueryIds.READ_STACK,
      browserSessionOnly: false,
      requiresOperator: false,
      requiresPushAccess: false,
      requiresInstallation: false,
      requiresStoredPullRequest: true,
    },
    "/stack",
    createReadStackHandler(deps, openPullsCache),
  );
}

export function readsRoutes(
  deps: AuthRouteDeps,
): ProductRouter<PullRequestEnv> {
  const app = productRouter<PullRequestEnv>();
  app.query(
    {
      id: ProductQueryIds.READ_PULL,
      browserSessionOnly: false,
      requiresOperator: false,
      requiresPushAccess: false,
      requiresInstallation: false,
      requiresStoredPullRequest: true,
    },
    "/",
    createReadPullHandler(deps),
  );
  app.query(
    {
      id: ProductQueryIds.READ_GENERATION_CLAIMS,
      browserSessionOnly: false,
      requiresOperator: false,
      requiresPushAccess: false,
      requiresInstallation: false,
      requiresStoredPullRequest: true,
    },
    "/generation",
    createReadGenerationClaimsHandler(deps.handle),
  );
  app.query(
    {
      id: ProductQueryIds.READ_BRIEF,
      browserSessionOnly: false,
      requiresOperator: false,
      requiresPushAccess: false,
      requiresInstallation: false,
      requiresStoredPullRequest: true,
    },
    "/brief",
    createArtifactHandler(deps, briefQuerySchema, ["base", "head"], readBrief),
  );
  app.query(
    {
      id: ProductQueryIds.READ_MARKS,
      browserSessionOnly: false,
      requiresOperator: false,
      requiresPushAccess: false,
      requiresInstallation: false,
      requiresStoredPullRequest: true,
    },
    "/marks",
    createArtifactHandler(
      deps,
      marksQuerySchema,
      ["baseline", "head"],
      readMarks,
    ),
  );
  app.query(
    {
      id: ProductQueryIds.READ_DELTA,
      browserSessionOnly: false,
      requiresOperator: false,
      requiresPushAccess: false,
      requiresInstallation: false,
      requiresStoredPullRequest: true,
    },
    "/delta",
    createArtifactHandler(
      deps,
      deltaQuerySchema,
      ["baseline", "head"],
      readDelta,
    ),
  );
  app.query(
    {
      id: ProductQueryIds.READ_NARRATIVE,
      browserSessionOnly: false,
      requiresOperator: false,
      requiresPushAccess: false,
      requiresInstallation: false,
      requiresStoredPullRequest: true,
    },
    "/narrative",
    createArtifactHandler(
      deps,
      narrativeQuerySchema,
      ["prevHead", "head"],
      readNarrative,
    ),
  );
  app.query(
    {
      id: ProductQueryIds.READ_BRIEF_CONTEXT,
      browserSessionOnly: false,
      requiresOperator: false,
      requiresPushAccess: false,
      requiresInstallation: false,
      requiresStoredPullRequest: true,
    },
    "/brief-context",
    createArtifactHandler(
      deps,
      briefQuerySchema,
      ["base", "head"],
      readBriefContext,
    ),
  );
  declareLiveReads(app, deps);
  return app;
}
