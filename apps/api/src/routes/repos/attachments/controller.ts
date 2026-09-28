// Hono-free. The branch goes on the App's installation token; the admin
// check that permits it ran in the handler on the viewer's own token.
import { ATTACHMENT_BRANCH } from "contract";
import type { Result } from "types/utils";
import type {
  PurgeAttachmentsControllerDeps,
  PurgeAttachmentsFailure,
  PurgeAttachmentsInput,
  PurgedAttachments,
} from "./types";
import { FailureKinds } from "../../../shared-errors/failures";

async function purgeAttachments(
  deps: PurgeAttachmentsControllerDeps,
  input: PurgeAttachmentsInput,
): Promise<Result<PurgedAttachments, PurgeAttachmentsFailure>> {
  const deleted = await deps.port.deleteAttachmentBranch(input.installationId, {
    owner: input.owner,
    repo: input.repo,
    branch: ATTACHMENT_BRANCH,
  });
  if (!deleted.ok) {
    return {
      ok: false,
      error: {
        kind: FailureKinds.GITHUB_DENIED,
        phase: "mutation",
        error: deleted.error,
      },
    };
  }
  return { ok: true, value: { existed: deleted.value.existed } };
}

export const purgeAttachmentsController = { purgeAttachments };
