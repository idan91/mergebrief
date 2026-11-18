import type { Context } from "@opentelemetry/api";
import type {
  ReadableSpan,
  Span,
  SpanProcessor,
} from "@opentelemetry/sdk-trace";
import {
  ATTR_CLIENT_ADDRESS,
  ATTR_NETWORK_PEER_ADDRESS,
  ATTR_URL_FULL,
  ATTR_URL_QUERY,
  ATTR_USER_AGENT_ORIGINAL,
} from "@opentelemetry/semantic-conventions";
import { REDACTED_VALUE } from "./consts";
import { stripUrlQuery } from "./url-query";

// `http.url`, `http.target`, `http.user_agent`, `http.client_ip` and
// `net.peer.ip` are the pre-stable names older instrumentation releases
// emitted; the pinned ones do not, and these stay so a downgrade cannot leak.
const URL_ATTRIBUTES = [ATTR_URL_FULL, "http.url", "http.target"] as const;
const PERSONAL_ATTRIBUTES = [
  ATTR_URL_QUERY,
  ATTR_USER_AGENT_ORIGINAL,
  ATTR_CLIENT_ADDRESS,
  ATTR_NETWORK_PEER_ADDRESS,
  "http.user_agent",
  "http.client_ip",
  "net.peer.ip",
] as const;

/**
 * Rewrites what the http and undici instrumentations set at start, before
 * any span ends and reaches an exporter: URLs lose their query (the OAuth
 * callback carries `code` and `state` there), and the user agent and the
 * client's address, which they read from headers, are redacted.
 */
export function createSpanRedactor(): SpanProcessor {
  return {
    onStart(span: Span, _parentContext: Context): void {
      for (const key of URL_ATTRIBUTES) {
        const value = span.attributes[key];
        if (typeof value === "string") {
          span.setAttribute(key, stripUrlQuery(value));
        }
      }
      for (const key of PERSONAL_ATTRIBUTES) {
        const value = span.attributes[key];
        if (typeof value === "string" && value !== "") {
          span.setAttribute(key, REDACTED_VALUE);
        }
      }
    },
    onEnd(_span: ReadableSpan): void {},
    forceFlush: async () => {},
    shutdown: async () => {},
  };
}
