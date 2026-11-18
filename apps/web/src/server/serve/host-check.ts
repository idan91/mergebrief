// The DNS-rebinding guard `vite preview` used to apply: a request is served
// only under the deployment's own hostname, localhost, or a bare IP. A name
// an attacker controls that resolves to this host is refused.
import { isIP } from "node:net";
import type { ServerMiddleware } from "srvx";
import type { Result } from "types/utils";
import { answerJson } from "../json-answer";
import { FORBIDDEN_STATUS } from "./consts";

const LOCALHOST = "localhost";
const LOCALHOST_SUFFIX = ".localhost";

/** The hostnames a request may name; `PUBLIC_BASE_URL`'s plus localhost. */
export type AllowedHosts = ReadonlySet<string>;

/** An unparseable `PUBLIC_BASE_URL` is a boot error, never an open guard. */
export function parseAllowedHosts(
  publicBaseUrl: string | undefined,
): Result<AllowedHosts, string> {
  const hosts = new Set([LOCALHOST]);
  if (publicBaseUrl === undefined || publicBaseUrl === "") {
    return { ok: true, value: hosts };
  }

  try {
    hosts.add(new URL(publicBaseUrl).hostname);
  } catch {
    return { ok: false, error: "PUBLIC_BASE_URL is not a URL" };
  }
  return { ok: true, value: hosts };
}

function readHostname(host: string): string | undefined {
  try {
    return new URL(`http://${host}`).hostname.replace(/^\[|\]$/g, "");
  } catch {
    return undefined;
  }
}

export function isAllowedHost(
  host: string | null,
  allowed: AllowedHosts,
): boolean {
  if (host === null) {
    return false;
  }
  const hostname = readHostname(host);
  if (hostname === undefined) {
    return false;
  }

  const isLocal = hostname.endsWith(LOCALHOST_SUFFIX);
  const isAddress = isIP(hostname) !== 0;
  const isAllowed = allowed.has(hostname) || isLocal || isAddress;
  return isAllowed;
}

export function rejectForeignHost(allowed: AllowedHosts): ServerMiddleware {
  return (request, next) => {
    const host = request.headers.get("host");
    if (isAllowedHost(host, allowed)) {
      return next();
    }
    return answerJson(FORBIDDEN_STATUS, { error: "forbidden host" });
  };
}
