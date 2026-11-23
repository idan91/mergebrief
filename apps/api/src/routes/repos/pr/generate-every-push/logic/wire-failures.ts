import { NotFound } from "../../../../../shared-errors/api-error";
import { FailureKinds } from "../../../../../shared-errors/failures";
import { resolveFreshRepositoryError } from "../../../logic/fresh-repository";
import type { AccessFooting } from "../../../../../access/types";
import type { TurnOnEveryPushFailure } from "../types";

export function throwTurnOnEveryPushFailure(
  failure: TurnOnEveryPushFailure,
  footing: AccessFooting,
): never {
  switch (failure.kind) {
    case "not-found":
    case "no-push-access": {
      throw new NotFound();
    }
    case FailureKinds.GITHUB_DENIED: {
      throw resolveFreshRepositoryError(failure.error, footing);
    }
  }
}
