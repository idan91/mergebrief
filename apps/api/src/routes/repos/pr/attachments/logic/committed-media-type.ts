import {
  CommittedMediaExtensions,
  readCommittedMediaExtension,
  type CommittedMediaExtension,
} from "brief-core/media-address";
import { CommittedFileMediaTypes, type CommittedFileMediaType } from "../types";
import { sniffImageMediaType } from "./sniff-image";

const MEDIA_TYPE_BY_EXTENSION: Readonly<
  Record<CommittedMediaExtension, CommittedFileMediaType>
> = {
  [CommittedMediaExtensions.PNG]: CommittedFileMediaTypes.PNG,
  [CommittedMediaExtensions.JPG]: CommittedFileMediaTypes.JPEG,
  [CommittedMediaExtensions.JPEG]: CommittedFileMediaTypes.JPEG,
  [CommittedMediaExtensions.GIF]: CommittedFileMediaTypes.GIF,
  [CommittedMediaExtensions.WEBP]: CommittedFileMediaTypes.WEBP,
  [CommittedMediaExtensions.SVG]: CommittedFileMediaTypes.SVG,
};

const SVG_OPEN_TAG = "<svg";

/** The type a committed file's name allows; any other file is never fetched. */
export function readCommittedFileMediaType(
  pathSegments: readonly string[],
): CommittedFileMediaType | undefined {
  const extension = readCommittedMediaExtension(pathSegments);
  return extension === undefined
    ? undefined
    : MEDIA_TYPE_BY_EXTENSION[extension];
}

/** Markup that opens with a tag and holds an `<svg` element; the decoder drops a BOM. */
function isSvgMarkup(head: Uint8Array): boolean {
  const decoded = new TextDecoder().decode(head);
  const text = decoded.trimStart().toLowerCase();
  const opensWithTag = text.startsWith("<");
  return opensWithTag && text.includes(SVG_OPEN_TAG);
}

/**
 * The type to serve, read from the bytes: a raster as its signature says,
 * an SVG only under an `.svg` name. Raw hosts answer `text/plain` for most
 * files, so the upstream type is never consulted.
 */
export function sniffCommittedMediaType(
  head: Uint8Array,
  declared: CommittedFileMediaType,
): CommittedFileMediaType | undefined {
  const raster = sniffImageMediaType(head);
  if (raster !== undefined) {
    return raster;
  }
  if (declared === CommittedFileMediaTypes.SVG && isSvgMarkup(head)) {
    return CommittedFileMediaTypes.SVG;
  }
  return undefined;
}
