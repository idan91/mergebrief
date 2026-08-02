import { isIP, type LookupFunction } from "node:net";
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { get as httpGet } from "node:http";
import { get as httpsGet } from "node:https";
import type { LinkedContext, Log } from "./types";

/** Cap fetched link bodies so a huge page can't blow up token cost. */
const MAX_LINK_CHARS = 20_000;
/** Bound how many links we chase per PR — cost and latency control. */
const MAX_LINKS = 5;
const LINK_TIMEOUT_MS = 10_000;

const URL_IN_TEXT = /https?:\/\/[^\s<>()[\]"']+/g;

const PRIVATE_IPV4 = [
  /^0\./, // "this network" / unspecified
  /^10\./,
  /^127\./,
  /^169\.254\./, // link-local incl. cloud metadata 169.254.169.254
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
];

function isPrivateAddr(addr: string): boolean {
  const a = addr.toLowerCase();
  if (
    a === "::" || // unspecified
    a === "::1" || // loopback
    a.startsWith("fc") || // unique-local fc00::/7
    a.startsWith("fd") ||
    a.startsWith("fe80") || // link-local
    a.startsWith("64:ff9b:") // NAT64 → embeds an IPv4 we can't see here
  ) {
    return true;
  }
  // IPv4-mapped IPv6 (::ffff:a.b.c.d) collapses to the v4 ranges below.
  const v4 = a.startsWith("::ffff:") ? a.slice("::ffff:".length) : a;
  return PRIVATE_IPV4.some((re) => re.test(v4));
}

/**
 * Synchronous pre-filter for a candidate link. Rejects non-http(s) schemes,
 * embedded credentials (userinfo — almost never a real public reference, and a
 * credential-leak hazard), localhost/`.local`, and literal private IPs. This is
 * a fast gate only; the authoritative SSRF defense is `validatingLookup`, which
 * checks the address at *connect* time and so is immune to DNS-rebinding TOCTOU.
 */
export function isPublicUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  if (url.username !== "" || url.password !== "") return false;
  const host = url.hostname.replace(/^\[|\]$/g, ""); // unwrap [::1]
  if (host === "localhost" || host.endsWith(".local")) return false;
  if (isIP(host) && isPrivateAddr(host)) return false;
  return true;
}

/** A `dns.lookup`-shaped resolver that rejects any private resolved address. */
const validatingLookup: LookupFunction = (hostname, _options, callback) => {
  // `{ all: true }` so a host returning several A/AAAA records can't sneak a
  // private one past us. We connect to exactly the address we validate.
  dnsLookup(hostname, { all: true }, (err, addresses: LookupAddress[]) => {
    if (err) return callback(err, "", 0);
    const blocked = addresses.find((a) => isPrivateAddr(a.address));
    if (blocked) {
      callback(
        Object.assign(new Error(`blocked private address ${blocked.address}`), {
          code: "ESSRFBLOCKED",
        }),
        "",
        0,
      );
      return;
    }
    const first = addresses[0];
    if (!first) return callback(new Error("no address"), "", 0);
    callback(null, first.address, first.family);
  });
};

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
 * capped at MAX_LINK_CHARS.
 */
function fetchText(rawUrl: string): Promise<FetchTextResult> {
  return new Promise((resolve) => {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      resolve({ error: "malformed URL" });
      return;
    }
    const get = url.protocol === "https:" ? httpsGet : httpGet;
    const req = get(
      rawUrl,
      { lookup: validatingLookup, timeout: LINK_TIMEOUT_MS },
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
          if (body.length >= MAX_LINK_CHARS) return;
          body += chunk;
          if (body.length >= MAX_LINK_CHARS) {
            body = body.slice(0, MAX_LINK_CHARS);
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

/** Distinct http(s) URLs in the PR description, trimmed of trailing punctuation. */
export function extractLinks(body: string): string[] {
  const seen = new Set<string>();
  for (const raw of body.match(URL_IN_TEXT) ?? []) {
    const url = raw.replace(/[.,;:]+$/, "");
    if (!seen.has(url)) seen.add(url);
  }
  return [...seen].slice(0, MAX_LINKS);
}

/**
 * Fetch the text behind each link in the PR description. Best-effort: any
 * failure (network, non-OK status, timeout, binary body, SSRF block) is logged
 * and skipped — a brief must still be producible from the diff alone. URLs are
 * credential-stripped before they reach a log line or the stored context.
 *
 * Future: richer extraction (HTML→text), auth'd sources, and private trackers
 * will likely move behind MCP servers / connectors. For now we take whatever a
 * plain GET returns, capped, and treat absence as normal.
 */
export async function fetchLinkedContext(
  body: string,
  log: Log = () => {},
): Promise<LinkedContext[]> {
  const urls = extractLinks(body);
  const results = await Promise.all(
    urls.map(async (url): Promise<LinkedContext | null> => {
      const shown = displayUrl(url);
      if (!isPublicUrl(url)) {
        log(
          `linked context: ${shown} blocked (non-public or credentialed), skipping`,
        );
        return null;
      }
      const result = await fetchText(url);
      if ("error" in result) {
        log(`linked context: ${shown} failed (${result.error}), skipping`);
        return null;
      }
      log(`linked context: fetched ${shown} (${result.text.length} chars)`);
      return { url: shown, content: result.text };
    }),
  );
  return results.filter((r): r is LinkedContext => r !== null);
}
