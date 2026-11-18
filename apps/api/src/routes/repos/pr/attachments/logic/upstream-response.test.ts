import { describe, expect, it } from "vitest";
import { readByteExtent } from "./upstream-response";

function makeResponse(status: number, headers: Record<string, string>) {
  return new Response(status === 206 ? "xx" : "whole", { status, headers });
}

describe("readByteExtent", () => {
  it("reads a partial answer's content range", () => {
    const response = makeResponse(206, { "content-range": "bytes 0-1/1000" });

    expect(readByteExtent(response)).toEqual({
      first: 0,
      last: 1,
      total: 1000,
    });
  });

  it("reads a whole answer's length as the full file", () => {
    const response = makeResponse(200, { "content-length": "1000" });

    expect(readByteExtent(response)).toEqual({
      first: 0,
      last: 999,
      total: 1000,
    });
  });

  it("names no extent for an encoded, empty or unsized answer", () => {
    for (const response of [
      makeResponse(200, { "content-length": "10", "content-encoding": "gzip" }),
      makeResponse(200, { "content-length": "0" }),
      makeResponse(200, { "content-length": "ten" }),
      makeResponse(206, { "content-range": "bytes */1000" }),
    ]) {
      expect(readByteExtent(response)).toBeUndefined();
    }
  });
});
