import { HttpStatuses } from "types";

import { ApiError, isSignInRequired } from "../../apiFetch";
import {
  WriteFailureKinds,
  type WriteFailureKind,
  type WriteKindTable,
} from "../types";

/** A write's caught error as its kind: anything but an `ApiError` (a network throw) and the proxy's 504 are indeterminate. */
export function readFailureKind<Kind extends string>(
  error: unknown,
  kinds: WriteKindTable<Kind>,
): Kind | WriteFailureKind {
  if (!(error instanceof ApiError)) {
    return WriteFailureKinds.INDETERMINATE;
  }
  if (error.status === HttpStatuses.GATEWAY_TIMEOUT) {
    return WriteFailureKinds.INDETERMINATE;
  }

  const listed = kinds[error.code];
  if (listed !== undefined) {
    return listed;
  }
  if (isSignInRequired(error.code)) {
    return WriteFailureKinds.UNAUTHORIZED;
  }
  return kinds.fallback;
}
