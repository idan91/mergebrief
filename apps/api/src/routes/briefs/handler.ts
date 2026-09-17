import type { Context } from "hono";
import { isRepoId } from "persistence";
import { NotFound, BadRequest } from "../../shared-errors/api-error";
import { stampAuditTarget } from "../../product-operations/audit";
import type { AuthRouteDeps } from "../auth/session/types";
import type { AuthzEnv } from "../authz";
import { prNumberSchema } from "../repos/pr/wire-bounds";
import urlBriefsController from "./controller";
import { listQuerySchema } from "./schemas";

const NO_STORE = { "cache-control": "no-store" } as const;

/** Brand the `:repoId` segment; a malformed id is a hint-free 404. */
function parseRepoIdParam(raw: string | undefined) {
  if (raw === undefined || !/^\d+$/.test(raw)) {
    return undefined;
  }
  const value = BigInt(raw);
  return isRepoId(value) ? value : undefined;
}

export default function createHandlers(deps: AuthRouteDeps) {
  return {
    listUrlBriefs: async (c: Context<AuthzEnv>) => {
      const query = listQuerySchema.safeParse({
        limit: c.req.query("limit") ?? undefined,
      });
      if (!query.success) {
        throw new BadRequest();
      }
      const session = c.get("session");
      const body = await urlBriefsController.listUrlBriefs(
        { handle: deps.handle },
        {
          // The list is the OWNER world's, whichever world the session ctx
          // resolved: an installation-bound viewer owns url-box rows too.
          ownerUserId: session.reviewerId,
          viewerLogin: session.reviewerLogin,
          limit: query.data.limit,
        },
      );
      return c.json(body, 200, NO_STORE);
    },

    deleteUrlBrief: async (c: Context<AuthzEnv>) => {
      const repoId = parseRepoIdParam(c.req.param("repoId"));
      if (repoId === undefined) {
        throw new NotFound();
      }
      const prNumber = prNumberSchema.safeParse(c.req.param("prNumber"));
      if (!prNumber.success) {
        throw new BadRequest();
      }
      const deleted = await urlBriefsController.deleteUrlBrief(
        { handle: deps.handle },
        {
          // Ownership derives from the CREDENTIAL, never a caller value:
          // only the viewer's own url-box rows are addressable.
          ownerUserId: c.get("session").reviewerId,
          repoId,
          prNumber: prNumber.data,
        },
      );
      if (!deleted.ok) {
        throw new NotFound();
      }
      stampAuditTarget(c, "pull_request", deleted.value.pullRequestId);
      return c.json({ ok: true }, 200, NO_STORE);
    },
  };
}
