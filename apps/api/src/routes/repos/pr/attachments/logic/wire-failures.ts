// The attachments domain's failure->throw mapper (gated-route posture).
import { NotFound } from "../../../../../shared-errors/api-error";
import { FailureKinds } from "../../../../../shared-errors/failures";
import {
  resolveGitHubDenialError,
  unwrapGitHubFailure,
} from "../../../../../shared-errors/github-denial";
import { DenialPostures } from "../../../../../shared-errors/github-denial/types";
import { throwAttachmentBranchFailure } from "../../../logic/attachment-branch-failure";
import { throwRepoResolveFailure } from "../../../logic/resolve-repo-owner-and-name";
import {
  ReadAttachmentFailureKinds,
  type ReadAttachmentFailure,
  type UploadAttachmentFailure,
} from "../types";

/**
 * A denial collapses to the gate's 404: the viewer proved repo access, but
 * an asset id is a guess until GitHub serves it, so no existence leaks. An
 * asset the PR does not render is the same 404.
 */
export function throwReadAttachmentFailure(
  failure: ReadAttachmentFailure,
): never {
  if (failure.kind === ReadAttachmentFailureKinds.ASSET_ABSENT) {
    throw new NotFound();
  }
  throw resolveGitHubDenialError(
    unwrapGitHubFailure(failure),
    DenialPostures.COLLAPSE,
  );
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
