import { NotFound } from "../../../../shared-errors/api-error";
import { resolveGitHubDenialError } from "../../../../shared-errors/github-denial";
import { DenialPostures } from "../../../../shared-errors/github-denial/types";
import type { MentionsFailure } from "../types";

export function throwMentionsFailure(failure: MentionsFailure): never {
  if (failure.kind === "not-found") {
    throw new NotFound();
  }
  throw resolveGitHubDenialError(failure.error, DenialPostures.COLLAPSE);
}
