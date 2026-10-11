import { ApiErrorCodes } from "contract";
import type { AccessFooting } from "../../../../../access/types";
import { Forbidden, NotFound } from "../../../../../shared-errors/api-error";
import { FailureKinds } from "../../../../../shared-errors/failures";
import { resolveFreshRepositoryError } from "../../../logic/fresh-repository";
import type { DeletePullFailure } from "../types";

export function throwDeletePullFailure(
  failure: DeletePullFailure,
  footing: AccessFooting,
): never {
  switch (failure.kind) {
    case FailureKinds.GITHUB_DENIED: {
      throw resolveFreshRepositoryError(failure.error, footing);
    }
    case "not-repo-admin": {
      throw new Forbidden(ApiErrorCodes.REPO_ADMIN_ONLY);
    }
    case "not-found": {
      throw new NotFound();
    }
  }
}
