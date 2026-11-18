import { ApiErrorCodes } from "contract";
import { HttpStatuses } from "types/http";
import { BadGateway, Unauthorized } from "../../../shared-errors/api-error";
import type { ListInboxFailure } from "../types";

/** A dead token is re-login; any other GitHub failure fails the list closed. */
export function throwListInboxFailure(failure: ListInboxFailure): never {
  const authDead =
    "kind" in failure
      ? failure.kind === "auth-dead"
      : failure.status === HttpStatuses.UNAUTHORIZED;
  if (authDead) {
    throw new Unauthorized();
  }
  throw new BadGateway(ApiErrorCodes.GITHUB_UNAVAILABLE);
}
