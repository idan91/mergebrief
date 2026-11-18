import { ATTACHMENT_THUMBNAIL_PARAM, AttachmentThumbnails } from "contract";
import { z } from "zod/v4";
import { COMMITTED_FILE_SOURCE_MAX_LENGTH } from "./consts";

/** `?source=`: the committed file's normalised address, parsed again by the route. */
export const committedFileQuerySchema = z.object({
  source: z.string().min(1).max(COMMITTED_FILE_SOURCE_MAX_LENGTH),
});

/** `?thumbnail=`: absent asks for the original; any value but the one fixed form is refused. */
export const thumbnailQuerySchema = z.object({
  [ATTACHMENT_THUMBNAIL_PARAM]: z.enum(AttachmentThumbnails).optional(),
});
