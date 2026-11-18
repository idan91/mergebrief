import { describe, expect, it } from "vitest";
import { resolveAttachmentLimits } from "./attachment-limits";

const MB = 1024 * 1024;
const MINUTE_MS = 60_000;

describe("resolveAttachmentLimits", () => {
  it("defaults to 10 files or 30 MB per 10 minutes and 100 MB of media", () => {
    expect(resolveAttachmentLimits({})).toEqual({
      ok: true,
      value: {
        attachmentQuota: {
          maxFiles: 10,
          maxBytes: 30 * MB,
          windowMs: 10 * MINUTE_MS,
        },
        mediaMaxBytes: 100 * MB,
      },
    });
  });

  it("takes each setting the instance config gives", () => {
    const result = resolveAttachmentLimits({
      quotaFiles: 3,
      quotaMb: 50,
      quotaWindowMinutes: 60,
      mediaMaxMb: 250,
    });
    expect(result).toEqual({
      ok: true,
      value: {
        attachmentQuota: {
          maxFiles: 3,
          maxBytes: 50 * MB,
          windowMs: 60 * MINUTE_MS,
        },
        mediaMaxBytes: 250 * MB,
      },
    });
  });

  it("refuses a megabyte quota under the size limit of one file", () => {
    expect(resolveAttachmentLimits({ quotaMb: 9 })).toEqual({
      ok: false,
      error: {
        code: "invalid",
        issues: [
          "attachments.quotaMb: must be at least 10, the megabyte limit of one file",
        ],
      },
    });
  });

  it("takes a megabyte quota equal to the size limit of one file", () => {
    const result = resolveAttachmentLimits({ quotaMb: 10 });
    expect(result.ok && result.value.attachmentQuota.maxBytes).toBe(10 * MB);
  });
});
