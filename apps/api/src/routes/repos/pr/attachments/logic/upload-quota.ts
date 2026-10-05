// One fixed window per reviewer, counted in this process only. A reserved
// upload is charged at once and never refunded, so a push GitHub then fails
// still counts; a refused one charges nothing and leaves the window as it was.
import { MS_PER_SECOND } from "../consts";
import type { UploadQuota, UploadReservation } from "../types";

export function reserveUpload(
  quota: UploadQuota,
  reviewerId: string,
  byteLength: number,
  now: number,
): UploadReservation {
  const { limits, windows } = quota;
  const open = windows.get(reviewerId, now);
  const startedAt = open?.startedAt ?? now;
  const endsAt = startedAt + limits.windowMs;
  const files = (open?.files ?? 0) + 1;
  const bytes = (open?.bytes ?? 0) + byteLength;

  const exceedsQuota = files > limits.maxFiles || bytes > limits.maxBytes;
  if (exceedsQuota) {
    const retryAfterSeconds = Math.ceil((endsAt - now) / MS_PER_SECOND);
    return { ok: false, error: { retryAfterSeconds } };
  }

  const charged = { startedAt, files, bytes };
  windows.set(reviewerId, charged, endsAt, now);
  return { ok: true, value: charged };
}
