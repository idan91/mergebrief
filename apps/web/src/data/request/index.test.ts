import { ProductActionIds, ProductQueryIds } from "contract";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod/v4";

import type * as ApiFetchModule from "../apiFetch";

vi.mock("../apiFetch", async (importOriginal) => {
  const actual = await importOriginal<typeof ApiFetchModule>();
  return { ...actual, apiFetch: vi.fn() };
});

import { ApiError, ApiErrorCodes, apiFetch } from "../apiFetch";
import { request, requestText } from "./index";

const apiFetchMock = vi.mocked(apiFetch);

const receiptSchema = z.object({ draft: z.literal(false) });

function answerWith(status: number, body?: string): void {
  apiFetchMock.mockResolvedValue(new Response(body, { status }));
}

function answerError(status: number, code: string): void {
  answerWith(status, JSON.stringify({ error: "refused", code }));
}

function sendMarkReady(params: {
  repoId: string;
  prNumber: number;
}): Promise<unknown> {
  return request(ProductActionIds.MARK_READY, { params });
}

function readPull(): Promise<{ draft: false }> {
  return request(
    ProductQueryIds.READ_PULL,
    { params: { repoId: "1", prNumber: 2 } },
    receiptSchema,
  );
}

function readDiff(): Promise<string> {
  return requestText(ProductQueryIds.READ_DIFF, {
    params: { repoId: "1", prNumber: 2 },
    query: { base: "a", head: "b" },
  });
}

describe("request", () => {
  it("sends the row's path and init through apiFetch", async () => {
    answerWith(204);
    await request(ProductActionIds.DISMISS_VERSION_NOTICE, {
      params: {},
      body: { version: "1.2.3" },
    });
    expect(apiFetchMock).toHaveBeenCalledWith("/api/version/dismiss", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"version":"1.2.3"}',
    });
  });
});

describe("request with a schema", () => {
  it("resolves the parsed body", async () => {
    answerWith(200, JSON.stringify({ draft: false }));
    await expect(readPull()).resolves.toEqual({ draft: false });
  });

  it("throws the typed ApiError on a non-2xx", async () => {
    answerError(404, ApiErrorCodes.NOT_FOUND);
    const attempt = readPull();
    await expect(attempt).rejects.toBeInstanceOf(ApiError);
    await expect(attempt).rejects.toMatchObject({
      code: ApiErrorCodes.NOT_FOUND,
      status: 404,
      path: "/api/repos/1/pulls/2",
    });
  });

  it("rethrows a network failure", async () => {
    const failure = new TypeError("network down");
    apiFetchMock.mockRejectedValue(failure);
    await expect(readPull()).rejects.toBe(failure);
  });

  it("throws malformed when the 2xx body breaks the schema", async () => {
    answerWith(200, JSON.stringify({ draft: true }));
    await expect(readPull()).rejects.toMatchObject({
      code: ApiErrorCodes.MALFORMED,
      status: 200,
    });
  });

  it("throws malformed when the 2xx body is not JSON", async () => {
    answerWith(200, "not-json");
    await expect(readPull()).rejects.toMatchObject({
      code: ApiErrorCodes.MALFORMED,
    });
  });

  it("throws malformed on a 204", async () => {
    answerWith(204);
    await expect(readPull()).rejects.toMatchObject({
      code: ApiErrorCodes.MALFORMED,
      status: 204,
    });
  });
});

describe("request without a schema", () => {
  it("resolves the JSON body unchecked", async () => {
    answerWith(200, JSON.stringify({ draft: true }));
    await expect(sendMarkReady({ repoId: "1", prNumber: 2 })).resolves.toEqual({
      draft: true,
    });
  });

  it("resolves a 204 as undefined without reading the body", async () => {
    const response = new Response(null, { status: 204 });
    const text = vi.spyOn(response, "text");
    apiFetchMock.mockResolvedValue(response);
    await expect(
      sendMarkReady({ repoId: "1", prNumber: 2 }),
    ).resolves.toBeUndefined();
    expect(text).not.toHaveBeenCalled();
  });

  it("resolves an empty 2xx body as undefined", async () => {
    answerWith(200, "");
    await expect(
      sendMarkReady({ repoId: "1", prNumber: 2 }),
    ).resolves.toBeUndefined();
  });

  it("throws malformed when the 2xx body is not JSON", async () => {
    answerWith(200, "not-json");
    await expect(
      sendMarkReady({ repoId: "1", prNumber: 2 }),
    ).rejects.toMatchObject({ code: ApiErrorCodes.MALFORMED });
  });
});

describe("requestText", () => {
  it("resolves the body text off the row's path", async () => {
    answerWith(200, "diff --git a/x b/x\n");
    await expect(readDiff()).resolves.toBe("diff --git a/x b/x\n");
    expect(apiFetchMock).toHaveBeenCalledWith(
      "/api/repos/1/pulls/2/diff?base=a&head=b",
      { method: "GET" },
    );
  });

  it("resolves an empty body as an empty string", async () => {
    answerWith(200, "");
    await expect(readDiff()).resolves.toBe("");
  });

  it("throws the typed ApiError on a non-2xx", async () => {
    answerError(502, ApiErrorCodes.GITHUB_UNAVAILABLE);
    await expect(readDiff()).rejects.toMatchObject({
      code: ApiErrorCodes.GITHUB_UNAVAILABLE,
      status: 502,
    });
  });

  it("throws malformed on a 204", async () => {
    answerWith(204);
    await expect(readDiff()).rejects.toMatchObject({
      code: ApiErrorCodes.MALFORMED,
    });
  });

  it("throws malformed when the body cannot be read", async () => {
    const response = new Response("x", { status: 200 });
    vi.spyOn(response, "text").mockRejectedValue(new TypeError("aborted"));
    apiFetchMock.mockResolvedValue(response);
    await expect(readDiff()).rejects.toMatchObject({
      code: ApiErrorCodes.MALFORMED,
    });
  });
});
