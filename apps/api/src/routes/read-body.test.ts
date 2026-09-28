import { describe, expect, it, vi } from "vitest";
import { BODY_TOO_LARGE, readRawBodyWithinLimit } from "./read-body";

function makeRequest(
  chunks: readonly Uint8Array[],
  cancel?: () => void,
  headers: Record<string, string> = {},
): Request {
  const start = (
    controller: ReadableStreamDefaultController<Uint8Array>,
  ): void => {
    for (const chunk of chunks) {
      controller.enqueue(chunk);
    }
    controller.close();
  };
  const body =
    cancel === undefined
      ? new ReadableStream<Uint8Array>({ start })
      : new ReadableStream<Uint8Array>({ start, cancel });
  return new Request("https://api.test/upload", {
    method: "POST",
    body,
    headers,
    duplex: "half",
  } as RequestInit);
}

describe("readRawBodyWithinLimit", () => {
  it("joins the chunks of a body under the cap", async () => {
    const request = makeRequest([new Uint8Array([1, 2]), new Uint8Array([3])]);

    const result = await readRawBodyWithinLimit(request, 10);

    expect(result).toEqual({ ok: true, value: new Uint8Array([1, 2, 3]) });
  });

  it("answers an empty body for a request without one", async () => {
    const request = new Request("https://api.test/upload", { method: "POST" });

    const result = await readRawBodyWithinLimit(request, 10);

    expect(result).toEqual({ ok: true, value: new Uint8Array(0) });
  });

  it("cancels the stream once the bytes cross the cap", async () => {
    const cancelled = vi.fn();
    const request = makeRequest(
      [new Uint8Array([1, 2]), new Uint8Array([3, 4]), new Uint8Array([5])],
      cancelled,
    );

    const result = await readRawBodyWithinLimit(request, 3);

    expect(result).toEqual({ ok: false, error: BODY_TOO_LARGE });
    expect(cancelled).toHaveBeenCalledTimes(1);
  });

  it("refuses a declared length over the cap before reading", async () => {
    const cancelled = vi.fn();
    const request = makeRequest([new Uint8Array([1])], cancelled, {
      "content-length": "100",
    });

    const result = await readRawBodyWithinLimit(request, 3);

    expect(result).toEqual({ ok: false, error: BODY_TOO_LARGE });
    expect(cancelled).toHaveBeenCalledTimes(1);
  });
});
