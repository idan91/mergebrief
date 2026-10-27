import { BlockList, isIP, type LookupFunction } from "node:net";
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { Agent as HttpAgent, get as httpGet } from "node:http";
import { Agent as HttpsAgent, get as httpsGet } from "node:https";
import type { Result } from "types/utils";
import { trimTrailingPunctuation } from "../embedded-urls";
import { canonicalizeTicketUrl } from "../references";
import {
  ContextProviderTypes,
  MAX_SNIPPET_CHARS,
  type ContextProvider,
  type ContextProviderDeps,
  type ContextQuery,
  type ContextReadFailure,
  type ProviderSnippet,
} from "../types";

/** Bound how many links we chase per PR; cost and latency control. */
const MAX_LINKS = 5;
const LINK_TIMEOUT_MS = 10_000;

const URL_IN_TEXT = /https?:\/\/[^\s<>()[\]"']+/g;

interface BlockedSubnet {
  readonly prefix: string;
  readonly length: number;
}

const BLOCKED_IPV4_SUBNETS: readonly BlockedSubnet[] = [
  { prefix: "0.0.0.0", length: 8 }, // "this network"; 0.0.0.0 reaches the local host
  { prefix: "10.0.0.0", length: 8 },
  { prefix: "100.64.0.0", length: 10 }, // carrier-grade NAT
  { prefix: "127.0.0.0", length: 8 },
  { prefix: "168.63.129.16", length: 32 }, // Azure WireServer, the platform's host agent
  { prefix: "169.254.0.0", length: 16 }, // link-local incl. cloud metadata 169.254.169.254
  { prefix: "172.16.0.0", length: 12 },
  { prefix: "192.0.0.0", length: 24 }, // IETF protocol assignments
  { prefix: "192.168.0.0", length: 16 },
  { prefix: "198.18.0.0", length: 15 }, // benchmarking
  { prefix: "240.0.0.0", length: 4 }, // reserved, incl. broadcast
];

const BLOCKED_IPV6_SUBNETS: readonly BlockedSubnet[] = [
  { prefix: "::", length: 96 }, // unspecified, loopback and IPv4-compatible ::a.b.c.d
  { prefix: "64:ff9b::", length: 32 }, // NAT64, embeds an IPv4 address
  { prefix: "fc00::", length: 7 }, // unique-local
  { prefix: "fe80::", length: 10 }, // link-local
  { prefix: "fec0::", length: 10 }, // deprecated site-local
];

function buildBlockedAddresses(): BlockList {
  const blocked = new BlockList();
  for (const { prefix, length } of BLOCKED_IPV4_SUBNETS) {
    blocked.addSubnet(prefix, length, "ipv4");
  }
  for (const { prefix, length } of BLOCKED_IPV6_SUBNETS) {
    blocked.addSubnet(prefix, length, "ipv6");
  }
  return blocked;
}

/** An IPv4 rule also matches the IPv4-mapped IPv6 form, in any spelling. */
const BLOCKED_ADDRESSES = buildBlockedAddresses();

function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) {
    return false;
  }
  return BLOCKED_ADDRESSES.check(address, family === 6 ? "ipv6" : "ipv4");
}

/**
 * Synchronous pre-filter for a candidate link. Rejects non-http(s) schemes,
 * embedded credentials (userinfo; almost never a real public reference, and a
 * credential-leak hazard), localhost/`.local`, and blocked IP literals. An IP
 * literal never reaches a lookup, so this is its only gate; a name is checked
 * again at connect time against every resolved address, which closes DNS
 * rebinding.
 */
export function isPublicUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return false;
  }
  if (url.username !== "" || url.password !== "") {
    return false;
  }
  const host = url.hostname.replace(/^\[|\]$/g, ""); // unwrap [::1]
  if (host === "localhost" || host.endsWith(".local")) {
    return false;
  }
  if (isBlockedAddress(host)) {
    return false;
  }
  return true;
}

/** Every A/AAAA record for a name: `dns.lookup` with `all: true` in production. */
export type AddressResolver = (
  hostname: string,
  callback: (
    error: NodeJS.ErrnoException | null,
    addresses: LookupAddress[],
  ) => void,
) => void;

function resolveAllAddresses(
  hostname: string,
  callback: Parameters<AddressResolver>[1],
): void {
  dnsLookup(hostname, { all: true }, callback);
}

function makeBlockedAddressError(address: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`blocked private address ${address}`), {
    code: "ESSRFBLOCKED",
  });
}

/**
 * A `dns.lookup`-shaped function that refuses a name when any of its records
 * is blocked, then answers in the form node asked for: every record under
 * `all` (node 24's family autoselection), else the first. The socket connects
 * only to an address this check saw.
 */
export function createValidatingLookup(
  resolve: AddressResolver,
): LookupFunction {
  return (hostname, options, callback) => {
    resolve(hostname, (error, addresses) => {
      if (error) {
        callback(error, "", 0);
        return;
      }
      const blocked = addresses.find((record) =>
        isBlockedAddress(record.address),
      );
      if (blocked) {
        callback(makeBlockedAddressError(blocked.address), "", 0);
        return;
      }
      const first = addresses[0];
      if (!first) {
        callback(new Error("no address"), "", 0);
        return;
      }
      if (options.all === true) {
        callback(null, addresses);
        return;
      }
      callback(null, first.address, first.family);
    });
  };
}

// Own agents: node's env proxy rides only the global ones and would resolve
// the target past the validating lookup. These pools hold only its sockets.
const HTTP_LINK_AGENT = new HttpAgent();
const HTTPS_LINK_AGENT = new HttpsAgent();

/** Strip credentials from a URL for safe logging/display; redact if unparseable. */
function displayUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.username = "";
    u.password = "";
    return u.toString();
  } catch {
    return "<unparseable-url>";
  }
}

type FetchTextResult = { text: string } | { error: string };

/**
 * GET a URL's body as text, validating the connection address at connect time
 * (closes DNS-rebinding TOCTOU) and not following redirects (a 3xx is treated
 * as a skip, so a public URL can't bounce us to an internal one). Body is
 * capped at MAX_SNIPPET_CHARS.
 */
function fetchText(
  rawUrl: string,
  signal: AbortSignal,
  lookup: LookupFunction,
): Promise<FetchTextResult> {
  return new Promise((resolve) => {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      resolve({ error: "malformed URL" });
      return;
    }
    const isHttps = url.protocol === "https:";
    const get = isHttps ? httpsGet : httpGet;
    const agent = isHttps ? HTTPS_LINK_AGENT : HTTP_LINK_AGENT;
    const req = get(
      rawUrl,
      { agent, lookup, timeout: LINK_TIMEOUT_MS, signal },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status < 200 || status >= 300) {
          res.resume(); // drain & discard; covers 3xx (we do not follow)
          resolve({ error: `HTTP ${status}` });
          return;
        }
        res.setEncoding("utf8");
        let body = "";
        res.on("data", (chunk: string) => {
          if (body.length >= MAX_SNIPPET_CHARS) {
            return;
          }
          body += chunk;
          if (body.length >= MAX_SNIPPET_CHARS) {
            body = body.slice(0, MAX_SNIPPET_CHARS);
            req.destroy(); // stop reading once we have enough
          }
        });
        res.on("end", () => resolve({ text: body }));
        res.on("error", (e) => resolve({ error: e.message }));
      },
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", (e: NodeJS.ErrnoException) =>
      resolve({
        error: e.code === "ESSRFBLOCKED" ? "private address" : e.message,
      }),
    );
  });
}

/** Distinct http(s) URLs in the PR description, trimmed of trailing punctuation and emphasis delimiters. */
export function extractLinks(body: string): string[] {
  const seen = new Set<string>();
  for (const raw of body.match(URL_IN_TEXT) ?? []) {
    const url = trimTrailingPunctuation(raw);
    if (!seen.has(url)) {
      seen.add(url);
    }
  }
  return [...seen].slice(0, MAX_LINKS);
}

/**
 * Fetch the text behind each link in the PR description. Best-effort: any
 * failure (network, non-OK status, timeout, binary body, SSRF block) is logged
 * and skipped; a brief must still be producible from the diff alone. URLs are
 * credential-stripped before they reach a log line or the stored context.
 */
async function fetchUrlSnippets(
  query: ContextQuery,
  deps: ContextProviderDeps,
  lookup: LookupFunction,
): Promise<Result<ProviderSnippet[], ContextReadFailure>> {
  const { log, signal } = deps;
  // The primary ticket is the tracker provider's read; never fetch it twice.
  const primaryUrl = query.primary?.url;
  const urls = extractLinks(query.body).filter(
    (url) => canonicalizeTicketUrl(url) !== primaryUrl,
  );
  const results = await Promise.all(
    urls.map(async (url): Promise<ProviderSnippet | null> => {
      const shown = displayUrl(url);
      if (!isPublicUrl(url)) {
        log(
          `linked context: ${shown} blocked (non-public or credentialed), skipping`,
        );
        return null;
      }
      const result = await fetchText(url, signal, lookup);
      if ("error" in result) {
        log(`linked context: ${shown} failed (${result.error}), skipping`);
        return null;
      }
      log(`linked context: fetched ${shown} (${result.text.length} chars)`);
      return {
        providerId: ContextProviderTypes.URL,
        source: shown,
        text: result.text,
      };
    }),
  );
  return {
    ok: true,
    value: results.filter((r): r is ProviderSnippet => r !== null),
  };
}

export interface UrlContextProviderOptions {
  readonly resolveAddresses?: AddressResolver;
}

/** The built-in provider: plain HTTP behind the URLs in the PR description. */
export function createUrlContextProvider(
  options: UrlContextProviderOptions = {},
): ContextProvider {
  const lookup = createValidatingLookup(
    options.resolveAddresses ?? resolveAllAddresses,
  );
  return {
    providerId: ContextProviderTypes.URL,
    fetch: (query, deps) => fetchUrlSnippets(query, deps, lookup),
  };
}
