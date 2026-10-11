import type { AccessFooting } from "../../../../../access/types";
import { NotFound } from "../../../../../shared-errors/api-error";
import { resolveGitHubDenialError } from "../../../../../shared-errors/github-denial";
import { DenialPostures } from "../../../../../shared-errors/github-denial/types";
import { throwAttachmentBranchFailure } from "../../../logic/attachment-branch-failure";
import { resolveFreshRepositoryError } from "../../../logic/fresh-repository";
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
  throw resolveGitHubDenialError(failure.error, DenialPostures.COLLAPSE);
}

export function throwUploadAttachmentFailure(
  failure: UploadAttachmentFailure,
  footing: AccessFooting,
): never {
  if (failure.phase === "resolve") {
    throw resolveFreshRepositoryError(failure.error, footing);
  }
  throwAttachmentBranchFailure(failure.error);
}
