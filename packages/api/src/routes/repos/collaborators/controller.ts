// Hono-free. The gate proved viewer access and the handler owns posture +
// the serialized-body cache; this op is the installation-token roster read.
import type { Result } from "types";
import type { InstallationGitHubPort } from "../../github-port";
import type { CollaboratorsFailure, ListCollaboratorsInput } from "./types";

export default {
  async listCollaborators(
    deps: { readonly github: InstallationGitHubPort },
    input: ListCollaboratorsInput,
  ) {
    const fetched = await deps.github.listRepoCollaborators(
      input.installationId,
      { owner: input.owner, repo: input.repo },
    );
    if (!fetched.ok) {
      const denied: Result<never, CollaboratorsFailure> = {
        ok: false,
        error: { kind: "github-denied", error: fetched.error },
      };
      return denied;
    }
    return fetched;
  },
};
