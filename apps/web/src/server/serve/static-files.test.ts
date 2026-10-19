import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import type { ServerRequest } from "srvx";
import { beforeAll, describe, expect, it } from "vitest";
import { ETAG_HASH_LENGTH } from "./consts";
import {
  indexStaticFiles,
  readAcceptedCodings,
  serveStaticFiles,
  type StaticFiles,
} from "./static-files";

/** Past the compression floor, so the file is stored compressed. */
const LARGE_FILE_BYTES = 4096;
const SCRIPT = `export const answer = "${"x".repeat(LARGE_FILE_BYTES)}";`;
const STRONG_ETAG = new RegExp(`^"[\\w-]{${ETAG_HASH_LENGTH}}"$`);

let files: StaticFiles;

beforeAll(async () => {
  const prefix = join(tmpdir(), "static-files-");
  const dir = mkdtempSync(prefix);
  mkdirSync(join(dir, "assets"));
  writeFileSync(join(dir, "assets", "app-abc123.js"), SCRIPT);
  writeFileSync(
    join(dir, "assets", "font-abc123.woff2"),
    Buffer.alloc(LARGE_FILE_BYTES, 1),
  );
  writeFileSync(join(dir, "favicon.svg"), "<svg/>");
  files = await indexStaticFiles(dir);
});

/** The middleware's answer, or undefined when it passed the request on. */
async function requestFile(
  path: string,
  init: RequestInit = {},
): Promise<Response | undefined> {
  const request = new Request(`http://localhost${path}`, init);
  let passed = false;
  const middleware = serveStaticFiles(files);
  const response = await middleware(request as ServerRequest, () => {
    passed = true;
    return new Response(null);
  });
  if (passed) {
    return undefined;
  }
  return response;
}

/** The middleware's answer for a file it must serve. */
async function requireFile(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const response = await requestFile(path, init);
  if (response === undefined) {
    throw new Error(`${path} passed to the next handler`);
  }
  return response;
}

describe("indexStaticFiles", () => {
  it("keys each file by the pathname a browser asks for", () => {
    const pathnames = [...files.keys()].toSorted();
    expect(pathnames).toEqual([
      "/assets/app-abc123.js",
      "/assets/font-abc123.woff2",
      "/favicon.svg",
    ]);
  });
});

describe("serveStaticFiles", () => {
  it("serves a hashed asset as immutable with a strong validator", async () => {
    const reply = await requireFile("/assets/app-abc123.js");

    expect(reply.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(reply.headers.get("etag")).toMatch(STRONG_ETAG);
    expect(await reply.text()).toBe(SCRIPT);
  });

  it("revalidates a file outside the hashed assets", async () => {
    const reply = await requireFile("/favicon.svg");

    expect(reply.headers.get("cache-control")).toBe("no-cache");
  });

  it("sends the gzip bytes compressed once at boot", async () => {
    const reply = await requireFile("/assets/app-abc123.js", {
      headers: { "accept-encoding": "gzip" },
    });

    expect(reply.headers.get("content-encoding")).toBe("gzip");
    const body = Buffer.from(await reply.arrayBuffer());
    const unzipped = gunzipSync(body).toString();
    expect(unzipped).toBe(SCRIPT);
  });

  it("prefers brotli when the browser takes it", async () => {
    const reply = await requireFile("/assets/app-abc123.js", {
      headers: { "accept-encoding": "gzip, deflate, br" },
    });

    expect(reply.headers.get("content-encoding")).toBe("br");
    expect(reply.headers.get("vary")).toBe("accept-encoding");
    expect(reply.headers.get("etag")).toMatch(/-br"$/);
  });

  it("leaves a font uncompressed", async () => {
    const reply = await requireFile("/assets/font-abc123.woff2", {
      headers: { "accept-encoding": "br" },
    });

    expect(reply.headers.get("content-encoding")).toBeNull();
    expect(reply.headers.get("content-type")).toBe("font/woff2");
  });

  it("answers a matching validator with 304 and no body", async () => {
    const first = await requireFile("/assets/app-abc123.js");
    const etag = first.headers.get("etag") ?? "";

    const reply = await requireFile("/assets/app-abc123.js", {
      headers: { "if-none-match": etag },
    });

    expect(reply.status).toBe(304);
    expect(await reply.text()).toBe("");
  });

  it("matches a validator inside a list or weakened by a proxy", async () => {
    const first = await requireFile("/assets/app-abc123.js");
    const etag = first.headers.get("etag") ?? "";

    const reply = await requireFile("/assets/app-abc123.js", {
      headers: { "if-none-match": `"other", W/${etag}` },
    });

    expect(reply.status).toBe(304);
  });

  it("passes an unknown path and a non-GET method to the next handler", async () => {
    const unknownPath = await requestFile("/repos/1/pulls/2");
    const posted = await requestFile("/assets/app-abc123.js", {
      method: "POST",
      body: "x",
    });

    expect(unknownPath).toBeUndefined();
    expect(posted).toBeUndefined();
  });
});

describe("readAcceptedCodings", () => {
  it("keeps every listed coding and drops one weighted q=0", () => {
    expect(readAcceptedCodings("gzip, br;q=0")).toEqual(new Set(["gzip"]));
    expect(readAcceptedCodings("br;q=0.5, GZIP;q=1.0")).toEqual(
      new Set(["br", "gzip"]),
    );
    expect(readAcceptedCodings("")).toEqual(new Set());
  });
});
