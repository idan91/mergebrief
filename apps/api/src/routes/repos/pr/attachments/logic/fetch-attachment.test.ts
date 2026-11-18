import { AttachmentMediaTypes, type AttachmentAssetId } from "contract";
import { GitHubApiErrorCodes } from "github";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeHangingFetch } from "../../../../../../test/hanging-fetch";
import {
  fetchAttachmentBytes,
  fetchBranchAttachmentBytes,
} from "./fetch-attachment";

const SOURCE =
  "https://private-user-images.githubusercontent.com/1/2-3e5dffc4-bd05-4a01-98e8-1c519ba4cf00.png?jwt=abc";

const WHOLE = { signal: new AbortController().signal };
const MP4_HEAD = [0, 0, 0, 0x20, ...new TextEncoder().encode("ftypisom")];

function stubFetch(response: Response | Error) {
  return vi.fn(async () => {
    if (response instanceof Error) {
      throw response;
    }
    return response;
  });
}

function makePngResponse() {
  return new Response(new Uint8Array([137, 80, 78, 71]), {
    status: 200,
    headers: { "content-type": "image/png" },
  });
}

describe("fetchAttachmentBytes", () => {
  it("fetches the rendered url anonymously and follows redirects", async () => {
    const fetchImpl = stubFetch(makePngResponse());

    const result = await fetchAttachmentBytes(fetchImpl, SOURCE, WHOLE);

    expect(result.ok).toBe(true);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(SOURCE);
    expect(init.redirect).toBe("follow");
    expect(new Headers(init.headers).has("authorization")).toBe(false);
  });

  it("returns the body stream and the declared content type", async () => {
    const result = await fetchAttachmentBytes(
      stubFetch(makePngResponse()),
      SOURCE,
      WHOLE,
    );

    if (!result.ok) {
      throw new Error("expected ok");
    }
    expect(result.value.contentType).toBe("image/png");
    const bytes = new Uint8Array(
      await new Response(result.value.body).arrayBuffer(),
    );
    expect(Array.from(bytes)).toEqual([137, 80, 78, 71]);
  });

  it("maps a 404 to not-found", async () => {
    const result = await fetchAttachmentBytes(
      stubFetch(new Response(null, { status: 404 })),
      SOURCE,
      WHOLE,
    );

    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({
        code: GitHubApiErrorCodes.NOT_FOUND,
        status: 404,
      }),
    });
  });

  it("maps a 401 to unauthorized", async () => {
    const result = await fetchAttachmentBytes(
      stubFetch(new Response(null, { status: 401 })),
      SOURCE,
      WHOLE,
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe(GitHubApiErrorCodes.UNAUTHORIZED);
  });

  it("maps a 403 to forbidden", async () => {
    const result = await fetchAttachmentBytes(
      stubFetch(new Response(null, { status: 403 })),
      SOURCE,
      WHOLE,
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe(GitHubApiErrorCodes.FORBIDDEN);
  });

  it("treats a non-image content type as not-found", async () => {
    const html = new Response("<html></html>", {
      status: 200,
      headers: { "content-type": "text/html" },
    });

    const result = await fetchAttachmentBytes(stubFetch(html), SOURCE, WHOLE);

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe(GitHubApiErrorCodes.NOT_FOUND);
  });

  it("treats an svg as not-found since it could carry script", async () => {
    const svg = new Response("<svg><script>1</script></svg>", {
      status: 200,
      headers: { "content-type": "image/svg+xml; charset=utf-8" },
    });

    const result = await fetchAttachmentBytes(stubFetch(svg), SOURCE, WHOLE);

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe(GitHubApiErrorCodes.NOT_FOUND);
  });

  it("serves the canonical media type without upstream parameters", async () => {
    const jpeg = new Response(new Uint8Array([255, 216]), {
      status: 200,
      headers: { "content-type": "Image/JPEG; charset=binary" },
    });

    const result = await fetchAttachmentBytes(stubFetch(jpeg), SOURCE, WHOLE);

    if (!result.ok) {
      throw new Error("expected ok");
    }
    expect(result.value.contentType).toBe("image/jpeg");
  });

  it("maps a network failure to request-failed without a status", async () => {
    const result = await fetchAttachmentBytes(
      stubFetch(new Error("socket hang up")),
      SOURCE,
      WHOLE,
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe(GitHubApiErrorCodes.REQUEST_FAILED);
    expect(result.error.status).toBeUndefined();
    expect(result.error.message).not.toContain("socket");
  });

  it("maps any other status to request-failed with that status", async () => {
    const result = await fetchAttachmentBytes(
      stubFetch(new Response(null, { status: 502 })),
      SOURCE,
      WHOLE,
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe(GitHubApiErrorCodes.REQUEST_FAILED);
    expect(result.error.status).toBe(502);
  });
});

describe("fetchBranchAttachmentBytes", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const FILE = {
    assetId: "3e5dffc4-bd05-4a01-98e8-1c519ba4cf00" as AttachmentAssetId,
    fileName: "3e5dffc4-bd05-4a01-98e8-1c519ba4cf00.png",
    mediaType: AttachmentMediaTypes.PNG,
  };
  const INPUT = { owner: "acme", repo: "app", file: FILE };

  function makeRawResponse(bytes = new Uint8Array([137, 80, 78, 71])) {
    return new Response(bytes, {
      status: 200,
      headers: { "content-type": "application/vnd.github.raw; charset=utf-8" },
    });
  }

  it("gives up when the headers take past the deadline", async () => {
    vi.useFakeTimers();
    const upstream = makeHangingFetch();

    const pending = fetchBranchAttachmentBytes(
      upstream.fetchImpl,
      "ghu_token",
      INPUT,
      WHOLE.signal,
    );
    await vi.advanceTimersByTimeAsync(15_000);

    const result = await pending;
    expect(!result.ok && result.error.code).toBe(
      GitHubApiErrorCodes.REQUEST_FAILED,
    );
  });

  it("cancels the read when the client leaves", async () => {
    const upstream = makeHangingFetch();
    const client = new AbortController();

    const pending = fetchBranchAttachmentBytes(
      upstream.fetchImpl,
      "ghu_token",
      INPUT,
      client.signal,
    );
    client.abort();

    expect((await pending).ok).toBe(false);
    expect(upstream.readSignal()?.aborted).toBe(true);
  });

  it("reads the file through the contents api with the token", async () => {
    const fetchImpl = stubFetch(makeRawResponse());

    const result = await fetchBranchAttachmentBytes(
      fetchImpl,
      "ghu_token",
      INPUT,
      WHOLE.signal,
    );

    expect(result.ok).toBe(true);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    const parsed = new URL(url);
    expect(parsed.origin).toBe("https://api.github.com");
    expect(parsed.pathname).toBe(`/repos/acme/app/contents/${FILE.fileName}`);
    expect(parsed.searchParams.get("ref")).toBe("mergebrief/attachments");
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBe("Bearer ghu_token");
    expect(headers.get("accept")).toBe("application/vnd.github.raw");
    expect(init.redirect).toBe("follow");
  });

  it("serves the type the file name declares, not the raw media type", async () => {
    const result = await fetchBranchAttachmentBytes(
      stubFetch(makeRawResponse()),
      "ghu_token",
      INPUT,
      WHOLE.signal,
    );

    if (!result.ok) {
      throw new Error("expected ok");
    }
    expect(result.value.contentType).toBe("image/png");
    const bytes = new Uint8Array(
      await new Response(result.value.body).arrayBuffer(),
    );
    expect(Array.from(bytes)).toEqual([137, 80, 78, 71]);
  });

  it("treats a json answer as not-found since the path is no file", async () => {
    const listing = new Response("[]", {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8" },
    });

    const result = await fetchBranchAttachmentBytes(
      stubFetch(listing),
      "ghu_token",
      INPUT,
      WHOLE.signal,
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe(GitHubApiErrorCodes.NOT_FOUND);
  });

  it("maps 404, 401 and 403 to their codes without the token", async () => {
    const outcomes = await Promise.all(
      [404, 401, 403].map((status) =>
        fetchBranchAttachmentBytes(
          stubFetch(new Response(null, { status })),
          "ghu_token",
          INPUT,
          WHOLE.signal,
        ),
      ),
    );

    const codes = outcomes.map((outcome) =>
      outcome.ok ? "ok" : outcome.error.code,
    );
    expect(codes).toEqual([
      GitHubApiErrorCodes.NOT_FOUND,
      GitHubApiErrorCodes.UNAUTHORIZED,
      GitHubApiErrorCodes.FORBIDDEN,
    ]);
    for (const outcome of outcomes) {
      expect(JSON.stringify(outcome)).not.toContain("ghu_token");
    }
  });

  it("maps a network failure to request-failed", async () => {
    const result = await fetchBranchAttachmentBytes(
      stubFetch(new Error("socket hang up")),
      "ghu_token",
      INPUT,
      WHOLE.signal,
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe(GitHubApiErrorCodes.REQUEST_FAILED);
    expect(result.error.message).not.toContain("socket");
  });
});

describe("fetchAttachmentBytes for a video", () => {
  function makeVideoPiece(
    bytes: readonly number[] | string,
    contentRange: string,
    contentType = "video/mp4",
  ): Response {
    const body = typeof bytes === "string" ? bytes : new Uint8Array(bytes);
    return new Response(body, {
      status: 206,
      headers: { "content-type": contentType, "content-range": contentRange },
    });
  }

  it("forwards the range and reads the answered extent", async () => {
    const piece = makeVideoPiece([...MP4_HEAD, 1, 2], "bytes 0-13/5000");
    const fetchImpl = stubFetch(piece);

    const result = await fetchAttachmentBytes(fetchImpl, SOURCE, {
      ...WHOLE,
      range: "bytes=0-4095",
    });

    if (!result.ok) {
      throw new Error("expected ok");
    }
    expect(result.value.contentType).toBe("video/mp4");
    expect(result.value.extent).toEqual({ first: 0, last: 13, total: 5000 });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(new Headers(init.headers).get("range")).toBe("bytes=0-4095");
    const bytes = new Uint8Array(
      await new Response(result.value.body).arrayBuffer(),
    );
    expect(Array.from(bytes)).toEqual([...MP4_HEAD, 1, 2]);
  });

  it("refuses a piece whose content range it cannot read", async () => {
    const piece = makeVideoPiece([137, 80, 78, 71], "bytes 0-3/*", "image/png");

    const result = await fetchAttachmentBytes(stubFetch(piece), SOURCE, {
      ...WHOLE,
      range: "bytes=0-4095",
    });

    expect(!result.ok && result.error.code).toBe(GitHubApiErrorCodes.NOT_FOUND);
  });

  it("refuses text served as a video at the file's head", async () => {
    const piece = makeVideoPiece("version https://git-lfs", "bytes 0-22/23");

    const result = await fetchAttachmentBytes(stubFetch(piece), SOURCE, WHOLE);

    expect(!result.ok && result.error.code).toBe(GitHubApiErrorCodes.NOT_FOUND);
  });

  it("serves a later piece, which holds no signature, as its type", async () => {
    const piece = makeVideoPiece([9, 9, 9], "bytes 4096-4098/5000");

    const result = await fetchAttachmentBytes(stubFetch(piece), SOURCE, WHOLE);

    expect(result.ok && result.value.contentType).toBe("video/mp4");
  });

  it("refuses a video type outside the allowlist", async () => {
    const piece = makeVideoPiece(MP4_HEAD, "bytes 0-11/12", "video/x-matroska");

    const result = await fetchAttachmentBytes(stubFetch(piece), SOURCE, WHOLE);

    expect(result.ok).toBe(false);
  });

  it("keeps a range upstream refused as its 416 status", async () => {
    const refused = new Response(null, {
      status: 416,
      headers: { "content-range": "bytes */5000" },
    });

    const result = await fetchAttachmentBytes(stubFetch(refused), SOURCE, {
      ...WHOLE,
      range: "bytes=9000-9099",
    });

    expect(!result.ok && result.error.status).toBe(416);
  });
});
