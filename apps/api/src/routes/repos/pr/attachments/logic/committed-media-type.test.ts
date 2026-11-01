import { describe, expect, it } from "vitest";
import {
  readCommittedFileMediaType,
  sniffCommittedMediaType,
} from "./committed-media-type";

const PNG_HEAD = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

describe("readCommittedFileMediaType", () => {
  it("reads the allowlisted image extensions without regard to case", () => {
    expect(readCommittedFileMediaType(["main", "a.PNG"])).toBe("image/png");
    expect(readCommittedFileMediaType(["main", "a.jpeg"])).toBe("image/jpeg");
    expect(readCommittedFileMediaType(["main", "a.jpg"])).toBe("image/jpeg");
    expect(readCommittedFileMediaType(["main", "a.gif"])).toBe("image/gif");
    expect(readCommittedFileMediaType(["main", "a.webp"])).toBe("image/webp");
    expect(readCommittedFileMediaType(["main", "diagram.svg"])).toBe(
      "image/svg+xml",
    );
  });

  it("refuses any other file", () => {
    for (const name of [".env", "a.html", "a.png.html", "README", "a.svgz"]) {
      expect(readCommittedFileMediaType(["main", name])).toBeUndefined();
    }
  });
});

describe("sniffCommittedMediaType", () => {
  it("serves the raster type the bytes carry", () => {
    expect(sniffCommittedMediaType(PNG_HEAD, "image/png")).toBe("image/png");
    expect(sniffCommittedMediaType(PNG_HEAD, "image/jpeg")).toBe("image/png");
  });

  it("serves an svg only under an svg name and an svg body", () => {
    const svg = encode('﻿  <?xml version="1.0"?>\n<svg xmlns="x"></svg>');

    expect(sniffCommittedMediaType(svg, "image/svg+xml")).toBe("image/svg+xml");
    expect(sniffCommittedMediaType(svg, "image/png")).toBeUndefined();
  });

  it("refuses a git lfs pointer and plain text under an image name", () => {
    const pointer = encode(
      "version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 12\n",
    );

    expect(sniffCommittedMediaType(pointer, "image/png")).toBeUndefined();
    expect(sniffCommittedMediaType(pointer, "image/svg+xml")).toBeUndefined();
    expect(
      sniffCommittedMediaType(
        encode("<html><body></body></html>"),
        "image/svg+xml",
      ),
    ).toBeUndefined();
  });
});
