import sharp from "sharp";
import type { Result } from "types/utils";
import {
  RESIZE_TIMEOUT_SECONDS,
  THUMBNAIL_MAX_HEIGHT,
  THUMBNAIL_MAX_INPUT_PIXELS,
  THUMBNAIL_MAX_WIDTH,
  THUMBNAIL_WEBP_QUALITY,
} from "../consts";
import { ResizeImageFailureKinds, type ResizeImageFailure } from "../types";
import { sniffImageMediaType } from "./sniff-image";

type ResizeResult = Result<Uint8Array<ArrayBuffer>, ResizeImageFailure>;

// Process-wide: no image stays in libvips' operation cache after its reply,
// and each resize runs on one thread, so the four running resizes use at
// most four cores (measured no slower for four at once than the default).
sharp.cache(false);
sharp.concurrency(1);

function refuseUndecodable(error: unknown): ResizeResult {
  const reason = error instanceof Error ? error.message : String(error);
  const kind = ResizeImageFailureKinds.UNDECODABLE;
  return { ok: false, error: { kind, reason } };
}

/** The first frame's size from the header alone; nothing is decoded, so no limit applies here. */
async function readDeclaredPixels(
  bytes: Uint8Array,
): Promise<Result<number, unknown>> {
  try {
    const { width, height } = await sharp(bytes, {
      animated: false,
      limitInputPixels: false,
    }).metadata();
    return { ok: true, value: width * height };
  } catch (error) {
    return { ok: false, error };
  }
}

/**
 * The strip's thumbnail of an image, as WebP. The format is read from the
 * bytes before sharp sees them, because the bundled libvips also decodes SVG,
 * TIFF and HEIF. The header's size is checked before any pixel is decoded,
 * so a small file declaring a huge image is refused; every metadata block is
 * dropped, and an animated GIF gives its first frame.
 */
export async function resizeImage(bytes: Uint8Array): Promise<ResizeResult> {
  if (sniffImageMediaType(bytes) === undefined) {
    return { ok: false, error: { kind: ResizeImageFailureKinds.NOT_A_RASTER } };
  }
  const pixels = await readDeclaredPixels(bytes);
  if (!pixels.ok) {
    return refuseUndecodable(pixels.error);
  }
  if (pixels.value > THUMBNAIL_MAX_INPUT_PIXELS) {
    const kind = ResizeImageFailureKinds.TOO_MANY_PIXELS;
    return { ok: false, error: { kind } };
  }

  try {
    const thumbnail = await sharp(bytes, {
      animated: false,
      limitInputPixels: THUMBNAIL_MAX_INPUT_PIXELS,
    })
      .autoOrient()
      .resize({
        width: THUMBNAIL_MAX_WIDTH,
        height: THUMBNAIL_MAX_HEIGHT,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: THUMBNAIL_WEBP_QUALITY })
      .timeout({ seconds: RESIZE_TIMEOUT_SECONDS })
      .toBuffer();
    return { ok: true, value: new Uint8Array(thumbnail) };
  } catch (error) {
    return refuseUndecodable(error);
  }
}
