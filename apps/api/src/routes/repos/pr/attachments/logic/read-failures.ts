import type { GitHubApiError, GitHubCallFailure } from "github";
import { HttpStatuses } from "types/http";
import type { Result } from "types/utils";
import {
  ReadAttachmentFailureKinds,
  type AttachmentBytes,
  type ReadAttachmentFailure,
} from "../types";

export function wrapDenial<Value>(
  result: Result<Value, GitHubCallFailure>,
): Result<Value, ReadAttachmentFailure> {
  if (result.ok) {
    return result;
  }
  const kind = ReadAttachmentFailureKinds.GITHUB_DENIED;
  return { ok: false, error: { kind, error: result.error } };
}

/** Upstream refusing the range is its own failure; the route answers it 416. */
export function wrapBytesFailure(
  fetched: Result<AttachmentBytes, GitHubApiError>,
): Result<AttachmentBytes, ReadAttachmentFailure> {
  const refusedRange =
    !fetched.ok && fetched.error.status === HttpStatuses.RANGE_NOT_SATISFIABLE;
  if (refusedRange) {
    const kind = ReadAttachmentFailureKinds.RANGE_NOT_SATISFIABLE;
    return { ok: false, error: { kind } };
  }
  return wrapDenial(fetched);
}
