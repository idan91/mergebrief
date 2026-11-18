import { z } from "zod/v4";

export const RETURN_TO_MAX_LENGTH = 2048;

const API_PATH = "/api";
const RESOLUTION_ORIGIN = "https://return-to.invalid";

// ASCII allowlist: no whitespace, control character or backslash anywhere, a
// second leading slash refused, and no `%` before the query, so no later
// decode can turn the path into `//`, `\` or a dot segment.
const RETURN_PATH_PATTERN =
  /^\/(?!\/)[A-Za-z0-9\-._~!$&'()*+,;=:@/]*(?:\?[A-Za-z0-9\-._~!$&'()*+,;=:@/?%]*)?(?:#[A-Za-z0-9\-._~!$&'()*+,;=:@/?%]*)?$/;

/** A same-origin app path a sign-in may land on; never a route into the API. */
export function isSafeReturnPath(value: string): boolean {
  if (value.length > RETURN_TO_MAX_LENGTH) {
    return false;
  }
  if (!RETURN_PATH_PATTERN.test(value)) {
    return false;
  }

  const resolved = new URL(value, RESOLUTION_ORIGIN);
  if (resolved.origin !== RESOLUTION_ORIGIN) {
    return false;
  }
  // A dot segment can still resolve to `//`, which a later hop may read as a host.
  if (resolved.pathname.startsWith("//")) {
    return false;
  }
  return !isApiPath(resolved.pathname);
}

function isApiPath(pathname: string): boolean {
  const lowered = pathname.toLowerCase();
  if (lowered === API_PATH) {
    return true;
  }
  return lowered.startsWith(`${API_PATH}/`);
}

export const returnToSchema = z.string().refine(isSafeReturnPath);
