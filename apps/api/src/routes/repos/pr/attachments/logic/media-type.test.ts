import { describe, expect, it } from "vitest";
import {
  isVideoMediaType,
  readAssetMediaType,
  readDeclaredMediaType,
} from "./media-type";

describe("readDeclaredMediaType", () => {
  it("reads an allowlisted image type", () => {
    expect(readDeclaredMediaType("image/png")).toBe("image/png");
  });

  it("drops parameters and case", () => {
    expect(readDeclaredMediaType("Image/JPEG; charset=binary")).toBe(
      "image/jpeg",
    );
  });

  it("refuses a missing header and any other type", () => {
    expect(readDeclaredMediaType(undefined)).toBeUndefined();
    expect(readDeclaredMediaType("image/svg+xml")).toBeUndefined();
    expect(readDeclaredMediaType("text/plain")).toBeUndefined();
  });
});

describe("readAssetMediaType", () => {
  it("reads an allowlisted image or video type from an upstream answer", () => {
    expect(readAssetMediaType("image/png")).toBe("image/png");
    expect(readAssetMediaType("video/mp4")).toBe("video/mp4");
    expect(readAssetMediaType("video/quicktime")).toBe("video/quicktime");
    expect(readAssetMediaType("video/webm")).toBe("video/webm");
  });

  it("refuses svg, other video types and text", () => {
    for (const value of ["image/svg+xml", "video/x-matroska", "text/html"]) {
      expect(readAssetMediaType(value)).toBeUndefined();
    }
  });
});

describe("isVideoMediaType", () => {
  it("names the video types only", () => {
    expect(isVideoMediaType("video/webm")).toBe(true);
    expect(isVideoMediaType("image/png")).toBe(false);
  });
});
