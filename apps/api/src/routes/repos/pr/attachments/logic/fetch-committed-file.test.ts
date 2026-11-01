import { GitHubApiErrorCodes } from "github";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeHangingFetch } from "../../../../../../test/hanging-fetch";
import {
  fetchCommittedFileBytes,
  fetchContentsDownloadUrl,
  fetchMatchingRefNames,
} from "./fetch-committed-file";

const TOKEN = "ghu_viewer";
const DOWNLOAD_URL =
  "https://raw.githubusercontent.com/acme/app/feature/x/docs/a%20b.png?token=RAW";
const WHOLE = { signal: new AbortController().signal };
const DEADLINE_MS = 15_000;
const CLIENT = new AbortController().signal;
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const FILE = {
  owner: "acme",
  repo: "app",
  ref: "feature/x",
  fileSegments: ["docs", "a b.png"],
};

type Answer = (url: URL, init: RequestInit | undefined) => Response;

function stubFetch(answer: Answer) {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input);
    return answer(url, init);
  });
}

function readCall(fetchImpl: ReturnType<typeof stubFetch>, index = 0) {
  const [input, init] = fetchImpl.mock.calls[index] as unknown as [
    string | URL,
    RequestInit | undefined,
  ];
  return { url: new URL(input), headers: new Headers(init?.headers) };
}

function makeJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

describe("fetchMatchingRefNames", () => {
  it("asks heads and tags for the segment and strips the namespaces", async () => {
    const fetchImpl = stubFetch((url) =>
      url.pathname.includes("/heads/")
        ? makeJsonResponse([
            { ref: "refs/heads/feature" },
            { ref: "refs/heads/feature/x" },
          ])
        : makeJsonResponse([{ ref: "refs/tags/feature/v1" }]),
    );

    const names = await fetchMatchingRefNames(fetchImpl, TOKEN, {
      owner: "acme",
      repo: "app",
      prefix: "feature",
      namespaces: ["heads", "tags"],
    });

    expect(names).toEqual({
      ok: true,
      value: ["feature", "feature/x", "feature/v1"],
    });
    const paths = fetchImpl.mock.calls.map(
      (_, index) => readCall(fetchImpl, index).url.pathname,
    );
    expect(paths.toSorted()).toEqual([
      "/repos/acme/app/git/matching-refs/heads/feature",
      "/repos/acme/app/git/matching-refs/tags/feature",
    ]);
    expect(readCall(fetchImpl).headers.get("authorization")).toBe(
      `Bearer ${TOKEN}`,
    );
  });

  it("encodes the segment so it stays one path segment", async () => {
    const fetchImpl = stubFetch(() => makeJsonResponse([]));

    await fetchMatchingRefNames(fetchImpl, TOKEN, {
      owner: "acme",
      repo: "app",
      prefix: "a?b#c",
      namespaces: ["heads", "tags"],
    });

    expect(readCall(fetchImpl).url.pathname).toMatch(
      /\/heads\/a%3Fb%23c$|\/tags\/a%3Fb%23c$/,
    );
    expect(readCall(fetchImpl).url.search).toBe("");
  });

  it("asks only the namespaces it is given", async () => {
    const fetchImpl = stubFetch(() =>
      makeJsonResponse([{ ref: "refs/heads/main" }]),
    );

    const names = await fetchMatchingRefNames(fetchImpl, TOKEN, {
      owner: "acme",
      repo: "app",
      prefix: "main",
      namespaces: ["heads"],
    });

    expect(names).toEqual({ ok: true, value: ["main"] });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(readCall(fetchImpl).url.pathname).toBe(
      "/repos/acme/app/git/matching-refs/heads/main",
    );
  });

  it("answers the first refusal and never the token", async () => {
    const fetchImpl = stubFetch(() => new Response(null, { status: 404 }));

    const names = await fetchMatchingRefNames(fetchImpl, TOKEN, {
      owner: "acme",
      repo: "app",
      prefix: "main",
      namespaces: ["heads", "tags"],
    });

    expect(names.ok).toBe(false);
    expect(!names.ok && names.error.code).toBe(GitHubApiErrorCodes.NOT_FOUND);
    expect(JSON.stringify(names)).not.toContain(TOKEN);
  });

  it("treats a body that is not a ref list as an unexpected answer", async () => {
    const fetchImpl = stubFetch(() => makeJsonResponse({ message: "nope" }));

    const names = await fetchMatchingRefNames(fetchImpl, TOKEN, {
      owner: "acme",
      repo: "app",
      prefix: "main",
      namespaces: ["heads", "tags"],
    });

    expect(!names.ok && names.error.code).toBe(
      GitHubApiErrorCodes.REQUEST_FAILED,
    );
  });
});

describe("GitHub JSON deadlines", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("gives up on matching-refs once the deadline passes", async () => {
    vi.useFakeTimers();
    const upstream = makeHangingFetch();

    const pending = fetchMatchingRefNames(upstream.fetchImpl, TOKEN, {
      owner: "acme",
      repo: "app",
      prefix: "main",
      namespaces: ["heads"],
    });
    await vi.advanceTimersByTimeAsync(DEADLINE_MS);

    const names = await pending;
    expect(!names.ok && names.error.code).toBe(
      GitHubApiErrorCodes.REQUEST_FAILED,
    );
    expect(upstream.readSignal()?.aborted).toBe(true);
  });

  it("gives up on the Contents JSON once the deadline passes", async () => {
    vi.useFakeTimers();
    const upstream = makeHangingFetch();

    const pending = fetchContentsDownloadUrl(
      upstream.fetchImpl,
      TOKEN,
      FILE,
      CLIENT,
    );
    await vi.advanceTimersByTimeAsync(DEADLINE_MS);

    const url = await pending;
    expect(!url.ok && url.error.code).toBe(GitHubApiErrorCodes.REQUEST_FAILED);
  });

  it("covers the JSON body as well as the headers", async () => {
    vi.useFakeTimers();
    const upstream = makeHangingFetch();

    const pending = fetchContentsDownloadUrl(
      upstream.fetchImpl,
      TOKEN,
      FILE,
      CLIENT,
    );
    const stalled = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("{"));
        upstream.readSignal()?.addEventListener("abort", () => {
          controller.error(new Error("aborted"));
        });
      },
    });
    upstream.answer(new Response(stalled, { status: 200 }));
    await vi.advanceTimersByTimeAsync(DEADLINE_MS);

    const url = await pending;
    expect(url.ok).toBe(false);
    expect(upstream.readSignal()?.aborted).toBe(true);
  });

  it("cancels the Contents JSON when the client leaves", async () => {
    const upstream = makeHangingFetch();
    const client = new AbortController();

    const pending = fetchContentsDownloadUrl(
      upstream.fetchImpl,
      TOKEN,
      FILE,
      client.signal,
    );
    client.abort();

    expect((await pending).ok).toBe(false);
    expect(upstream.readSignal()?.aborted).toBe(true);
  });
});

describe("fetchContentsDownloadUrl", () => {
  it("reads the file's json on the viewer token at the resolved ref", async () => {
    const fetchImpl = stubFetch(() =>
      makeJsonResponse({ type: "file", download_url: DOWNLOAD_URL }),
    );

    const url = await fetchContentsDownloadUrl(fetchImpl, TOKEN, FILE, CLIENT);

    expect(url).toEqual({ ok: true, value: DOWNLOAD_URL });
    const call = readCall(fetchImpl);
    expect(call.url.origin).toBe("https://api.github.com");
    expect(call.url.pathname).toBe("/repos/acme/app/contents/docs/a%20b.png");
    expect(call.url.searchParams.get("ref")).toBe("feature/x");
    expect(call.headers.get("authorization")).toBe(`Bearer ${TOKEN}`);
    expect(call.headers.get("accept")).toBe("application/vnd.github+json");
  });

  it("refuses a directory, a symlink or a file with no download url", async () => {
    for (const body of [
      [{ type: "file", download_url: DOWNLOAD_URL }],
      { type: "symlink", download_url: DOWNLOAD_URL },
      { type: "file", download_url: null },
    ]) {
      const url = await fetchContentsDownloadUrl(
        stubFetch(() => makeJsonResponse(body)),
        TOKEN,
        FILE,
        CLIENT,
      );
      expect(!url.ok && url.error.code).toBe(GitHubApiErrorCodes.NOT_FOUND);
    }
  });

  it("refuses a download url off GitHub's raw host", async () => {
    for (const downloadUrl of [
      "https://evil.example/acme/app/main/a.png",
      "http://raw.githubusercontent.com/acme/app/main/a.png",
      "https://raw.githubusercontent.com:444/acme/app/main/a.png",
      "https://u:p@raw.githubusercontent.com/acme/app/main/a.png",
      "not a url",
    ]) {
      const url = await fetchContentsDownloadUrl(
        stubFetch(() =>
          makeJsonResponse({ type: "file", download_url: downloadUrl }),
        ),
        TOKEN,
        FILE,
        CLIENT,
      );
      expect(!url.ok && url.error.code).toBe(GitHubApiErrorCodes.NOT_FOUND);
    }
  });

  it("maps a 401 to unauthorized and a network failure to request-failed", async () => {
    const denied = await fetchContentsDownloadUrl(
      stubFetch(() => new Response(null, { status: 401 })),
      TOKEN,
      FILE,
      CLIENT,
    );
    const broken = await fetchContentsDownloadUrl(
      vi.fn(async () => {
        throw new Error("socket hang up");
      }),
      TOKEN,
      FILE,
      CLIENT,
    );

    expect(!denied.ok && denied.error.code).toBe(
      GitHubApiErrorCodes.UNAUTHORIZED,
    );
    expect(!broken.ok && broken.error.code).toBe(
      GitHubApiErrorCodes.REQUEST_FAILED,
    );
  });
});

describe("fetchCommittedFileBytes", () => {
  function makeRaw(bytes: Uint8Array | string, contentType = "text/plain") {
    return new Response(bytes, {
      status: 200,
      headers: { "content-type": contentType },
    });
  }

  it("fetches the address bare and serves the sniffed type", async () => {
    const fetchImpl = stubFetch(() => makeRaw(new Uint8Array([...PNG, 1, 2])));

    const result = await fetchCommittedFileBytes(
      fetchImpl,
      DOWNLOAD_URL,
      "image/png",
      WHOLE,
    );

    if (!result.ok) {
      throw new Error("expected ok");
    }
    expect(result.value.contentType).toBe("image/png");
    const bytes = new Uint8Array(
      await new Response(result.value.body).arrayBuffer(),
    );
    expect(Array.from(bytes)).toEqual([...PNG, 1, 2]);
    const call = readCall(fetchImpl);
    expect(call.url.href).toBe(DOWNLOAD_URL);
    expect(call.headers.has("authorization")).toBe(false);
  });

  it("serves an svg as svg whatever type the raw host claims", async () => {
    const result = await fetchCommittedFileBytes(
      stubFetch(() => makeRaw("<svg xmlns='x'></svg>", "text/html")),
      DOWNLOAD_URL,
      "image/svg+xml",
      WHOLE,
    );

    expect(result.ok && result.value.contentType).toBe("image/svg+xml");
  });

  it("refuses bytes that are not the image and cancels the body", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("version https://git-lfs"));
      },
      cancel,
    });

    const result = await fetchCommittedFileBytes(
      stubFetch(() => new Response(body, { status: 200 })),
      DOWNLOAD_URL,
      "image/png",
      WHOLE,
    );

    expect(!result.ok && result.error.code).toBe(GitHubApiErrorCodes.NOT_FOUND);
    expect(!result.ok && result.error.status).toBeUndefined();
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("answers a 404 with its status so the caller can refetch", async () => {
    const result = await fetchCommittedFileBytes(
      stubFetch(() => new Response(null, { status: 404 })),
      DOWNLOAD_URL,
      "image/png",
      WHOLE,
    );

    expect(!result.ok && result.error.status).toBe(404);
    expect(JSON.stringify(result)).not.toContain("RAW");
  });

  it("maps a network failure to request-failed", async () => {
    const result = await fetchCommittedFileBytes(
      vi.fn(async () => {
        throw new Error("socket hang up");
      }),
      DOWNLOAD_URL,
      "image/png",
      WHOLE,
    );

    expect(!result.ok && result.error.code).toBe(
      GitHubApiErrorCodes.REQUEST_FAILED,
    );
  });
});

describe("fetchCommittedFileBytes for a video", () => {
  const MP4_HEAD = [0, 0, 0, 0x20, ...new TextEncoder().encode("ftypisom")];

  function makePiece(bytes: Uint8Array | string, contentRange: string) {
    return new Response(bytes, {
      status: 206,
      headers: {
        "content-type": "application/octet-stream",
        "content-range": contentRange,
      },
    });
  }

  it("asks the address for the range and serves the declared type", async () => {
    const fetchImpl = stubFetch(() =>
      makePiece(new Uint8Array(MP4_HEAD), "bytes 0-11/9000"),
    );

    const result = await fetchCommittedFileBytes(
      fetchImpl,
      DOWNLOAD_URL,
      "video/mp4",
      { ...WHOLE, range: "bytes=0-4095" },
    );

    expect(result.ok && result.value.contentType).toBe("video/mp4");
    expect(result.ok && result.value.extent).toEqual({
      first: 0,
      last: 11,
      total: 9000,
    });
    expect(readCall(fetchImpl).headers.get("range")).toBe("bytes=0-4095");
  });

  it("refuses a piece whose content range it cannot read", async () => {
    const result = await fetchCommittedFileBytes(
      stubFetch(() => makePiece(new Uint8Array(PNG), "bytes 0-7/*")),
      DOWNLOAD_URL,
      "image/png",
      { ...WHOLE, range: "bytes=0-4095" },
    );

    expect(!result.ok && result.error.code).toBe(GitHubApiErrorCodes.NOT_FOUND);
  });

  it("refuses a git lfs pointer under a video name", async () => {
    const pointer = "version https://git-lfs.github.com/spec/v1\nsize 9000\n";

    const result = await fetchCommittedFileBytes(
      stubFetch(() =>
        makePiece(pointer, `bytes 0-${pointer.length - 1}/${pointer.length}`),
      ),
      DOWNLOAD_URL,
      "video/mp4",
      { ...WHOLE, range: "bytes=0-4095" },
    );

    expect(!result.ok && result.error.code).toBe(GitHubApiErrorCodes.NOT_FOUND);
  });

  it("serves a later piece as the declared type unread", async () => {
    const result = await fetchCommittedFileBytes(
      stubFetch(() =>
        makePiece(new Uint8Array([7, 7]), "bytes 8000-8001/9000"),
      ),
      DOWNLOAD_URL,
      "video/webm",
      { ...WHOLE, range: "bytes=8000-8001" },
    );

    expect(result.ok && result.value.contentType).toBe("video/webm");
  });
});
