import { ApiErrorCodes } from "contract";
import type { Context } from "hono";
import { Forbidden } from "../../../../shared-errors/api-error";
import { AuthChannels } from "../../../auth/session/types";
import type { AuthzEnv } from "../../../authz";

/**
 * THE human-only predicate, one site for every operation that signs under
 * the reviewer's name: clearing a risk, and deleting a pull request's briefs.
 * A bearer token doing either would act under the human's signature.
 */
export function assertHuman(c: Context<AuthzEnv>): void {
  if (c.get("session").channel !== AuthChannels.COOKIE) {
    throw new Forbidden(ApiErrorCodes.HUMAN_ONLY);
  }
}
