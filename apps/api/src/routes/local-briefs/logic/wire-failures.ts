import { ApiErrorCodes } from "contract";
import {
  InternalError,
  NotFound,
  type ApiError,
} from "../../../shared-errors/api-error";
import { LocalBriefsFailureKinds, type LocalBriefsFailure } from "../types";

export function toLocalBriefsError(failure: LocalBriefsFailure): ApiError {
  if (failure.kind === LocalBriefsFailureKinds.NOT_FOUND) {
    return new NotFound();
  }
  return new InternalError(ApiErrorCodes.ARTIFACT_UNREADABLE);
}
