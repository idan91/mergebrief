import { ApiErrorCodes } from "contract";
import { RegenerateOutcomes } from "persistence";
import { Conflict, NotFound } from "../../../../../shared-errors/api-error";
import { FailureKinds } from "../../../../../shared-errors/failures";
import { resolveFreshRepositoryError } from "../../../logic/fresh-repository";
import type { AccessFooting } from "../../../../../access/types";
import type { RegenerateFailure } from "../types";

export function throwRegenerateFailure(
  failure: RegenerateFailure,
  footing: AccessFooting,
): never {
  switch (failure.kind) {
    case RegenerateOutcomes.HELD: {
      throw new Conflict(ApiErrorCodes.GENERATION_HELD);
    }
    case RegenerateOutcomes.NOT_REGENERABLE: {
      throw new Conflict(ApiErrorCodes.GENERATION_NOT_REGENERABLE);
    }
    case RegenerateOutcomes.NOT_FOUND:
    case "no-push-access": {
      throw new NotFound();
    }
    case FailureKinds.GITHUB_DENIED: {
      throw resolveFreshRepositoryError(failure.error, footing);
    }
  }
}
