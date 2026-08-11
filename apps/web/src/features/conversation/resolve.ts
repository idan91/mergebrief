// Thread-resolution transport: POSTs the resolve/unresolve routes with the
// viewer's token. Expected failure statuses are RESULT KINDS the affordances
// render; only a malformed 200 throws (contract violation).
//
// The 403 is its OWN kind, not folded into `upstream`/`not-found`: the route
// only returns it at the MUTATION stage, after the viewer re-proved repo
// access, so it carries a real capability signal (raced revocation, read-only
// collaborator) that the FE answers with honest copy plus a capability
// refetch. The reply route's 403 collapses to 404 server-side because it
// carries none.
//
// The routes' only 400 is a malformed `:prNumber`/`:commentId`, both from
// already-parsed server data — unreachable from a valid UI state, so there is
// no cap to mirror; it surfaces as its own recoverable kind rather than a
// silent throw.
//
// Both directions are idempotent server-side (a converged state answers 200
// with `alreadyInTargetState`), so retrying after ANY failure kind is safe.
import {
  ApiError,
  ApiErrorCode,
  apiFetch,
  errorFromResponse,
} from "../../data/apiFetch";

export type ResolveThreadResult =
  /**
   * The thread is in the requested state — a fresh flip or a converged one
   * (`alreadyInTargetState`). Both are success and share the refetch path;
   * the flag exists so copy can stay honest if it ever needs to differ.
   */
  | {
      readonly kind: "done";
      readonly resolved: boolean;
      readonly alreadyInTargetState: boolean;
    }
  /** 401 — session expired; sign in again. */
  | { readonly kind: "unauthorized" }
  /** 403 — GitHub refused the mutation (permissions changed under the viewer). */
  | { readonly kind: "github-permission" }
  /** 404 — the thread (or the PR) is gone. */
  | { readonly kind: "not-found" }
  /** 400 — the route rejected the shape (unreachable from valid UI state). */
  | { readonly kind: "invalid" }
  /** 502/anything else — GitHub rejected or is unreachable. */
  | { readonly kind: "upstream" };

function isResolutionBody(
  value: unknown,
): value is { resolved: boolean; alreadyInTargetState: boolean } {
  return (
    typeof value === "object" &&
    value !== null &&
    "resolved" in value &&
    typeof value.resolved === "boolean" &&
    "alreadyInTargetState" in value &&
    typeof value.alreadyInTargetState === "boolean"
  );
}

/**
 * Flip one thread's resolution. `resolved` picks the ROUTE (the two directions
 * are separate endpoints), never a body flag.
 */
export async function setThreadResolution(
  repoId: string,
  prNumber: number,
  rootCommentId: number,
  resolved: boolean,
): Promise<ResolveThreadResult> {
  const path = `/api/repos/${encodeURIComponent(repoId)}/pulls/${String(prNumber)}/comments/${String(rootCommentId)}/${resolved ? "resolve" : "unresolve"}`;
  const response = await apiFetch(path, { method: "POST" });
  if (!response.ok) {
    const { code } = await errorFromResponse(response, path);
    if (code === ApiErrorCode.UNAUTHORIZED) return { kind: "unauthorized" };
    // forbidden covers the codeless-403 fallback.
    if (
      code === ApiErrorCode.GITHUB_PERMISSION ||
      code === ApiErrorCode.FORBIDDEN
    ) {
      return { kind: "github-permission" };
    }
    if (code === ApiErrorCode.NOT_FOUND) return { kind: "not-found" };
    if (code === ApiErrorCode.INVALID_REQUEST) return { kind: "invalid" };
    return { kind: "upstream" };
  }
  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    throw new ApiError(ApiErrorCode.MALFORMED, response.status, path);
  }
  // A body echoing the OTHER direction would have the UI announce a state the
  // server never set — a contract violation, so it throws rather than lying.
  if (!isResolutionBody(parsed) || parsed.resolved !== resolved) {
    throw new ApiError(ApiErrorCode.MALFORMED, response.status, path);
  }
  return {
    kind: "done",
    resolved: parsed.resolved,
    alreadyInTargetState: parsed.alreadyInTargetState,
  };
}
