import type { AccessFooting } from "../../../../../access/types";
import { resolveGitHubDenialError } from "../../../../../shared-errors/github-denial";
import { DenialPostures } from "../../../../../shared-errors/github-denial/types";
import { resolveFreshRepositoryError } from "../../../logic/fresh-repository";
import type { MarkReadyFailure } from "../types";

/**
 * After a good re-resolve a FORBIDDEN is a genuine App permission gap: the
 * write needs `contents: write`, which the viewer can act on.
 */
export function throwMarkReadyFailure(
  failure: MarkReadyFailure,
  footing: AccessFooting,
): never {
  if (failure.phase === "resolve") {
    throw resolveFreshRepositoryError(failure.error, footing);
  }
  throw resolveGitHubDenialError(failure.error, DenialPostures.HONEST);
}
