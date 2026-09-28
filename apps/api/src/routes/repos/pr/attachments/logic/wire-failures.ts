// The attachments domain's failure->throw mapper (gated-route posture).
import { GitHubApiErrorCodes } from "github";
import { ApiErrorCodes } from "contract";
import {
  BadGateway,
  NotFound,
  Unauthorized,
} from "../../../../../shared-errors/api-error";
import {
  ReadAttachmentFailureKinds,
  type ReadAttachmentFailure,
} from "../types";

/**
 * A denial collapses to the gate's 404: the viewer proved repo access, but
 * an asset id is a guess until GitHub serves it, so no existence leaks. An
 * asset the PR does not render is the same 404. A 401 with the request's
 * single refresh spent and no retry is the re-login prompt; a retried-still
 * 401 is an upstream error like any other.
 */
export function throwReadAttachmentFailure(
  failure: ReadAttachmentFailure,
): never {
  if (failure.kind === ReadAttachmentFailureKinds.TOKEN_UNREADABLE) {
    throw new Unauthorized();
  }
  if (failure.kind === ReadAttachmentFailureKinds.ASSET_ABSENT) {
    throw new NotFound();
  }
  const { code } = failure.error;
  if (code === GitHubApiErrorCodes.UNAUTHORIZED && !failure.retried) {
    throw new Unauthorized();
  }
  if (isCollapsedDenial(code)) {
    throw new NotFound();
  }
  throw new BadGateway(ApiErrorCodes.GITHUB_UNAVAILABLE);
}

function isCollapsedDenial(code: string): boolean {
  return (
    code === GitHubApiErrorCodes.NOT_FOUND ||
    code === GitHubApiErrorCodes.FORBIDDEN
  );
}
