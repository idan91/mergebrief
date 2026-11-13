import { ATTACHMENT_MAX_BYTES } from "contract";
import type { LoadedInstancePolicy } from "generators/instance-policy";
import type { Result } from "types/utils";
import { ConfigErrorCodes, type ConfigError } from "../config";
import {
  BYTES_PER_MB,
  DEFAULT_MEDIA_MAX_MB,
  DEFAULT_UPLOAD_QUOTA_FILES,
  DEFAULT_UPLOAD_QUOTA_MB,
  DEFAULT_UPLOAD_QUOTA_WINDOW_MINUTES,
  MS_PER_MINUTE,
} from "../routes/repos/pr/attachments/consts";
import type { UploadQuotaLimits } from "../routes/repos/pr/attachments/types";

// A window smaller than one file would refuse that file in every window.
const MIN_UPLOAD_QUOTA_MB = Math.ceil(ATTACHMENT_MAX_BYTES / BYTES_PER_MB);
const UPLOAD_QUOTA_MB_TOO_SMALL = `attachments.quotaMb: must be at least ${MIN_UPLOAD_QUOTA_MB}, the megabyte limit of one file`;

export interface AttachmentLimits {
  /** What one reviewer may upload per window. */
  readonly attachmentQuota: UploadQuotaLimits;
  /** The largest file a media read streams, in bytes. */
  readonly mediaMaxBytes: number;
}

/** The instance config's `attachments` block in the units the routes read, each unset key at its default. */
export function resolveAttachmentLimits(
  settings: LoadedInstancePolicy["attachments"],
): Result<AttachmentLimits, ConfigError> {
  const quotaMb = settings.quotaMb ?? DEFAULT_UPLOAD_QUOTA_MB;
  if (quotaMb < MIN_UPLOAD_QUOTA_MB) {
    return {
      ok: false,
      error: {
        code: ConfigErrorCodes.INVALID,
        issues: [UPLOAD_QUOTA_MB_TOO_SMALL],
      },
    };
  }

  const windowMinutes =
    settings.quotaWindowMinutes ?? DEFAULT_UPLOAD_QUOTA_WINDOW_MINUTES;
  const mediaMaxMb = settings.mediaMaxMb ?? DEFAULT_MEDIA_MAX_MB;
  return {
    ok: true,
    value: {
      attachmentQuota: {
        maxFiles: settings.quotaFiles ?? DEFAULT_UPLOAD_QUOTA_FILES,
        maxBytes: quotaMb * BYTES_PER_MB,
        windowMs: windowMinutes * MS_PER_MINUTE,
      },
      mediaMaxBytes: mediaMaxMb * BYTES_PER_MB,
    },
  };
}
