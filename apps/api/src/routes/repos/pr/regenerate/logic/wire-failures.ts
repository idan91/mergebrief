import { ApiErrorCodes } from "contract";
import { TriggerOnDemandOutcomes } from "persistence";
import {
  Conflict,
  Forbidden,
  NotFound,
} from "../../../../../shared-errors/api-error";
import { FailureKinds } from "../../../../../shared-errors/failures";
import { resolveFreshRepositoryError } from "../../../logic/fresh-repository";
import type { AccessFooting } from "../../../../../access/types";
import type { RegenerateFailure } from "../types";

export function throwRegenerateFailure(
  failure: RegenerateFailure,
  footing: AccessFooting,
): never {
  switch (failure.kind) {
    case TriggerOnDemandOutcomes.HELD: {
      throw new Conflict(ApiErrorCodes.GENERATION_HELD);
    }
    case TriggerOnDemandOutcomes.NOT_REGENERABLE: {
      throw new Conflict(ApiErrorCodes.GENERATION_NOT_REGENERABLE);
    }
    case TriggerOnDemandOutcomes.NOT_FOUND:
    case "no-push-access": {
      throw new NotFound();
    }
    case TriggerOnDemandOutcomes.NEEDS_APPROVER: {
      throw new Forbidden(ApiErrorCodes.HUMAN_ONLY);
    }
    case FailureKinds.GITHUB_DENIED: {
      throw resolveFreshRepositoryError(failure.error, footing);
    }
  }
}
