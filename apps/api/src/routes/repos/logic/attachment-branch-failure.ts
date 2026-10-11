// The one mapper for a write to the attachments branch the App could not
// make, shared by the upload and the purge. The write rides the App's
// installation credential: a rule refusing it is its own honest 403, and
// every other refusal answers under the app-write posture.
import { ApiErrorCodes } from "contract";
import { GitHubApiErrorCodes, type GitHubCallFailure } from "github";
import { Forbidden } from "../../../shared-errors/api-error";
import { resolveGitHubDenialError } from "../../../shared-errors/github-denial";
import { DenialPostures } from "../../../shared-errors/github-denial/types";

export function throwAttachmentBranchFailure(error: GitHubCallFailure): never {
  if (error.code === GitHubApiErrorCodes.RULE_REFUSED) {
    throw new Forbidden(ApiErrorCodes.ATTACHMENTS_DISABLED);
  }
  throw resolveGitHubDenialError(error, DenialPostures.APP_WRITE);
}
