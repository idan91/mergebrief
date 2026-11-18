import { ApiErrorCodes } from "contract";
import type { AccessFooting } from "../../../../access/types";
import { Forbidden } from "../../../../shared-errors/api-error";
import { throwAttachmentBranchFailure } from "../../logic/attachment-branch-failure";
import { resolveFreshRepositoryError } from "../../logic/fresh-repository";
import type { PurgeAttachmentsFailure } from "../types";

export function throwPurgeAttachmentsFailure(
  failure: PurgeAttachmentsFailure,
  footing: AccessFooting,
): never {
  if (failure.kind === "not-repo-admin") {
    throw new Forbidden(ApiErrorCodes.ATTACHMENTS_ADMIN_ONLY);
  }
  if (failure.phase === "resolve") {
    throw resolveFreshRepositoryError(failure.error, footing);
  }
  throwAttachmentBranchFailure(failure.error);
}
