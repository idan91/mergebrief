import { SignInFailures, type SignInFailure } from "contract";
import type { TranslationKey } from "i18n";

export const SIGN_IN_FAILURE_COPY_KEYS: Record<SignInFailure, TranslationKey> =
  {
    [SignInFailures.SIGN_IN_FAILED]: "home.signedOut.signInFailed",
    [SignInFailures.GITHUB_UNAVAILABLE]: "home.signedOut.githubUnavailable",
  };
