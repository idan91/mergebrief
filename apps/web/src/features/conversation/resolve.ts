// Thread-resolution transport: POSTs resolve/unresolve with the viewer's
// token; every failure is a result kind. The 403 is its own kind: the route
// returns it only at the mutation stage, after the viewer re-proved repo
// access, so it carries a real capability signal the FE answers with honest
// copy and a capability refetch. The only 400 is a malformed route param
// from already-parsed server data, so there is no cap to mirror. Both
// directions are idempotent server-side (a converged state answers 200), so a
// retry after any failure is safe.
import { ProductActionIds, type ThreadResolutionResponse } from "contract";
import { z } from "zod/v4";

import { ApiErrorCodes } from "../../data/apiFetch";
import { readFailureKind, request } from "../../data/request";
import type { WriteKindTable } from "../../data/request/types";
import {
  ResolveThreadResultKinds,
  type ResolveThreadResult,
  type ResolveThreadResultKind,
} from "./types";

type ResolveFailureKind = Exclude<
  ResolveThreadResultKind,
  typeof ResolveThreadResultKinds.DONE
>;

// `forbidden` covers the codeless-403 fallback for the github-permission kind.
const ResolveKinds: WriteKindTable<ResolveFailureKind> = {
  [ApiErrorCodes.FORBIDDEN]: ResolveThreadResultKinds.GITHUB_PERMISSION,
  [ApiErrorCodes.GITHUB_PERMISSION]: ResolveThreadResultKinds.GITHUB_PERMISSION,
  [ApiErrorCodes.NO_REPO_WRITE_ACCESS]:
    ResolveThreadResultKinds.NO_WRITE_ACCESS,
  [ApiErrorCodes.NOT_FOUND]: ResolveThreadResultKinds.NOT_FOUND,
  [ApiErrorCodes.INVALID_REQUEST]: ResolveThreadResultKinds.INVALID,
  [ApiErrorCodes.ATTACHMENT_UNSUPPORTED_TYPE]: ResolveThreadResultKinds.INVALID,
  [ApiErrorCodes.MALFORMED]: ResolveThreadResultKinds.INDETERMINATE,
  fallback: ResolveThreadResultKinds.UPSTREAM,
};

const threadResolutionSchema = z.object({
  resolved: z.boolean(),
  alreadyInTargetState: z.boolean(),
}) satisfies z.ZodType<ThreadResolutionResponse>;

async function sendThreadResolution(
  repoId: string,
  prNumber: number,
  rootCommentId: number,
  resolved: boolean,
): Promise<ThreadResolutionResponse> {
  const params = { repoId, prNumber, commentId: rootCommentId };
  if (resolved) {
    return request(
      ProductActionIds.RESOLVE_THREAD,
      { params },
      threadResolutionSchema,
    );
  }
  return request(
    ProductActionIds.UNRESOLVE_THREAD,
    { params },
    threadResolutionSchema,
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
  let resolution: ThreadResolutionResponse;
  try {
    resolution = await sendThreadResolution(
      repoId,
      prNumber,
      rootCommentId,
      resolved,
    );
  } catch (error) {
    return { kind: readFailureKind(error, ResolveKinds) };
  }

  // A body echoing the OTHER direction would have the UI announce a state the
  // server never set, so the outcome is unknown.
  if (resolution.resolved !== resolved) {
    return { kind: ResolveThreadResultKinds.INDETERMINATE };
  }
  return { kind: ResolveThreadResultKinds.DONE, ...resolution };
}
