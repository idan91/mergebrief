import { GITHUB_HOST, RAW_CONTENT_HOST } from "brief-core/media-address";
import type { Result } from "types/utils";

const HTTPS_PROTOCOL = "https:";
const GITHUB_LINK_HOSTS: ReadonlySet<string> = new Set([
  GITHUB_HOST,
  RAW_CONTENT_HOST,
]);

function parseAddress(address: string): Result<URL, undefined> {
  try {
    return { ok: true, value: new URL(address) };
  } catch {
    return { ok: false, error: undefined };
  }
}

/**
 * The original address as a link, only when it is an https address on a
 * GitHub host with nothing beyond host and path a reader would miss: an
 * outside host never gets an "Open on GitHub" link.
 */
export function buildGitHubOriginalLink(address: string): string | undefined {
  const parsed = parseAddress(address);
  if (!parsed.ok || parsed.value.protocol !== HTTPS_PROTOCOL) {
    return undefined;
  }
  const url = parsed.value;
  const hasCredentials = url.username !== "" || url.password !== "";
  const isGitHubHost = GITHUB_LINK_HOSTS.has(url.hostname);
  if (hasCredentials || url.port !== "" || !isGitHubHost) {
    return undefined;
  }

  return url.href;
}
