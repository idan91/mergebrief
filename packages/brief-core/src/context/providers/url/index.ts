import type { LookupFunction } from "node:net";
import { LinkFetchModes, type LinkFetchPolicy } from "generators";
import type { Result } from "types/utils";
import { trimTrailingPunctuation } from "../../embedded-urls";
import { canonicalizeTicketUrl } from "../../references";
import {
  ContextProviderTypes,
  type ContextProvider,
  type ContextProviderDeps,
  type ContextQuery,
  type ContextReadFailure,
  type ProviderSnippet,
} from "../../types";
import {
  LINK_LOOKUP_BOUNDS,
  LINK_PORTS,
  MAX_LINKS,
  URL_IN_TEXT,
} from "./consts";
import { fetchText } from "./fetch-text";
import {
  boundAddressResolver,
  createValidatingLookup,
  isPublicUrl,
  resolveAllAddresses,
} from "./guard";
import type { UrlContextProviderOptions } from "./types";

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

interface LinkFetchDeps {
  readonly lookup: LookupFunction;
  readonly allowedPorts: ReadonlySet<number>;
  readonly policy: LinkFetchPolicy;
  readonly allowedHosts: ReadonlySet<string>;
}

/** Whether the policy lets the fetcher ask for this link's host at all. */
function isPolicyHost(url: string, deps: LinkFetchDeps): boolean {
  if (deps.policy.mode !== LinkFetchModes.ALLOWLIST) {
    return true;
  }
  try {
    return deps.allowedHosts.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

/**
 * Fetch the text behind each link in the PR description. Best-effort: any
 * failure (network, non-OK status, timeout, non-text or encoded body, SSRF
 * block) is logged and skipped; a brief must still be producible from the
 * diff alone. URLs are credential-stripped before they reach a log line or
 * the stored context.
 */
async function fetchUrlSnippets(
  query: ContextQuery,
  deps: ContextProviderDeps,
  linkFetchDeps: LinkFetchDeps,
): Promise<Result<ProviderSnippet[], ContextReadFailure>> {
  const { log, signal } = deps;
  const { lookup, allowedPorts, policy } = linkFetchDeps;
  // The primary ticket is the tracker provider's read; never fetch it twice.
  const primaryUrl = query.primary?.url;
  const urls = extractLinks(query.body).filter(
    (url) => canonicalizeTicketUrl(url) !== primaryUrl,
  );
  if (policy.mode === LinkFetchModes.OFF) {
    if (urls.length > 0) {
      log(`linked context: link fetch is off, skipping ${urls.length}`);
    }
    return { ok: true, value: [] };
  }
  const results = await Promise.all(
    urls.map(async (url): Promise<ProviderSnippet | null> => {
      const shown = displayUrl(url);
      if (!isPolicyHost(url, linkFetchDeps)) {
        log(
          `linked context: ${shown} not on the link fetch allowlist, skipping`,
        );
        return null;
      }
      if (!isPublicUrl(url, allowedPorts)) {
        log(
          `linked context: ${shown} blocked (non-public, credentialed or non-web port), skipping`,
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

/**
 * The built-in provider: plain HTTP behind the URLs in the PR description,
 * narrowed by the instance's link fetch policy. The allowlist only narrows:
 * a listed host still passes every address and port check.
 */
export function createUrlContextProvider(
  options: UrlContextProviderOptions,
): ContextProvider {
  const linkFetchDeps: LinkFetchDeps = {
    lookup: createValidatingLookup(
      boundAddressResolver(
        options.resolveAddresses ?? resolveAllAddresses,
        LINK_LOOKUP_BOUNDS,
      ),
    ),
    allowedPorts: options.allowedPorts ?? LINK_PORTS,
    policy: options.linkFetch,
    allowedHosts: new Set(options.linkFetch.hosts),
  };
  return {
    providerId: ContextProviderTypes.URL,
    fetch: (query, deps) => fetchUrlSnippets(query, deps, linkFetchDeps),
  };
}
