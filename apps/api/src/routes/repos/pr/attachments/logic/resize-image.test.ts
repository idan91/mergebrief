import { crc32, deflateSync } from "node:zlib";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { resizeImage } from "./resize-image";
import { sniffImageMediaType } from "./sniff-image";

const RED = { r: 255, g: 0, b: 0 };
const BLUE = { r: 0, g: 0, b: 255 };
const RASTER_FORMATS = ["png", "jpeg", "webp", "gif"] as const;
const EXIF_ROTATE_CLOCKWISE = 6;
/** 8000x8000 = 64 MP: under sharp's own default limit, over the thumbnail's 40 MP. */
const OVER_LIMIT_SIDE = 8000;
/** 6000x6000 = 36 MP: inside the thumbnail's limit. */
const UNDER_LIMIT_SIDE = 6000;
const PAST_SHARP_DEFAULT_SIDE = 20_000;

type RasterFormat = (typeof RASTER_FORMATS)[number];

async function makeImage(
  width: number,
  height: number,
  format: RasterFormat | "tiff" = "png",
): Promise<Uint8Array> {
  const image = sharp({
    create: { width, height, channels: 3, background: RED },
  });
  return image.toFormat(format).toBuffer();
}

async function readSize(
  bytes: Uint8Array,
): Promise<{ width?: number; height?: number }> {
  const { width, height } = await sharp(bytes).metadata();
  return { width, height };
}

async function resizeOrFail(bytes: Uint8Array): Promise<Uint8Array> {
  const resized = await resizeImage(bytes);
  if (!resized.ok) {
    throw new Error(`resize failed: ${resized.error.kind}`);
  }
  return resized.value;
}

/** Two 20x40 frames, red then blue, stacked as one animated gif. */
async function makeAnimatedGif(): Promise<Uint8Array> {
  const frameBytes = 20 * 40 * 3;
  const pixels = new Uint8Array(frameBytes * 2);
  for (let offset = 0; offset < pixels.length; offset += 3) {
    const color = offset < frameBytes ? RED : BLUE;
    pixels.set([color.r, color.g, color.b], offset);
  }
  const raw = { width: 20, height: 80, channels: 3, pageHeight: 40 } as const;
  return sharp(pixels, { raw }).gif().toBuffer();
}

function makePngChunk(type: string, data: Buffer): Buffer {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crcInput = Buffer.concat([name, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcInput));
  return Buffer.concat([length, name, data, crc]);
}

/** A 68-byte PNG claiming a `side` x `side` RGB image: a decompression bomb's header, a few bytes of data. */
function makeBombPng(side: number): Uint8Array {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(side, 0);
  header.writeUInt32BE(side, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const signature = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  const imageData = deflateSync(Buffer.alloc(16));
  const emptyData = Buffer.alloc(0);
  return Buffer.concat([
    signature,
    makePngChunk("IHDR", header),
    makePngChunk("IDAT", imageData),
    makePngChunk("IEND", emptyData),
  ]);
}

describe("resizeImage", () => {
  it.each(RASTER_FORMATS)("turns a %s into a webp", async (format) => {
    const original = await makeImage(600, 300, format);

    const thumbnail = await resizeOrFail(original);

    expect(sniffImageMediaType(thumbnail)).toBe("image/webp");
  });

  it.each([
    [
      "svg",
      new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'),
    ],
    ["bmp", new Uint8Array([0x42, 0x4d, 0x3a, 0, 0, 0, 0, 0, 0, 0, 0x36])],
    [
      "heic",
      new Uint8Array([0, 0, 0, 0x18, ...new TextEncoder().encode("ftypheic")]),
    ],
    ["text", new TextEncoder().encode("just some words, not an image")],
  ])("refuses %s before sharp reads it", async (_name, bytes) => {
    const resized = await resizeImage(bytes);

    expect(resized).toEqual({ ok: false, error: { kind: "not-a-raster" } });
  });

  it("refuses a tiff sharp could otherwise decode", async () => {
    const tiff = await makeImage(40, 40, "tiff");

    const resized = await resizeImage(tiff);

    expect(resized).toEqual({ ok: false, error: { kind: "not-a-raster" } });
  });

  it.each([
    [2000, 800, 390, 156],
    [3000, 200, 496, 33],
    [300, 1000, 47, 156],
  ])(
    "fits %ix%i inside 496x156",
    async (width, height, fitWidth, fitHeight) => {
      const original = await makeImage(width, height);

      const thumbnail = await resizeOrFail(original);

      expect(await readSize(thumbnail)).toEqual({
        width: fitWidth,
        height: fitHeight,
      });
    },
  );

  it("never enlarges an image already inside the box", async () => {
    const original = await makeImage(100, 50);

    const thumbnail = await resizeOrFail(original);

    expect(await readSize(thumbnail)).toEqual({ width: 100, height: 50 });
  });

  it("keeps only the first frame of an animated gif", async () => {
    const animated = await makeAnimatedGif();
    expect((await sharp(animated).metadata()).pages).toBe(2);

    const thumbnail = await resizeOrFail(animated);

    expect(await readSize(thumbnail)).toEqual({ width: 20, height: 40 });
    const { dominant } = await sharp(thumbnail).stats();
    expect(dominant.r).toBeGreaterThan(dominant.b);
  });

  it("strips the metadata and applies the orientation it carried", async () => {
    const original = await sharp({
      create: { width: 200, height: 100, channels: 3, background: RED },
    })
      .withExif({ IFD0: { Copyright: "private note" } })
      .withMetadata({ orientation: EXIF_ROTATE_CLOCKWISE })
      .jpeg()
      .toBuffer();

    const thumbnail = await resizeOrFail(original);

    const metadata = await sharp(thumbnail).metadata();
    expect(metadata.exif).toBeUndefined();
    expect(metadata.orientation).toBeUndefined();
    expect({ width: metadata.width, height: metadata.height }).toEqual({
      width: 78,
      height: 156,
    });
  });

  it("fails an image whose bytes do not decode", async () => {
    const png = await makeImage(40, 40);
    const truncated = png.subarray(0, 24);

    const resized = await resizeImage(truncated);

    expect(resized.ok).toBe(false);
    expect(!resized.ok && resized.error.kind).toBe("undecodable");
  });

  it("refuses a header claiming 64 MP before any pixel is decoded", async () => {
    const resized = await resizeImage(makeBombPng(OVER_LIMIT_SIDE));

    expect(resized).toEqual({ ok: false, error: { kind: "too-many-pixels" } });
  });

  it("refuses a header past sharp's own default pixel limit", async () => {
    const resized = await resizeImage(makeBombPng(PAST_SHARP_DEFAULT_SIDE));

    expect(resized).toEqual({ ok: false, error: { kind: "too-many-pixels" } });
  });

  it("lets a 36 MP header through to the decoder", async () => {
    const resized = await resizeImage(makeBombPng(UNDER_LIMIT_SIDE));

    expect(!resized.ok && resized.error.kind).toBe("undecodable");
  });
});
