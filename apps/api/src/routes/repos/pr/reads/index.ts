// The reviewer read API, behind the pr subtree's shared gate: PR meta, the
// stored artifacts (brief / brief-context / marks / delta / narrative), and
// the LIVE diff proxy (viewer token, per-session ~60s cache, NEVER
// persisted). Composition only; the diff cache is created here, once per
// `createApp`, so it is scoped to the app instance.
import { ProductQueryIds } from "contract";
import {
  productRouter,
  type ProductRouter,
} from "../../../../product-operations/product-router";
import { WriteClassifications } from "persistence";
import type { AuthRouteDeps } from "../../../auth/session/types";
import type { AuthzEnv } from "../../../../access/types";
import type { OpenPullRequest } from "brief-core/pr-stack";
import { createTtlCache } from "../../../ttl-cache";
import {
  DIFF_CACHE_MAX_ENTRIES,
  FILE_BLOB_CACHE_MAX_ENTRIES,
  OPEN_PULLS_CACHE_MAX_ENTRIES,
} from "./consts";
import { createReadsHandlers } from "./handler";

export function readsRoutes(deps: AuthRouteDeps): ProductRouter<AuthzEnv> {
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
      id: ProductQueryIds.READ_PULL,
      classification: WriteClassifications.READ,
      humanOnly: false,
      pushRequired: false,
      installationOnly: false,
      rowRequired: true,
    },
    "/",
    handlers.readPull,
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
    handlers.readBrief,
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
    handlers.readMarks,
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
    handlers.readDelta,
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
    handlers.readNarrative,
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
    handlers.readBriefContext,
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
