import type { VersionResponse } from "contract";
import type { Context } from "hono";
import { HttpStatuses } from "types/http";
import { BadRequest } from "../../shared-errors/api-error";
import type { AuthzEnv } from "../../access/types";
import { versionController } from "./controller";
import { dismissVersionBodySchema } from "./schemas";
import type { VersionControllerDeps } from "./types";

const NO_STORE = { "cache-control": "no-store" } as const;

type VersionHandler = (c: Context<AuthzEnv>) => Promise<Response>;

export interface VersionHandlers {
  readonly readVersion: VersionHandler;
  readonly dismissVersion: VersionHandler;
}

export function createVersionHandlers(
  deps: VersionControllerDeps,
): VersionHandlers {
  return {
    readVersion: async (c) => {
      const body: VersionResponse = await versionController.readVersion(deps, {
        reviewerId: c.get("session").reviewerId,
      });
      return c.json(body, HttpStatuses.OK, NO_STORE);
    },

    dismissVersion: async (c) => {
      const parsed = dismissVersionBodySchema.safeParse(
        await c.req.json().catch(() => undefined),
      );
      if (!parsed.success) {
        throw new BadRequest();
      }

      const dismissed = await versionController.dismissVersion(deps, {
        reviewerId: c.get("session").reviewerId,
        version: parsed.data.version,
      });
      if (!dismissed.ok) {
        throw new BadRequest();
      }
      return c.body(null, HttpStatuses.NO_CONTENT, NO_STORE);
    },
  };
}
