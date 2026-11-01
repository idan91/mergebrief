import { AttachmentMediaTypes, type AttachmentMediaType } from "./types";

export const ATTACHMENT_ASSET_ORIGIN = "https://github.com";
export const ATTACHMENT_ASSET_PATH_PREFIX = "/user-attachments/assets/";

/** The one branch the App writes to; an orphan, holding image files only. */
export const ATTACHMENT_BRANCH = "mergebrief/attachments";
export const ATTACHMENT_BRANCH_RAW_QUERY = "?raw=true";
/** The video-asset list's query naming a bare line's id the page's last answer lacked. */
export const VIDEO_ASSETS_MISSING_PARAM = "missing";
/** The upload cap, mirrored by the composer so an oversize file never leaves the browser. */
export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;

export const ATTACHMENT_EXTENSION_BY_MEDIA_TYPE: Readonly<
  Record<AttachmentMediaType, string>
> = {
  [AttachmentMediaTypes.PNG]: "png",
  [AttachmentMediaTypes.JPEG]: "jpg",
  [AttachmentMediaTypes.GIF]: "gif",
  [AttachmentMediaTypes.WEBP]: "webp",
};

/** The query parameter that asks an attachment read for an `AttachmentThumbnails` form. */
export const ATTACHMENT_THUMBNAIL_PARAM = "thumbnail";

export const ASSET_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
