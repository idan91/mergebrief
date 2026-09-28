import { AttachmentMediaTypes, type AttachmentMediaType } from "./types";

export const ATTACHMENT_ASSET_ORIGIN = "https://github.com";
export const ATTACHMENT_ASSET_PATH_PREFIX = "/user-attachments/assets/";

/** The one branch the App writes to; an orphan, holding image files only. */
export const ATTACHMENT_BRANCH = "mergebrief/attachments";
export const ATTACHMENT_BRANCH_RAW_QUERY = "?raw=true";

export const ATTACHMENT_EXTENSION_BY_MEDIA_TYPE: Readonly<
  Record<AttachmentMediaType, string>
> = {
  [AttachmentMediaTypes.PNG]: "png",
  [AttachmentMediaTypes.JPEG]: "jpg",
  [AttachmentMediaTypes.GIF]: "gif",
  [AttachmentMediaTypes.WEBP]: "webp",
};

export const ASSET_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
