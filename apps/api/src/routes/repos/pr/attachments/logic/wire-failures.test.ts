import { describe, expect, it } from "vitest";
import {
  BadGateway,
  NotFound,
  ServiceUnavailable,
} from "../../../../../shared-errors/api-error";
import type { ThumbnailFailure } from "../types";
import { throwThumbnailFailure } from "./wire-failures";

function catchThrown(failure: ThumbnailFailure): unknown {
  try {
    throwThumbnailFailure(failure);
  } catch (error) {
    return error;
  }
  return undefined;
}

describe("throwThumbnailFailure", () => {
  it("answers a full resize queue as 503 thumbnails-busy", () => {
    const thrown = catchThrown({ kind: "busy" });

    expect(thrown).toBeInstanceOf(ServiceUnavailable);
    expect(thrown).toMatchObject({ code: "thumbnails-busy" });
  });

  it("answers a body that broke upstream as 502", () => {
    expect(catchThrown({ kind: "unreadable" })).toBeInstanceOf(BadGateway);
  });

  it.each<ThumbnailFailure>([
    { kind: "not-a-raster" },
    { kind: "too-large" },
    { kind: "too-many-pixels" },
    {
      kind: "undecodable",
      reason: "Input buffer contains unsupported image format",
    },
  ])("answers $kind as the 404 a failed read gives", (failure) => {
    expect(catchThrown(failure)).toBeInstanceOf(NotFound);
  });
});
