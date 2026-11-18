import { describe, expect, it } from "vitest";
import { sniffVideoMediaType } from "./sniff-video";

function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function makeFtypHead(brand: string): Uint8Array {
  return new Uint8Array([0, 0, 0, 0x20, ...encode(`ftyp${brand}`), 0, 0, 0]);
}

const EBML_MAGIC = [0x1a, 0x45, 0xdf, 0xa3];
const DOC_TYPE_ID = [0x42, 0x82];

function makeEbmlHead(docType: string): Uint8Array {
  return new Uint8Array([
    ...EBML_MAGIC,
    0x9f,
    0x42,
    0x86,
    0x81,
    0x01,
    ...DOC_TYPE_ID,
    0x80 + docType.length,
    ...encode(docType),
  ]);
}

describe("sniffVideoMediaType", () => {
  it("reads an mp4 from its file-type box", () => {
    expect(sniffVideoMediaType(makeFtypHead("isom"))).toBe("video/mp4");
    expect(sniffVideoMediaType(makeFtypHead("mp42"))).toBe("video/mp4");
  });

  it("reads a quicktime movie from its brand", () => {
    expect(sniffVideoMediaType(makeFtypHead("qt  "))).toBe("video/quicktime");
  });

  it("reads a webm from its EBML doc type", () => {
    expect(sniffVideoMediaType(makeEbmlHead("webm"))).toBe("video/webm");
  });

  it("refuses a matroska file that is not webm", () => {
    expect(sniffVideoMediaType(makeEbmlHead("matroska"))).toBeUndefined();
  });

  it("refuses a git lfs pointer", () => {
    const pointer = encode(
      "version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 12345\n",
    );
    expect(sniffVideoMediaType(pointer)).toBeUndefined();
  });

  it("refuses an image, markup and a head too short to read", () => {
    const png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    for (const head of [
      png,
      encode("<html><video></video></html>"),
      encode("\0\0\0 ftyp"),
      new Uint8Array(),
    ]) {
      expect(sniffVideoMediaType(head)).toBeUndefined();
    }
  });
});
