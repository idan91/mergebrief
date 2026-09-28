// The one mapper for a write to the attachments branch the App could not
// make, shared by the upload and the purge: a rule refusing it and the App
// lacking the permission are both honest 403s with their own codes, since
// the viewer proved access and the App is installed; a repository the App
// lost collapses to 404 like the gate.
import { ApiErrorCodes } from "contract";
import { GitHubApiErrorCodes, type GitHubApiError } from "github";
import {
  BadGateway,
  Forbidden,
  NotFound,
} from "../../../shared-errors/api-error";

export function throwAttachmentBranchFailure(error: GitHubApiError): never {
  if (error.code === GitHubApiErrorCodes.RULE_REFUSED) {
    throw new Forbidden(ApiErrorCodes.ATTACHMENTS_DISABLED);
  }
  if (error.code === GitHubApiErrorCodes.FORBIDDEN) {
    throw new Forbidden(ApiErrorCodes.GITHUB_PERMISSION);
  }
  if (error.code === GitHubApiErrorCodes.NOT_FOUND) {
    throw new NotFound();
  }
  throw new BadGateway(ApiErrorCodes.GITHUB_UNAVAILABLE);
}
