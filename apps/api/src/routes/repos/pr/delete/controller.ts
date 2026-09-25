// Hono-free. The installation row goes together with the url row the same
// viewer may hold at the same coordinates, which would otherwise resurface
// as theirs the moment the installation row stopped shadowing it. The
// viewer's own url row on its own is the inbox domain's purge, not this.
import type { InstallationId, PullRequestRowId } from "persistence";
import type { Result } from "types/utils";
import { purgeRowIn } from "../../../purge-row";
import type {
  DeleteControllerDeps,
  DeletePullFailure,
  DeletePullInput,
} from "./types";

type DeletePullResult = Result<
  { readonly pullRequestId: PullRequestRowId },
  DeletePullFailure
>;

const NOT_FOUND: DeletePullResult = {
  ok: false,
  error: { kind: "not-found" },
};

async function deleteInstallationRow(
  deps: DeleteControllerDeps,
  installationId: InstallationId,
  input: DeletePullInput,
): Promise<DeletePullResult> {
  const pullRequestId = await purgeRowIn(
    deps.handle,
    { installationId },
    input,
    input.reviewerId,
  );
  if (pullRequestId === undefined) {
    return NOT_FOUND;
  }

  await purgeRowIn(
    deps.handle,
    { ownerUserId: input.reviewerId },
    input,
    input.reviewerId,
  );
  return { ok: true, value: { pullRequestId } };
}

export const deleteController = { deleteInstallationRow };
