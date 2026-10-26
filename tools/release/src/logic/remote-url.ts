import { type ParsedArgv, readValuedFlag } from "./argv";

// Greedy up to the last `@` before the path, so a password holding `@` is
// redacted whole.
const URL_USERINFO = /:\/\/[^/\s]+@/;
const URL_USERINFO_ALL = new RegExp(URL_USERINFO.source, "g");
const REDACTED_USERINFO = "://<redacted>@";

/** The export flags that name a git remote by URL. */
export const REMOTE_FLAGS = ["--public-remote"] as const;

/** `scheme://user:secret@host` or `scheme://token@host`. */
export function hasUrlCredentials(url: string): boolean {
  return URL_USERINFO.test(url);
}

export function redactUrlCredentials(text: string): string {
  return text.replace(URL_USERINFO_ALL, REDACTED_USERINFO);
}

/** The first remote flag whose URL carries credentials; a caller names the flag, never the URL. */
export function findCredentialedRemoteFlag(
  parsed: ParsedArgv,
): string | undefined {
  return REMOTE_FLAGS.find((flag) => {
    const url = readValuedFlag(parsed, flag);
    const credentialed = url !== undefined && hasUrlCredentials(url);
    return credentialed;
  });
}
