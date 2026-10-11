// The reviewer read API, behind the pr subtree's shared gate: PR meta, the
// stored artifacts (brief / brief-context / marks / delta / narrative), and
// the LIVE diff proxy (viewer token, per-session ~60s cache, NEVER
// persisted). The diff cache is created here, once per `createApp`, so it is
// scoped to the app instance.
import { ProductQueryIds } from "contract";
import type { Handler } from "hono";
import type { OpenPullRequest } from "brief-core/pr-stack";
import { DEFAULT_DRAFT_POLICY } from "generators/instance-policy";
import { WriteClassifications, type AppDatabase } from "persistence";
import { HttpStatuses } from "types/http";
import type { z } from "zod/v4";
import { bindOperatorReader } from "../../../../access/operator-token";
import {
  AccessFootings,
  type AuthzEnv,
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
import { createTtlCache } from "../../../ttl-cache";
import {
  DIFF_CACHE_MAX_ENTRIES,
  FILE_BLOB_CACHE_MAX_ENTRIES,
  OPEN_PULLS_CACHE_MAX_ENTRIES,
} from "./consts";
import { createReadsHandlers } from "./handler";
import {
  readBrief,
  readBriefContext,
  readDelta,
  readMarks,
  readNarrative,
} from "./read-artifact";
import { readPull } from "./read-pull";
import {
  briefQuerySchema,
  deltaQuerySchema,
  marksQuerySchema,
  narrativeQuerySchema,
} from "./schemas";
import type { ReadArtifactResult } from "./types";
import { parseQuery } from "./utils";

const NO_STORE = { "cache-control": "no-store" } as const;

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
    const meta = await readPull(readDeps, access);

    return c.json(meta, HttpStatuses.OK, NO_STORE);
  };
}

/**
 * The GitHub-proxied reads (span diff, file range, stack), still on the
 * handler and controller pair: they read the Hono bag, not the access value.
 */
function githubProxyRoutes(deps: AuthRouteDeps): ProductRouter<AuthzEnv> {
  const app = productRouter<AuthzEnv>();
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
  const handlers = createReadsHandlers(
    deps,
    diffCache,
    fileCache,
    openPullsCache,
  );
  app.query(
    {
      id: ProductQueryIds.READ_DIFF,
      classification: WriteClassifications.READ,
      humanOnly: false,
      pushRequired: false,
      installationOnly: false,
      rowRequired: true,
    },
    "/diff",
    handlers.readDiff,
  );
  app.query(
    {
      id: ProductQueryIds.READ_FILE_RANGE,
      classification: WriteClassifications.READ,
      humanOnly: false,
      pushRequired: false,
      installationOnly: false,
      rowRequired: true,
    },
    "/file-range",
    handlers.readFileRange,
  );
  app.query(
    {
      id: ProductQueryIds.READ_STACK,
      classification: WriteClassifications.READ,
      humanOnly: false,
      pushRequired: false,
      installationOnly: false,
      rowRequired: true,
    },
    "/stack",
    handlers.readStack,
  );
  return app;
}

export function readsRoutes(
  deps: AuthRouteDeps,
): ProductRouter<PullRequestEnv> {
  const app = productRouter<PullRequestEnv>();
  app.query(
    {
      id: ProductQueryIds.READ_PULL,
      classification: WriteClassifications.READ,
      humanOnly: false,
      pushRequired: false,
      installationOnly: false,
      rowRequired: true,
    },
    "/",
    createReadPullHandler(deps),
  );
  app.query(
    {
      id: ProductQueryIds.READ_BRIEF,
      classification: WriteClassifications.READ,
      humanOnly: false,
      pushRequired: false,
      installationOnly: false,
      rowRequired: true,
    },
    "/brief",
    createArtifactHandler(deps, briefQuerySchema, ["base", "head"], readBrief),
  );
  app.query(
    {
      id: ProductQueryIds.READ_MARKS,
      classification: WriteClassifications.READ,
      humanOnly: false,
      pushRequired: false,
      installationOnly: false,
      rowRequired: true,
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
      classification: WriteClassifications.READ,
      humanOnly: false,
      pushRequired: false,
      installationOnly: false,
      rowRequired: true,
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
      classification: WriteClassifications.READ,
      humanOnly: false,
      pushRequired: false,
      installationOnly: false,
      rowRequired: true,
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
      classification: WriteClassifications.READ,
      humanOnly: false,
      pushRequired: false,
      installationOnly: false,
      rowRequired: true,
    },
    "/brief-context",
    createArtifactHandler(
      deps,
      briefQuerySchema,
      ["base", "head"],
      readBriefContext,
    ),
  );
  app.route("/", githubProxyRoutes(deps));
  return app;
}
