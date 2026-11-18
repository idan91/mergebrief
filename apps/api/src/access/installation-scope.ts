import type { InstallationId } from "persistence";
import type { RepoAccess } from "./types";

/**
 * The Installation holding the repo, for an installation-only operation: the
 * router already answered 404 anywhere else, so reaching here without one is
 * a declaration bug, never a request's fault.
 */
export function readInstallationId(access: RepoAccess): InstallationId {
  if (access.installation.kind !== "installation") {
    throw new Error(
      "an installation-only operation reached an owner-world repo",
    );
  }
  return access.installation.installationId;
}
