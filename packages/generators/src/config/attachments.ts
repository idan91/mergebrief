import { z } from "zod/v4";
import type { Result } from "types/utils";
import { configError, type ConfigError } from "../contract/errors";
import { renderKey } from "./readRoot";

/**
 * The instance `attachments` block: what one reviewer may upload per window,
 * and the largest media file the api streams. The api owns the defaults and
 * the floor one file sets on `quotaMb`; this parse holds the shape, so every
 * reader of the file refuses the same bad block.
 */
export interface AttachmentsSettings {
  /** Files one reviewer may attach per window. */
  readonly quotaFiles?: number | undefined;
  /** Megabytes one reviewer may attach per window. */
  readonly quotaMb?: number | undefined;
  /** The window's length in minutes. */
  readonly quotaWindowMinutes?: number | undefined;
  /** The largest video or image, in megabytes, a media read streams. */
  readonly mediaMaxMb?: number | undefined;
}

export const DEFAULT_ATTACHMENTS_SETTINGS: AttachmentsSettings = {};

const POSITIVE_WHOLE_NUMBER = "must be a positive whole number";

const positiveWholeNumber = z
  .number(POSITIVE_WHOLE_NUMBER)
  .int(POSITIVE_WHOLE_NUMBER)
  .positive(POSITIVE_WHOLE_NUMBER);

const attachmentsBlockSchema = z.strictObject({
  quotaFiles: positiveWholeNumber.optional(),
  quotaMb: positiveWholeNumber.optional(),
  quotaWindowMinutes: positiveWholeNumber.optional(),
  mediaMaxMb: positiveWholeNumber.optional(),
});

/** Parse a raw `attachments` root value; a key never echoes a pasted credential. */
export function validateAttachmentsBlock(
  block: unknown,
): Result<AttachmentsSettings, ConfigError> {
  const parsed = attachmentsBlockSchema.safeParse(block);
  if (!parsed.success) {
    return configError(
      parsed.error.issues.map((issue) => {
        if (issue.code === "unrecognized_keys") {
          return `attachments: unrecognized key${issue.keys.length > 1 ? "s" : ""} ${issue.keys
            .map(renderKey)
            .join(", ")}`;
        }
        const path = issue.path.map(String).join(".");
        const where = path.length > 0 ? `${path}: ` : "";
        return `attachments: ${where}${issue.message}`;
      }),
    );
  }

  return { ok: true, value: parsed.data };
}
