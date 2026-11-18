import type { LookupBounds } from "./types";

/** Bound how many links we chase per PR; cost and latency control. */
export const MAX_LINKS = 5;
export const LINK_TIMEOUT_MS = 10_000;

/** Per query; c-ares backs off across tries and nameservers. */
export const DNS_QUERY_TIMEOUT_MS = 1_500;
export const DNS_QUERY_TRIES = 2;

/**
 * Across one lookup, the backstop over c-ares' own budget; the cap bounds
 * how many a provider keeps in flight across concurrent jobs.
 */
export const LINK_LOOKUP_BOUNDS: LookupBounds = {
  timeoutMs: 5_000,
  maxConcurrent: 8,
};

/** The c-ares cancel lands this far inside the lookup bound, so the answers it settles still reach the caller. */
export const DNS_CANCEL_MARGIN_MS = 500;
/** How long the other family may still answer once one has answered with addresses. */
export const DNS_FAMILY_GRACE_MS = 250;

export const URL_IN_TEXT = /https?:\/\/[^\s<>()[\]"']+/g;

/** The ports a link may name; a scheme's default counts as named. */
export const LINK_PORTS: ReadonlySet<number> = new Set([80, 443]);

export const DEFAULT_PORT_BY_PROTOCOL: Readonly<Record<string, number>> = {
  "http:": 80,
  "https:": 443,
};

/** `text/*`, JSON and XML, with or without a structured-syntax suffix. */
export const TEXT_MEDIA_TYPE =
  /^(?:text\/[a-z0-9.+-]+|application\/(?:json|xml|[a-z0-9.-]+\+(?:json|xml)))$/;

/** A page a browser would render, whose markup holds more than its text. */
export const HTML_MEDIA_TYPE = /^(?:text\/html|application\/xhtml\+xml)$/;
