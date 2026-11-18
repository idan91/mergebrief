import type { UploadAttachmentResponse } from "contract";
import type { Result } from "types/utils";
import { z } from "zod/v4";

import { parseWithSchema } from "@web/utils/parse-with-schema";

export const uploadAttachmentResponseSchema = z
  .object({ url: z.string() })
  .readonly() satisfies z.ZodType<
  UploadAttachmentResponse,
  UploadAttachmentResponse
>;

/** The upload receipt; any other body is refused. */
export function parseUploadAttachmentResponse(
  body: unknown,
): Result<UploadAttachmentResponse, string> {
  return parseWithSchema(uploadAttachmentResponseSchema, body);
}
