import type { ValueOf } from "types";
import { ApiErrorCodes } from "../errors";

/** The OAuth callback's failures, carried home in `SIGN_IN_FAILURE_PARAM` instead of an error body. */
export const SignInFailures = {
  SIGN_IN_FAILED: ApiErrorCodes.SIGN_IN_FAILED,
  GITHUB_UNAVAILABLE: ApiErrorCodes.GITHUB_UNAVAILABLE,
  NOT_ALLOWED: ApiErrorCodes.ACCOUNT_NOT_ALLOWED,
} as const;
export type SignInFailure = ValueOf<typeof SignInFailures>;
