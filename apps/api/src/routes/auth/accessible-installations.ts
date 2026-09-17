// The live accessible-installation set; ALWAYS re-derived from GitHub with
// the viewer's own token, never taken from the caller. Shared by the
// installations and tokens domains (switch/mint validate targets against it).
import {
  GitHubApiErrorCodes,
  listUserInstallations,
  type UserInstallation,
} from "github";
import type { Logger } from "logging";
import { createSessionAuth } from "persistence";
import type { Result } from "types/utils";
import { createReviewerGitHubClient } from "./reviewer-github-client";
import type { AuthRouteDeps, ViewerPrincipal } from "./session/types";

/** The resolved set plus the (possibly refreshed) session it was read under. */
export interface AccessibleSet {
  readonly installations: readonly UserInstallation[];
  readonly session: ViewerPrincipal;
}

/** Semantic failure kinds; the caller's handler owns the wire mapping. */
export type AccessibleSetFailure =
  | { readonly kind: "auth-dead" }
  | { readonly kind: "upstream-failed" };

/**
 * `auth-dead` = re-login territory (unreadable stored token; which burns
 * the session, same posture as the repo gate; or a still-unauthorized
 * GitHub answer); `upstream-failed` = GitHub upstream error.
 */
export async function resolveAccessibleInstallations(
  deps: AuthRouteDeps,
  session: ViewerPrincipal,
  log: Logger,
): Promise<Result<AccessibleSet, AccessibleSetFailure>> {
  const client = createReviewerGitHubClient(deps, session, log);
  const result = await client.run((accessToken) =>
    listUserInstallations(accessToken),
  );
  if (!result.ok) {
    if ("kind" in result.error) {
      await createSessionAuth(deps.handle).deleteSession(
        session.sessionTokenHash,
      );
      return { ok: false, error: { kind: "auth-dead" } };
    }
    if (result.error.code === GitHubApiErrorCodes.UNAUTHORIZED) {
      return { ok: false, error: { kind: "auth-dead" } };
    }
    return { ok: false, error: { kind: "upstream-failed" } };
  }
  return {
    ok: true,
    value: { installations: result.value, session: client.session() },
  };
}
