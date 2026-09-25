import type { Context } from "hono";
import { BadRequest, NotFound } from "../../../../shared-errors/api-error";
import { stampAuditTarget } from "../../../../product-operations/audit";
import type { AuthRouteDeps } from "../../../auth/session/types";
import type { AuthzEnv } from "../../../authz";
import { prNumberSchema } from "../../../wire-bounds";
import { resolvePrScopeFrom } from "../scope";
import { archiveController } from "./controller";
import type { ArchivePullInput } from "./types";

const NO_STORE = { "cache-control": "no-store" } as const;

type ArchiveOp = typeof archiveController.archivePull;

export function createArchiveHandlers(deps: AuthRouteDeps) {
  async function readInput(c: Context<AuthzEnv>): Promise<ArchivePullInput> {
    const parsedPr = prNumberSchema.safeParse(c.req.param("prNumber"));
    if (!parsedPr.success) {
      throw new BadRequest();
    }
    const ctx = await resolvePrScopeFrom(c, deps.handle, parsedPr.data);
    return {
      ctx,
      repoId: c.get("repoId"),
      prNumber: parsedPr.data,
      reviewerId: c.get("session").reviewerId,
    };
  }

  function buildHandler(op: ArchiveOp) {
    return async (c: Context<AuthzEnv>) => {
      const input = await readInput(c);

      const written = await op({ handle: deps.handle }, input);
      if (!written.ok) {
        throw new NotFound();
      }

      stampAuditTarget(c, "pull_request", written.value.pullRequestId);
      return c.json({ ok: true }, 200, NO_STORE);
    };
  }

  return {
    archivePull: buildHandler(archiveController.archivePull),
    unarchivePull: buildHandler(archiveController.unarchivePull),
  };
}
