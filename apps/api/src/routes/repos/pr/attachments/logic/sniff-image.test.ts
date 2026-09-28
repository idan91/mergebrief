import { describe, expect, it } from "vitest";
import { sniffImageMediaType } from "./sniff-image";

function bytes(...values: number[]): Uint8Array {
  return new Uint8Array(values);
}

describe("sniffImageMediaType", () => {
  it("reads png, jpeg and gif from their leading bytes", () => {
    expect(
      sniffImageMediaType(
        bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1),
      ),
    ).toBe("image/png");
    expect(sniffImageMediaType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe(
      "image/jpeg",
    );
    expect(sniffImageMediaType(bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61))).toBe(
      "image/gif",
    );
  });

  it("reads webp only when the riff header carries the webp tag", () => {
    const riff = [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0];
    expect(sniffImageMediaType(bytes(...riff, 0x57, 0x45, 0x42, 0x50))).toBe(
      "image/webp",
    );
    expect(
      sniffImageMediaType(bytes(...riff, 0x57, 0x41, 0x56, 0x45)),
    ).toBeUndefined();
  });

  it("answers undefined for anything else, short input included", () => {
    expect(sniffImageMediaType(bytes(0x3c, 0x73, 0x76, 0x67))).toBeUndefined();
    expect(sniffImageMediaType(bytes(0x89, 0x50))).toBeUndefined();
    expect(sniffImageMediaType(bytes())).toBeUndefined();
  });
});
