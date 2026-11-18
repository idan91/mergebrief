import { AttachmentMediaTypes, type AttachmentMediaType } from "contract";
import {
  AssetMediaTypes,
  VideoMediaTypes,
  type AssetMediaType,
  type VideoMediaType,
} from "../types";

const UPLOAD_MEDIA_TYPES: ReadonlySet<string> = new Set(
  Object.values(AttachmentMediaTypes),
);
const ASSET_MEDIA_TYPES: ReadonlySet<string> = new Set(
  Object.values(AssetMediaTypes),
);
const VIDEO_MEDIA_TYPES: ReadonlySet<string> = new Set(
  Object.values(VideoMediaTypes),
);

/** One of the four rasters an attachment upload or a thumbnail accepts. */
export function isAttachmentMediaType(
  value: string,
): value is AttachmentMediaType {
  return UPLOAD_MEDIA_TYPES.has(value);
}

function isAssetMediaType(value: string): value is AssetMediaType {
  return ASSET_MEDIA_TYPES.has(value);
}

export function isVideoMediaType(value: string): value is VideoMediaType {
  return VIDEO_MEDIA_TYPES.has(value);
}

/** The allowlisted image type a `content-type` header declares, parameters dropped. */
export function readDeclaredMediaType(
  header: string | undefined,
): AttachmentMediaType | undefined {
  if (header === undefined) {
    return undefined;
  }
  const [mediaType = ""] = header.split(";");
  const normalized = mediaType.trim().toLowerCase();
  return isAttachmentMediaType(normalized) ? normalized : undefined;
}

/** A pasted asset's upstream type, kept only when the allowlist names it: a raster or a video. */
export function readAssetMediaType(
  mediaType: string,
): AssetMediaType | undefined {
  return isAssetMediaType(mediaType) ? mediaType : undefined;
}
