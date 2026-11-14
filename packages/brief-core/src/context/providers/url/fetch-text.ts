import {
  Agent as HttpAgent,
  get as httpGet,
  type IncomingHttpHeaders,
} from "node:http";
import { Agent as HttpsAgent, get as httpsGet } from "node:https";
import type { LookupFunction } from "node:net";
import { MAX_SNIPPET_CHARS } from "../../types";
import { truncateToCodeUnits } from "../../utils";
import { LINK_TIMEOUT_MS, TEXT_MEDIA_TYPE } from "./consts";
import type { FetchTextResult } from "./types";

// Own agents: node's env proxy rides only the global ones and would resolve
// the target past the validating lookup. These pools hold only its sockets.
const HTTP_LINK_AGENT = new HttpAgent();
const HTTPS_LINK_AGENT = new HttpsAgent();

/** Why a 2xx body is not read as text; undefined when it is. */
function findUnreadableBodyReason(
  headers: IncomingHttpHeaders,
): string | undefined {
  const encoding = headers["content-encoding"]?.trim().toLowerCase();
  if (encoding !== undefined && encoding !== "" && encoding !== "identity") {
    return "encoded body";
  }
  const [mediaType = ""] = (headers["content-type"] ?? "").split(";");
  const normalizedMediaType = mediaType.trim().toLowerCase();
  if (!TEXT_MEDIA_TYPE.test(normalizedMediaType)) {
    return "non-text content type";
  }
  return undefined;
}

/**
 * GET a URL's body as text, validating the connection address at connect time
 * (closes DNS-rebinding TOCTOU) and not following redirects (a 3xx is treated
 * as a skip, so a public URL can't bounce us to an internal one). Only a
 * text-like, unencoded body is read; anything else is dropped unread. A longer
 * body is cut at MAX_SNIPPET_CHARS, not dropped.
 */
export function fetchText(
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
          // Covers a 3xx, which is never followed. Destroyed, not drained: a
          // body that never ends would hold the socket for good.
          resolve({ error: `HTTP ${status}` });
          req.destroy();
          return;
        }
        const unreadable = findUnreadableBodyReason(res.headers);
        if (unreadable !== undefined) {
          resolve({ error: unreadable });
          req.destroy(); // no byte of a body we will not read
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
            // Resolve first: destroying fires `aborted`, never `end`.
            resolve({ text: truncateToCodeUnits(body, MAX_SNIPPET_CHARS) });
            req.destroy();
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
