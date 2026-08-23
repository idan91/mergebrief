import type { Context } from "hono";
import { createArtifactStore, createTenantRepository } from "persistence";
import type { AppDatabase } from "persistence";
import type { AuthzEnv } from "../../../authz";
import readsController from "./controller";
import {
  briefQuerySchema,
  deltaQuerySchema,
  marksQuerySchema,
  narrativeQuerySchema,
} from "./schemas";
import type { ReadsControllerDeps } from "./types";
import { parseQuery, parsePrNumber } from "./utils";

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

export default function createHandlers(handle: AppDatabase) {
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

  return { readBrief, readMarks, readDelta, readNarrative };
}
