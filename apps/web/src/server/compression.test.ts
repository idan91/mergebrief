import { brotliDecompressSync, constants, gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { compressReply } from "./compression";

const HTML_TYPE = "text/html; charset=utf-8";
const JSON_TYPE = "application/json";
const DIFF_TYPE = "text/plain; charset=utf-8";
/** Every request header the coding decision reads. */
const VARY_ON_DECISION = "accept-encoding, sec-fetch-site, cookie";
const SESSION_COOKIE = "mb_session=opaque";
const DOCUMENT_HEAD = "<!doctype html><html><head><title>Brief</title></head>";
const DOCUMENT = `<!doctype html><html><head><title>Brief</title></head><body>${"<p>chunk</p>".repeat(200)}</body></html>`;

const LARGE_DIFF_FILES = 3000;
const LINES_PER_FILE = 20;
const SYLLABLES = ["ka", "lo", "mir", "sun", "tev", "dra", "pel", "quo", "zin"];
const DIFF_MARKERS = ["+", "-", " "];
const MIN_IDENTIFIER_SYLLABLES = 2;
const EXTRA_IDENTIFIER_SYLLABLES = 3;
const MAX_LITERAL_VALUE = 100_000;
const FIXTURE_SEED = 362;
/** A 3000-file diff: the size whose transfer this hop exists to shrink. */
const MIN_LARGE_DIFF_BYTES = 3_000_000;
/** The gzipped reply must come in under a third of the raw bytes. */
const MAX_GZIP_FRACTION = 1 / 3;
/** The classic ANSI C linear congruential generator. */
const LCG_MULTIPLIER = 1_103_515_245;
const LCG_INCREMENT = 12_345;
const LCG_MODULUS = 2_147_483_648;

/** Seeded so the fixture, and the ratio measured on it, never changes. */
function makeRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * LCG_MULTIPLIER + LCG_INCREMENT) % LCG_MODULUS;
    return state / LCG_MODULUS;
  };
}

function makeIdentifier(random: () => number): string {
  const length =
    MIN_IDENTIFIER_SYLLABLES +
    Math.floor(random() * EXTRA_IDENTIFIER_SYLLABLES);
  let name = "";
  for (let index = 0; index < length; index += 1) {
    name += SYLLABLES[Math.floor(random() * SYLLABLES.length)] ?? "";
  }
  return name;
}

function makeLargeDiff(): string {
  const random = makeRandom(FIXTURE_SEED);
  const files: string[] = [];
  for (let file = 0; file < LARGE_DIFF_FILES; file += 1) {
    const path = `src/${makeIdentifier(random)}/${makeIdentifier(random)}.ts`;
    const lines = [
      `diff --git a/${path} b/${path}`,
      `--- a/${path}`,
      `+++ b/${path}`,
      `@@ -1,${String(LINES_PER_FILE)} +1,${String(LINES_PER_FILE)} @@`,
    ];
    for (let line = 0; line < LINES_PER_FILE; line += 1) {
      const marker =
        DIFF_MARKERS[Math.floor(random() * DIFF_MARKERS.length)] ?? " ";
      const value = Math.floor(random() * MAX_LITERAL_VALUE);
      lines.push(
        `${marker}  const ${makeIdentifier(random)} = ${makeIdentifier(random)}(${makeIdentifier(random)}, ${String(value)});`,
      );
    }
    files.push(lines.join("\n"));
  }
  return `${files.join("\n")}\n`;
}

function makeRequest(
  acceptEncoding?: string,
  extraHeaders: Record<string, string> = {},
): Request {
  const headers = new Headers(extraHeaders);
  if (acceptEncoding !== undefined) {
    headers.set("accept-encoding", acceptEncoding);
  }
  return new Request("http://localhost/repos/7/pulls/12", { headers });
}

function makeReply(
  body: string,
  contentType: string,
  headers: Record<string, string> = {},
): Response {
  return new Response(body, {
    status: 200,
    headers: { "content-type": contentType, ...headers },
  });
}

function decodePartialBrotli(bytes: Buffer): string {
  const options = { finishFlush: constants.BROTLI_OPERATION_FLUSH };
  return brotliDecompressSync(bytes, options).toString();
}

function decodePartialGzip(bytes: Buffer): string {
  return gunzipSync(bytes, { finishFlush: constants.Z_SYNC_FLUSH }).toString();
}

/** Reads a reply whose source never ends until its bytes decode to the head. */
async function readUntilDecoded(
  reply: Response,
  decode: (bytes: Buffer) => string,
): Promise<string> {
  const { body } = reply;
  if (body === null) {
    throw new Error("reply has no body");
  }
  const reader = body.getReader();
  let received = Buffer.alloc(0);
  let decoded = "";
  while (decoded !== DOCUMENT_HEAD) {
    const { value } = await reader.read();
    received = Buffer.concat([received, value ?? Buffer.alloc(0)]);
    decoded = decode(received);
  }
  await reader.cancel();
  return decoded;
}

async function readBytes(reply: Response): Promise<Buffer> {
  return Buffer.from(await reply.arrayBuffer());
}

describe("compressReply", () => {
  it("sends an HTML document as brotli when the browser accepts it", async () => {
    const reply = compressReply(
      makeRequest("gzip, deflate, br"),
      makeReply(DOCUMENT, HTML_TYPE),
    );
    const compressed = await readBytes(reply);

    expect(reply.headers.get("content-encoding")).toBe("br");
    expect(reply.headers.get("vary")).toBe(VARY_ON_DECISION);
    expect(reply.headers.get("content-length")).toBeNull();
    const decoded = brotliDecompressSync(compressed).toString();

    expect(compressed.byteLength).toBeLessThan(DOCUMENT.length);
    expect(decoded).toBe(DOCUMENT);
  });

  it("falls back to gzip when brotli is not accepted", async () => {
    const reply = compressReply(
      makeRequest("gzip, br;q=0"),
      makeReply(DOCUMENT, HTML_TYPE),
    );

    const decoded = gunzipSync(await readBytes(reply)).toString();

    expect(reply.headers.get("content-encoding")).toBe("gzip");
    expect(decoded).toBe(DOCUMENT);
  });

  it.each(["same-origin", "none"])(
    "compresses a request whose Sec-Fetch-Site is %s",
    async (fetchSite) => {
      const reply = compressReply(
        makeRequest("br", {
          "sec-fetch-site": fetchSite,
          cookie: SESSION_COOKIE,
        }),
        makeReply(DOCUMENT, HTML_TYPE),
      );

      expect(reply.headers.get("content-encoding")).toBe("br");
      expect(reply.headers.get("vary")).toBe(VARY_ON_DECISION);
      const decoded = brotliDecompressSync(await readBytes(reply));
      expect(decoded.toString()).toBe(DOCUMENT);
    },
  );

  it.each(["same-site", "cross-site"])(
    "sends identity bytes to a request whose Sec-Fetch-Site is %s",
    async (fetchSite) => {
      const reply = compressReply(
        makeRequest("br", {
          "sec-fetch-site": fetchSite,
          cookie: SESSION_COOKIE,
        }),
        makeReply(DOCUMENT, HTML_TYPE),
      );

      expect(reply.headers.get("content-encoding")).toBeNull();
      expect(reply.headers.get("vary")).toBe(VARY_ON_DECISION);
      expect(await reply.text()).toBe(DOCUMENT);
    },
  );

  it("sends identity bytes to a cookie with no Sec-Fetch-Site", async () => {
    const reply = compressReply(
      makeRequest("br", { cookie: SESSION_COOKIE }),
      makeReply(DOCUMENT, HTML_TYPE),
    );

    expect(reply.headers.get("content-encoding")).toBeNull();
    expect(reply.headers.get("vary")).toBe(VARY_ON_DECISION);
    expect(await reply.text()).toBe(DOCUMENT);
  });

  it("compresses for a client sending neither Sec-Fetch-Site nor cookie", async () => {
    const reply = compressReply(
      makeRequest("br", { authorization: "Bearer token" }),
      makeReply(DOCUMENT, JSON_TYPE),
    );

    expect(reply.headers.get("content-encoding")).toBe("br");
    expect(reply.headers.get("vary")).toBe(VARY_ON_DECISION);
    const decoded = brotliDecompressSync(await readBytes(reply));
    expect(decoded.toString()).toBe(DOCUMENT);
  });

  it("compresses an API JSON reply and drops its length", async () => {
    const json = JSON.stringify({
      rows: Array.from({ length: 1000 }, () => 7),
    });
    const reply = compressReply(
      makeRequest("br"),
      makeReply(json, JSON_TYPE, { "content-length": String(json.length) }),
    );

    expect(reply.headers.get("content-encoding")).toBe("br");
    expect(reply.headers.get("content-length")).toBeNull();
    expect(brotliDecompressSync(await readBytes(reply)).toString()).toBe(json);
  });

  it("gzips a 3000-file PR diff to under a third of its bytes", async () => {
    const diff = makeLargeDiff();
    const rawBytes = new TextEncoder().encode(diff).length;

    const reply = compressReply(
      makeRequest("gzip"),
      makeReply(diff, DIFF_TYPE),
    );
    const compressed = await readBytes(reply);

    expect(rawBytes).toBeGreaterThan(MIN_LARGE_DIFF_BYTES);
    expect(compressed.byteLength).toBeLessThan(rawBytes * MAX_GZIP_FRACTION);
    expect(gunzipSync(compressed).toString()).toBe(diff);
  });

  it("sends identity bytes, still varying, when no coding is accepted", async () => {
    const refused = compressReply(
      makeRequest("br;q=0, gzip;q=0"),
      makeReply(DOCUMENT, HTML_TYPE),
    );
    const silent = compressReply(makeRequest(), makeReply(DOCUMENT, HTML_TYPE));

    expect(refused.headers.get("content-encoding")).toBeNull();
    expect(refused.headers.get("vary")).toBe(VARY_ON_DECISION);
    expect(await refused.text()).toBe(DOCUMENT);
    expect(silent.headers.get("content-encoding")).toBeNull();
    expect(silent.headers.get("vary")).toBe(VARY_ON_DECISION);
  });

  it("adds the decision's headers to a reply that already varies", () => {
    const byOrigin = compressReply(
      makeRequest("br"),
      makeReply(DOCUMENT, HTML_TYPE, { vary: "Origin" }),
    );
    const byCoding = compressReply(
      makeRequest("br"),
      makeReply(DOCUMENT, HTML_TYPE, { vary: "Accept-Encoding" }),
    );

    expect(byOrigin.headers.get("vary")).toBe(`Origin, ${VARY_ON_DECISION}`);
    expect(byCoding.headers.get("vary")).toBe(
      "Accept-Encoding, sec-fetch-site, cookie",
    );
  });

  it("writes each chunk through before the source ends", async () => {
    const encoder = new TextEncoder();
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(DOCUMENT_HEAD));
      },
    });
    const streamed = new Response(source, {
      headers: { "content-type": HTML_TYPE },
    });

    const brotli = compressReply(makeRequest("br"), streamed.clone());
    const gzipped = compressReply(makeRequest("gzip"), streamed.clone());

    expect(await readUntilDecoded(brotli, decodePartialBrotli)).toBe(
      DOCUMENT_HEAD,
    );
    expect(await readUntilDecoded(gzipped, decodePartialGzip)).toBe(
      DOCUMENT_HEAD,
    );
  });

  it("leaves a reply under the minimum size as it came", () => {
    const small = makeReply("{}", JSON_TYPE, { "content-length": "2" });

    expect(compressReply(makeRequest("br"), small)).toBe(small);
  });

  it("leaves media as it came", () => {
    const image = makeReply("bytes", "image/webp");
    const video = makeReply("bytes", "video/mp4");

    expect(compressReply(makeRequest("br"), image)).toBe(image);
    expect(compressReply(makeRequest("br"), video)).toBe(video);
  });

  it("leaves a byte range as it came", () => {
    const partial = new Response(DOCUMENT, {
      status: 206,
      headers: { "content-type": DIFF_TYPE },
    });
    const ranged = makeReply(DOCUMENT, DIFF_TYPE, {
      "content-range": "bytes 0-9/100",
    });

    expect(compressReply(makeRequest("br"), partial)).toBe(partial);
    expect(compressReply(makeRequest("br"), ranged)).toBe(ranged);
  });

  it("leaves an encoded or no-transform reply as it came", () => {
    const encoded = makeReply(DOCUMENT, HTML_TYPE, {
      "content-encoding": "gzip",
    });
    const pinned = makeReply(DOCUMENT, HTML_TYPE, {
      "cache-control": "no-store, no-transform",
    });

    expect(compressReply(makeRequest("br"), encoded)).toBe(encoded);
    expect(compressReply(makeRequest("br"), pinned)).toBe(pinned);
  });

  it("leaves a reply with no body as it came", () => {
    const empty = new Response(null, {
      status: 204,
      headers: { "content-type": JSON_TYPE },
    });

    expect(compressReply(makeRequest("br"), empty)).toBe(empty);
  });
});
