import { describe, expect, it } from "vitest";
import { createTtlCache } from "../../../../ttl-cache";
import type { UploadQuota, UploadWindow } from "../types";
import { reserveUpload } from "./upload-quota";

const WINDOW_MS = 60_000;
const START = 1_000_000;
const REVIEWER = "42";

function makeQuota(maxEntries = 10): UploadQuota {
  return {
    limits: { maxFiles: 3, maxBytes: 100, windowMs: WINDOW_MS },
    windows: createTtlCache<UploadWindow>(maxEntries),
  };
}

describe("reserveUpload", () => {
  it("charges each upload up to the file limit, then refuses", () => {
    const quota = makeQuota();

    expect(reserveUpload(quota, REVIEWER, 1, START).ok).toBe(true);
    expect(reserveUpload(quota, REVIEWER, 1, START + 1).ok).toBe(true);
    expect(reserveUpload(quota, REVIEWER, 1, START + 2)).toEqual({
      ok: true,
      value: { startedAt: START, files: 3, bytes: 3 },
    });
    expect(reserveUpload(quota, REVIEWER, 1, START + 3).ok).toBe(false);
  });

  it("refuses the upload that would pass the byte limit", () => {
    const quota = makeQuota();

    expect(reserveUpload(quota, REVIEWER, 60, START).ok).toBe(true);
    expect(reserveUpload(quota, REVIEWER, 41, START).ok).toBe(false);
    expect(reserveUpload(quota, REVIEWER, 40, START).ok).toBe(true);
  });

  it("names the whole seconds left until the window ends", () => {
    const quota = makeQuota();
    reserveUpload(quota, REVIEWER, 100, START);

    expect(reserveUpload(quota, REVIEWER, 1, START + 1_500)).toEqual({
      ok: false,
      error: { retryAfterSeconds: 59 },
    });
  });

  it("starts a fresh window once the first one has ended", () => {
    const quota = makeQuota();
    reserveUpload(quota, REVIEWER, 100, START);
    expect(reserveUpload(quota, REVIEWER, 1, START + WINDOW_MS - 1).ok).toBe(
      false,
    );

    expect(reserveUpload(quota, REVIEWER, 1, START + WINDOW_MS)).toEqual({
      ok: true,
      value: { startedAt: START + WINDOW_MS, files: 1, bytes: 1 },
    });
  });

  it("keeps the window at the first charged upload, not the latest", () => {
    const quota = makeQuota();
    reserveUpload(quota, REVIEWER, 1, START);
    reserveUpload(quota, REVIEWER, 1, START + WINDOW_MS - 1);

    const next = reserveUpload(quota, REVIEWER, 1, START + WINDOW_MS);

    expect(next).toMatchObject({ ok: true, value: { files: 1 } });
  });

  it("counts two reviewers apart", () => {
    const quota = makeQuota();
    reserveUpload(quota, REVIEWER, 100, START);

    expect(reserveUpload(quota, "43", 100, START).ok).toBe(true);
    expect(reserveUpload(quota, REVIEWER, 1, START).ok).toBe(false);
  });

  it("a refused attempt adds no bytes and does not move the window", () => {
    const quota = makeQuota();
    reserveUpload(quota, REVIEWER, 60, START);

    reserveUpload(quota, REVIEWER, 41, START + 10);
    reserveUpload(quota, REVIEWER, 41, START + 20);

    expect(reserveUpload(quota, REVIEWER, 40, START + 30)).toEqual({
      ok: true,
      value: { startedAt: START, files: 2, bytes: 100 },
    });
  });

  it("tracks at most the table bound, dropping the oldest reviewer", () => {
    const quota = makeQuota(2);
    reserveUpload(quota, "1", 100, START);
    reserveUpload(quota, "2", 100, START);
    reserveUpload(quota, "3", 100, START);

    expect(reserveUpload(quota, "3", 1, START).ok).toBe(false);
    expect(reserveUpload(quota, "2", 1, START).ok).toBe(false);
    expect(reserveUpload(quota, "1", 1, START).ok).toBe(true);
  });
});
