import { SignInFailures, type SignInFailure } from "contract";
import type { TranslationKey } from "i18n";

import { CONFIG_FILE } from "@web/utils/instance-config";

export const SIGN_IN_FAILURE_COPY_KEYS: Record<SignInFailure, TranslationKey> =
  {
    [SignInFailures.SIGN_IN_FAILED]: "home.signedOut.signInFailed",
    [SignInFailures.GITHUB_UNAVAILABLE]: "home.signedOut.githubUnavailable",
    [SignInFailures.NOT_ALLOWED]: "home.signedOut.accountNotAllowed",
  };

/** The config key that lists the GitHub ids allowed to sign in. */
const OPERATORS_KEY = "operators";

/** Prints a GitHub account's numeric id; the reader puts in their own login. */
// oxlint-disable-next-line house/no-shout-case-copy -- a shell command, run as written, never translated
const GITHUB_ID_COMMAND = "gh api users/YOUR_LOGIN --jq .id";

/** The `<0/>` to `<2/>` slots of the owner line: the config key, the file and the id command. */
export const OWNER_SETUP_CODE = [
  <code key="operators">{OPERATORS_KEY}</code>,
  <code key="file">{CONFIG_FILE}</code>,
  <code key="command">{GITHUB_ID_COMMAND}</code>,
];
