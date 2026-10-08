// Thread-resolution transport: POSTs resolve/unresolve with the viewer's
// token; expected failure statuses are result kinds, only a malformed 200 throws.
// The 403 is its own kind: the route returns it only at the mutation stage,
// after the viewer re-proved repo access, so it carries a real capability
// signal the FE answers with honest copy and a capability refetch.
// The only 400 is a malformed route param from already-parsed server data,
// so there is no cap to mirror. Both directions are idempotent server-side
// (a converged state answers 200), so a retry after any failure is safe.
import {
  ApiError,
  ApiErrorCodes,
  apiFetch,
  errorFromResponse,
  type ApiErrorCode,
} from "../../data/apiFetch";
import {
  ResolveThreadResultKinds,
  type ResolveThreadResult,
  type ResolveThreadResultKind,
} from "./types";

type ResolveFailureKind = Exclude<
  ResolveThreadResultKind,
  typeof ResolveThreadResultKinds.DONE
>;

// Total over the wire vocabulary: a new ApiErrorCode member fails to compile
// here instead of silently becoming "try again shortly". `forbidden` covers
// the codeless-403 fallback for the github-permission kind.
const KindForCode = {
  [ApiErrorCodes.UNAUTHORIZED]: ResolveThreadResultKinds.UNAUTHORIZED,
  [ApiErrorCodes.INVALID_SIGNATURE]: ResolveThreadResultKinds.UPSTREAM,
  [ApiErrorCodes.FORBIDDEN]: ResolveThreadResultKinds.GITHUB_PERMISSION,
  [ApiErrorCodes.GITHUB_PERMISSION]: ResolveThreadResultKinds.GITHUB_PERMISSION,
  [ApiErrorCodes.SCOPE_EXCEEDED]: ResolveThreadResultKinds.UPSTREAM,
  [ApiErrorCodes.HUMAN_ONLY]: ResolveThreadResultKinds.UPSTREAM,
  [ApiErrorCodes.NO_REPO_WRITE_ACCESS]:
    ResolveThreadResultKinds.NO_WRITE_ACCESS,
  [ApiErrorCodes.REPO_ADMIN_ONLY]: ResolveThreadResultKinds.UPSTREAM,
  [ApiErrorCodes.ATTACHMENTS_DISABLED]: ResolveThreadResultKinds.UPSTREAM,
  [ApiErrorCodes.ATTACHMENTS_ADMIN_ONLY]: ResolveThreadResultKinds.UPSTREAM,
  [ApiErrorCodes.NOT_FOUND]: ResolveThreadResultKinds.NOT_FOUND,
  [ApiErrorCodes.INVALID_REQUEST]: ResolveThreadResultKinds.INVALID,
  [ApiErrorCodes.ATTACHMENT_UNSUPPORTED_TYPE]: ResolveThreadResultKinds.INVALID,
  [ApiErrorCodes.NOT_A_PR_URL]: ResolveThreadResultKinds.UPSTREAM,
  [ApiErrorCodes.SIGN_IN_FAILED]: ResolveThreadResultKinds.UPSTREAM,
  [ApiErrorCodes.REQUEST_TOO_LARGE]: ResolveThreadResultKinds.UPSTREAM,
  [ApiErrorCodes.DIFF_TOO_LARGE]: ResolveThreadResultKinds.UPSTREAM,
  // Read-only codes: this write transport cannot receive any of them.
  [ApiErrorCodes.FILE_NOT_FOUND]: ResolveThreadResultKinds.UPSTREAM,
  [ApiErrorCodes.FILE_TOO_LARGE]: ResolveThreadResultKinds.UPSTREAM,
  [ApiErrorCodes.FILE_NOT_TEXT]: ResolveThreadResultKinds.UPSTREAM,
  [ApiErrorCodes.DRAFT_ALREADY_PUBLISHED]: ResolveThreadResultKinds.UPSTREAM,
  [ApiErrorCodes.DRAFT_ANCHOR_ORPHANED]: ResolveThreadResultKinds.UPSTREAM,
  [ApiErrorCodes.DRAFT_LIMIT_REACHED]: ResolveThreadResultKinds.UPSTREAM,
  [ApiErrorCodes.SESSION_RECORD_LIMIT_REACHED]:
    ResolveThreadResultKinds.UPSTREAM,
  [ApiErrorCodes.DRAFT_PUBLISH_PENDING]: ResolveThreadResultKinds.UPSTREAM,
  [ApiErrorCodes.DRAFT_PUBLISH_IN_DOUBT]: ResolveThreadResultKinds.UPSTREAM,
  [ApiErrorCodes.ATTACHMENT_LIMIT_REACHED]: ResolveThreadResultKinds.UPSTREAM,
  [ApiErrorCodes.PENDING_REVIEW_HELD]: ResolveThreadResultKinds.UPSTREAM,
  [ApiErrorCodes.PR_CHANGED_SINCE_READ]: ResolveThreadResultKinds.UPSTREAM,
  [ApiErrorCodes.PR_REWRITTEN_SINCE_READ]: ResolveThreadResultKinds.UPSTREAM,
  [ApiErrorCodes.APP_NOT_INSTALLED]: ResolveThreadResultKinds.UPSTREAM,
  [ApiErrorCodes.GITHUB_UNAVAILABLE]: ResolveThreadResultKinds.UPSTREAM,
  [ApiErrorCodes.GENERATION_FAILED]: ResolveThreadResultKinds.UPSTREAM,
  [ApiErrorCodes.GENERATION_UNAVAILABLE]: ResolveThreadResultKinds.UPSTREAM,
  [ApiErrorCodes.GENERATION_CONFIG]: ResolveThreadResultKinds.UPSTREAM,
  [ApiErrorCodes.INTERNAL_ERROR]: ResolveThreadResultKinds.UPSTREAM,
  // Web-local; never on the wire: errorFromResponse cannot produce it.
  [ApiErrorCodes.MALFORMED]: ResolveThreadResultKinds.UPSTREAM,
} as const satisfies Record<ApiErrorCode, ResolveFailureKind>;

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
    return { kind: KindForCode[code] };
  }
  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    throw new ApiError(ApiErrorCodes.MALFORMED, response.status, path);
  }
  // A body echoing the OTHER direction would have the UI announce a state the
  // server never set: a contract violation, so it throws rather than lying.
  if (!isResolutionBody(parsed) || parsed.resolved !== resolved) {
    throw new ApiError(ApiErrorCodes.MALFORMED, response.status, path);
  }
  return {
    kind: ResolveThreadResultKinds.DONE,
    resolved: parsed.resolved,
    alreadyInTargetState: parsed.alreadyInTargetState,
  };
}
