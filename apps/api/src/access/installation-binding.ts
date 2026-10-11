import type { InstallationGitHub } from "github";
import { readInstallationId } from "./installation-scope";
import type { InstallationBindingDeps, RepoAccess } from "./types";

/**
 * The App's GitHub on the Installation the request's repo resolves into.
 * Binding mints nothing: the installation token is asked for on the first
 * call. An owner-world repo has no Installation, so reaching here with one
 * is a declaration bug and throws.
 */
export function bindRepoInstallationGitHub(
  deps: InstallationBindingDeps,
  access: RepoAccess,
): InstallationGitHub {
  return deps.bindInstallationGitHub(readInstallationId(access));
}
