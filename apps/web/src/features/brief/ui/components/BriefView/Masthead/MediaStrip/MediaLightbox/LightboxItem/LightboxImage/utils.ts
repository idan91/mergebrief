import type { DisplaySize } from "../../types";

/**
 * The image's own pixels, read as CSS pixels: the size "actual size" draws
 * it at. An SVG with only a viewBox or a percentage size has none and
 * reports a zero side; that reads as unknown, so CSS fits it and it offers
 * no zoom.
 */
export function readImageNaturalSize(
  image: Pick<HTMLImageElement, "naturalWidth" | "naturalHeight">,
): DisplaySize | undefined {
  const { naturalWidth: width, naturalHeight: height } = image;
  if (width === 0 || height === 0) {
    return undefined;
  }
  return { width, height };
}
