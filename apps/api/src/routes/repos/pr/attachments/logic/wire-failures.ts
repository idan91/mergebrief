import { ApiErrorCodes } from "contract";
import type { AccessFooting } from "../../../../../access/types";
import {
  BadGateway,
  NotFound,
  PayloadTooLarge,
} from "../../../../../shared-errors/api-error";
import { resolveGitHubDenialError } from "../../../../../shared-errors/github-denial";
import { DenialPostures } from "../../../../../shared-errors/github-denial/types";
import { throwAttachmentBranchFailure } from "../../../logic/attachment-branch-failure";
import { resolveFreshRepositoryError } from "../../../logic/fresh-repository";
import {
  MediaReplyRefusalKinds,
  ReadAttachmentFailureKinds,
  type MediaReplyRefusal,
  type ReadAttachmentWireFailure,
  type SliceRefusalKinds,
  type UploadAttachmentFailure,
} from "../types";

/**
 * A denial collapses to the gate's 404: the viewer proved repo access, but
 * an asset id is a guess until GitHub serves it, so no existence leaks. An
 * asset the PR does not render is the same 404.
 */
export function throwReadAttachmentFailure(
  failure: ReadAttachmentWireFailure,
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

type ThrownMediaRefusal = Exclude<
  MediaReplyRefusal,
  { readonly kind: typeof SliceRefusalKinds.UNSATISFIABLE }
>;

/**
 * A file past the media cap is its own 413; an answer naming no size is the
 * same 404 an unservable file is; upstream serving other bytes than asked
 * is an upstream failure.
 */
export function throwMediaReplyRefusal(refusal: ThrownMediaRefusal): never {
  if (refusal.kind === MediaReplyRefusalKinds.TOO_LARGE) {
    throw new PayloadTooLarge(ApiErrorCodes.MEDIA_TOO_LARGE);
  }
  if (refusal.kind === MediaReplyRefusalKinds.SIZE_UNKNOWN) {
    throw new NotFound();
  }
  throw new BadGateway(ApiErrorCodes.GITHUB_UNAVAILABLE);
}
