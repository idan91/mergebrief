// The generate domain's failure->throw mapper: the paste's viewer-token read
// is the access check, so a refusal collapses to absence like the gate.
import { resolveGitHubDenialError } from "../../../shared-errors/github-denial";
import { DenialPostures } from "../../../shared-errors/github-denial/types";
import type { GenerateFailure } from "../types";

export function throwGenerateFailure(failure: GenerateFailure): never {
  throw resolveGitHubDenialError(failure.error, DenialPostures.COLLAPSE);
}
