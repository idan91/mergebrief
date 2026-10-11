import { NotFound } from "../../../../shared-errors/api-error";
import { resolveGitHubDenialError } from "../../../../shared-errors/github-denial";
import { DenialPostures } from "../../../../shared-errors/github-denial/types";
import type { ListCollaboratorsFailure } from "../types";

export function throwListCollaboratorsFailure(
  failure: ListCollaboratorsFailure,
): never {
  if (failure.kind === "not-found") {
    throw new NotFound();
  }
  throw resolveGitHubDenialError(failure.error, DenialPostures.APP_READ);
}
