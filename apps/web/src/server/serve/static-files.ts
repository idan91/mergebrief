// The built client files, read and compressed once at boot. srvx's own static
// middleware recompresses every asset at brotli's maximum quality per request
// and sends no validator; this serves the same bytes from memory instead.
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative, sep } from "node:path";
import { promisify } from "node:util";
import { brotliCompress, constants, gzip } from "node:zlib";
import { FastResponse, type ServerMiddleware } from "srvx";
import {
  BROTLI_QUALITY,
  COMPRESSIBLE_TYPES,
  CONTENT_TYPES,
  ETAG_HASH_LENGTH,
  FALLBACK_CONTENT_TYPE,
  HASHED_ASSET_PREFIX,
  HASHED_ASSET_CACHE_CONTROL,
  NOT_MODIFIED_STATUS,
  REVALIDATE_CACHE_CONTROL,
} from "./consts";
import { readAcceptedCodings } from "../accept-encoding";
import { MIN_COMPRESSED_BYTES } from "../consts";
import { type ReplyCoding, ReplyCodings } from "../types";

const compressBrotli = promisify(brotliCompress);
const compressGzip = promisify(gzip);
const SERVED_METHODS = new Set(["GET", "HEAD"]);

/** Bytes a Response takes as they are, with no per-request copy. */
type FileBytes = Uint8Array<ArrayBuffer>;

export interface StaticFile {
  readonly body: FileBytes;
  readonly brotli?: FileBytes;
  readonly gzip?: FileBytes;
  readonly etag: string;
  readonly contentType: string;
  readonly cacheControl: string;
}

/** Served pathname, `/assets/app-abc123.js`, to its prepared bytes. */
export type StaticFiles = ReadonlyMap<string, StaticFile>;

async function prepareFile(
  pathname: string,
  read: Buffer,
): Promise<StaticFile> {
  const body: FileBytes = new Uint8Array(read);
  const extension = extname(pathname);
  const contentType = CONTENT_TYPES.get(extension) ?? FALLBACK_CONTENT_TYPE;
  const hash = createHash("sha256").update(body);
  const digest = hash.digest("base64url");
  const etag = `"${digest.slice(0, ETAG_HASH_LENGTH)}"`;
  const isHashedAsset = pathname.startsWith(HASHED_ASSET_PREFIX);
  const cacheControl = isHashedAsset
    ? HASHED_ASSET_CACHE_CONTROL
    : REVALIDATE_CACHE_CONTROL;
  const file: StaticFile = { body, etag, contentType, cacheControl };

  const worthCompressing =
    COMPRESSIBLE_TYPES.has(extension) && body.length >= MIN_COMPRESSED_BYTES;
  if (!worthCompressing) {
    return file;
  }
  const [brotli, gzipped] = await Promise.all([
    compressBrotli(body, {
      params: { [constants.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY },
    }),
    compressGzip(body),
  ]);
  return {
    ...file,
    brotli: new Uint8Array(brotli),
    gzip: new Uint8Array(gzipped),
  };
}

export async function indexStaticFiles(dir: string): Promise<StaticFiles> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile());

  const prepared = await Promise.all(
    files.map(async (entry) => {
      const absolute = join(entry.parentPath, entry.name);
      const segments = relative(dir, absolute).split(sep);
      const pathname = `/${segments.join("/")}`;
      const read = await readFile(absolute);
      const file = await prepareFile(pathname, read);
      return [pathname, file] as const;
    }),
  );
  return new Map(prepared);
}

interface ChosenBody {
  readonly body: FileBytes;
  readonly etag: string;
  readonly encoding?: ReplyCoding;
}

/** Each coding is its own representation, so each carries its own validator. */
function pickEncoding(file: StaticFile, acceptEncoding: string): ChosenBody {
  const quoted = file.etag.slice(0, -1);
  const accepted = readAcceptedCodings(acceptEncoding);
  const { brotli, gzip: gzipped } = file;
  const sendsBrotli = brotli !== undefined && accepted.has(ReplyCodings.BROTLI);
  if (sendsBrotli) {
    return {
      body: brotli,
      etag: `${quoted}-${ReplyCodings.BROTLI}"`,
      encoding: ReplyCodings.BROTLI,
    };
  }
  const sendsGzip = gzipped !== undefined && accepted.has(ReplyCodings.GZIP);
  if (sendsGzip) {
    return {
      body: gzipped,
      etag: `${quoted}-${ReplyCodings.GZIP}"`,
      encoding: ReplyCodings.GZIP,
    };
  }
  return { body: file.body, etag: file.etag };
}

function matchesValidator(ifNoneMatch: string | null, etag: string): boolean {
  if (ifNoneMatch === null) {
    return false;
  }
  const candidates = ifNoneMatch.split(",").map((entry) => entry.trim());
  return candidates.some((candidate) => candidate.replace(/^W\//, "") === etag);
}

export function serveStaticFiles(files: StaticFiles): ServerMiddleware {
  return (request, next) => {
    if (!SERVED_METHODS.has(request.method)) {
      return next();
    }
    const { pathname } = new URL(request.url);
    const file = files.get(pathname);
    if (file === undefined) {
      return next();
    }

    const acceptEncoding = request.headers.get("accept-encoding") ?? "";
    const chosen = pickEncoding(file, acceptEncoding);
    const headers: Record<string, string> = {
      "content-type": file.contentType,
      "cache-control": file.cacheControl,
      etag: chosen.etag,
    };
    if (file.brotli !== undefined) {
      headers["vary"] = "accept-encoding";
    }
    const ifNoneMatch = request.headers.get("if-none-match");
    if (matchesValidator(ifNoneMatch, chosen.etag)) {
      return new FastResponse(null, { status: NOT_MODIFIED_STATUS, headers });
    }

    if (chosen.encoding !== undefined) {
      headers["content-encoding"] = chosen.encoding;
    }
    headers["content-length"] = String(chosen.body.length);
    // FastResponse hands the stored bytes to the socket as they are; a plain
    // Response would copy them twice and stream them chunk by chunk.
    const body = request.method === "HEAD" ? null : chosen.body;
    return new FastResponse(body, { headers });
  };
}
