import "@tanstack/react-start/server-only";

import { Duplex } from "node:stream";
import { constants, createBrotliCompress, createGzip } from "node:zlib";
import { HttpStatuses } from "types";
import { readAcceptedCodings } from "./accept-encoding";
import { MIN_COMPRESSED_BYTES } from "./consts";
import { type ReplyCoding, ReplyCodings } from "./types";

/** Best first. */
const CODING_PREFERENCE: readonly ReplyCoding[] = [
  ReplyCodings.BROTLI,
  ReplyCodings.GZIP,
];
/** HTML documents, API JSON and the diff reads' text; media carries its own coding. */
const COMPRESSIBLE_TYPE =
  /^(?:text\/(?:html|plain)|application\/(?:[\w.-]+\+)?json)(?:;|$)/i;
/** Compressed per request, so a faster setting than the boot-time one pays. */
const BROTLI_STREAM_QUALITY = 4;
const NO_TRANSFORM = /(?:^|,)\s*no-transform\s*(?:,|$)/i;
const FETCH_SITE_HEADER = "sec-fetch-site";
/** What a browser sends for a request this origin or the user started. */
const FIRST_PARTY_FETCH_SITES = new Set(["same-origin", "none"]);
/** Every request header the coding decision reads. */
const DECISION_HEADERS = ["accept-encoding", FETCH_SITE_HEADER, "cookie"];

type ReplyCompressor = ReturnType<typeof Duplex.toWeb>;

/**
 * Each written chunk is flushed, so a streamed document's head reaches the
 * browser when the render writes it and not when a compression block fills.
 */
function buildCompressor(coding: ReplyCoding): ReplyCompressor {
  if (coding === ReplyCodings.BROTLI) {
    const brotli = createBrotliCompress({
      flush: constants.BROTLI_OPERATION_FLUSH,
      params: { [constants.BROTLI_PARAM_QUALITY]: BROTLI_STREAM_QUALITY },
    });
    return Duplex.toWeb(brotli);
  }
  return Duplex.toWeb(createGzip({ flush: constants.Z_SYNC_FLUSH }));
}

function isBelowMinimum(headers: Headers): boolean {
  const length = headers.get("content-length");
  if (length === null) {
    return false;
  }
  const isBelowMinimumLength = Number(length) < MIN_COMPRESSED_BYTES;
  return isBelowMinimumLength;
}

/** A byte range or an encoded body is exact bytes the client asked for. */
function isCompressible(reply: Response): boolean {
  const { headers } = reply;
  const contentType = headers.get("content-type") ?? "";
  if (!COMPRESSIBLE_TYPE.test(contentType.trim())) {
    return false;
  }
  const isPartial =
    reply.status === HttpStatuses.PARTIAL_CONTENT ||
    headers.has("content-range");
  if (isPartial || headers.has("content-encoding")) {
    return false;
  }
  if (NO_TRANSFORM.test(headers.get("cache-control") ?? "")) {
    return false;
  }
  return !isBelowMinimum(headers);
}

/**
 * Whether another site could have made the browser send this request with the
 * viewer's cookie. No `Sec-Fetch-Site` and no cookie is a token client.
 */
function isCrossSiteInducible(headers: Headers): boolean {
  const fetchSite = headers.get(FETCH_SITE_HEADER);
  if (fetchSite === null) {
    return headers.has("cookie");
  }
  return !FIRST_PARTY_FETCH_SITES.has(fetchSite);
}

function pickCoding(request: Request): ReplyCoding | undefined {
  if (isCrossSiteInducible(request.headers)) {
    return undefined;
  }
  const accepted = readAcceptedCodings(
    request.headers.get("accept-encoding") ?? "",
  );
  return CODING_PREFERENCE.find((coding) => accepted.has(coding));
}

function appendVary(headers: Headers): void {
  const vary = headers.get("vary") ?? "";
  const listed = vary.split(",").map((name) => name.trim().toLowerCase());
  const names = new Set(listed);
  if (names.has("*")) {
    return;
  }
  for (const name of DECISION_HEADERS) {
    if (!names.has(name)) {
      headers.append("vary", name);
    }
  }
}

/**
 * A text reply in the best coding the client accepts, but only for a request
 * no other site can induce: a compressed length beside the viewer's private
 * data tells a cross-site page whether its guess matched (BREACH). A reply
 * that could have been compressed varies by the decision's headers either way.
 */
export function compressReply(request: Request, reply: Response): Response {
  const { body } = reply;
  const hasCompressibleBody = body !== null && isCompressible(reply);
  if (!hasCompressibleBody) {
    return reply;
  }

  const headers = new Headers(reply.headers);
  appendVary(headers);
  const coding = pickCoding(request);
  if (coding === undefined) {
    return new Response(body, {
      status: reply.status,
      statusText: reply.statusText,
      headers,
    });
  }

  headers.set("content-encoding", coding);
  headers.delete("content-length");
  const compressed = body.pipeThrough(buildCompressor(coding));
  return new Response(compressed, {
    status: reply.status,
    statusText: reply.statusText,
    headers,
  });
}
