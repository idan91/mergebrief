import { buildOperationPath, ProductQueryIds } from "contract";
import { describe, expect, it } from "vitest";
import { compressDiffReply } from "./compression";

const PR_PARAMS = { repoId: 7, prNumber: 12 };
const PR_DIFF_PATH = buildOperationPath(ProductQueryIds.READ_DIFF, PR_PARAMS);
const LOCAL_DIFFS_PATH = buildOperationPath(
  ProductQueryIds.READ_LOCAL_BRIEF_DIFFS,
  { briefId: "abc" },
);
const PR_BRIEF_PATH = buildOperationPath(ProductQueryIds.READ_BRIEF, PR_PARAMS);

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

function makeDiffRead(path: string, acceptEncoding: string): Request {
  return new Request(`http://localhost${path}`, {
    headers: { "accept-encoding": acceptEncoding },
  });
}

function makeDiffReply(diff: string): Response {
  return new Response(diff, {
    status: 200,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

async function readGunzipped(reply: Response): Promise<string> {
  const { body } = reply;
  if (body === null) {
    throw new Error("reply has no body");
  }
  const gunzipped = body.pipeThrough(new DecompressionStream("gzip"));
  return new Response(gunzipped).text();
}

describe("compressDiffReply", () => {
  it("gzips a 3000-file PR diff to under a third of its bytes", async () => {
    const diff = makeLargeDiff();
    const rawBytes = new TextEncoder().encode(diff).length;
    const request = makeDiffRead(PR_DIFF_PATH, "gzip, br");

    const reply = compressDiffReply(request, makeDiffReply(diff));
    const compressed = await reply.clone().arrayBuffer();

    expect(rawBytes).toBeGreaterThan(MIN_LARGE_DIFF_BYTES);
    expect(compressed.byteLength).toBeLessThan(rawBytes * MAX_GZIP_FRACTION);
    expect(reply.headers.get("content-encoding")).toBe("gzip");
    expect(reply.headers.get("vary")).toBe("accept-encoding");
    expect(reply.headers.get("content-length")).toBeNull();
    expect(await readGunzipped(reply)).toBe(diff);
  });

  it("gzips the local brief's diffs read too", async () => {
    const request = makeDiffRead(LOCAL_DIFFS_PATH, "gzip");

    const reply = compressDiffReply(request, makeDiffReply("+a\n"));

    expect(reply.headers.get("content-encoding")).toBe("gzip");
    expect(await readGunzipped(reply)).toBe("+a\n");
  });

  it("sends identity bytes, still varying, when gzip is refused", async () => {
    const request = makeDiffRead(PR_DIFF_PATH, "gzip;q=0, br");

    const reply = compressDiffReply(request, makeDiffReply("+a\n"));

    expect(reply.headers.get("content-encoding")).toBeNull();
    expect(reply.headers.get("vary")).toBe("accept-encoding");
    expect(await reply.text()).toBe("+a\n");
  });

  it("matches a path param to one segment only", () => {
    const nested = makeDiffRead("/api/repos/7/x/pulls/12/diff", "gzip");
    const reply = makeDiffReply("+a\n");

    expect(compressDiffReply(nested, reply)).toBe(reply);
  });

  it("passes every other reply through as it came", () => {
    const brief = makeDiffRead(PR_BRIEF_PATH, "gzip");
    const failed = makeDiffRead(PR_DIFF_PATH, "gzip");
    const briefReply = makeDiffReply("{}");
    const failedReply = new Response("{}", { status: 404 });

    expect(compressDiffReply(brief, briefReply)).toBe(briefReply);
    expect(compressDiffReply(failed, failedReply)).toBe(failedReply);
  });
});
