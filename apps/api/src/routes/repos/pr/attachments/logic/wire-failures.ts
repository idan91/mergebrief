// The attachments domain's failure->throw mapper (gated-route posture).
import { GitHubApiErrorCodes, type GitHubApiError } from "github";
import { ApiErrorCodes } from "contract";
import {
  BadGateway,
  Forbidden,
  NotFound,
  Unauthorized,
} from "../../../../../shared-errors/api-error";
import { FailureKinds } from "../../../../../shared-errors/failures";
import { throwRepoResolveFailure } from "../../logic/resolve-repo-owner-and-name";
import {
  ReadAttachmentFailureKinds,
  type ReadAttachmentFailure,
  type UploadAttachmentFailure,
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

/**
 * A write to the attachments branch the repository refused is an honest 403:
 * the viewer proved access and the App is installed, so naming the cause is
 * what lets the operator act. A rule on the branch is one cause; the App
 * lacking the permission (Contents kept read-only, an archived repository)
 * is the other, and each has its own code. A NOT_FOUND after the re-resolve
 * means the App lost the repo; it collapses to 404 like the gate.
 */
export function throwAttachmentBranchFailure(error: GitHubApiError): never {
  if (error.code === GitHubApiErrorCodes.RULE_REFUSED) {
    throw new Forbidden(ApiErrorCodes.ATTACHMENTS_DISABLED);
  }
  if (error.code === GitHubApiErrorCodes.FORBIDDEN) {
    throw new Forbidden(ApiErrorCodes.GITHUB_PERMISSION);
  }
  if (error.code === GitHubApiErrorCodes.NOT_FOUND) {
    throw new NotFound();
  }
  throw new BadGateway(ApiErrorCodes.GITHUB_UNAVAILABLE);
}

export function throwUploadAttachmentFailure(
  failure: UploadAttachmentFailure,
  urlBoxOnly: boolean,
): never {
  if (
    failure.kind === FailureKinds.TOKEN_UNREADABLE ||
    failure.phase === "resolve"
  ) {
    throwRepoResolveFailure(failure, urlBoxOnly);
  }
  throwAttachmentBranchFailure(failure.error);
}
