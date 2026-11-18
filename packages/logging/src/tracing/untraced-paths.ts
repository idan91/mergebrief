import { UNTRACED_PATHS } from "./consts";
import { stripUrlQuery } from "./url-query";

/** Whether an inbound request target opens no OTel span: a probe, or a path
 * under a prefix the app named (web's static assets). */
export function isUntracedPath(
  target: string,
  untracedPathPrefixes: readonly string[],
): boolean {
  const path = stripUrlQuery(target);
  if (UNTRACED_PATHS.has(path)) {
    return true;
  }
  return untracedPathPrefixes.some((prefix) => path.startsWith(prefix));
}
