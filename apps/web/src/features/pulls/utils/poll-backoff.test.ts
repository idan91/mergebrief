import { describe, expect, it } from "vitest";

import { ApiError } from "../../../data/apiFetch";
import { resolveOutagePollMs } from "./poll-backoff";

const LAST_SUCCESS_AT = 1_000_000;

function stubFailedRead(status: number, outageMs: number) {
  return {
    error: new ApiError("github-unavailable", status, "/api/x"),
    dataUpdatedAt: LAST_SUCCESS_AT,
    errorUpdatedAt: LAST_SUCCESS_AT + outageMs,
  };
}

describe("resolveOutagePollMs", () => {
  it("keeps the healthy cadence after a read that succeeded", () => {
    const read = {
      error: null,
      dataUpdatedAt: LAST_SUCCESS_AT,
      errorUpdatedAt: 0,
    };

    expect(resolveOutagePollMs(read, 4_000)).toBe(4_000);
  });

  it.each([502, 503, 504])("doubles the cadence on a first %i", (status) => {
    expect(resolveOutagePollMs(stubFailedRead(status, 4_000), 4_000)).toBe(
      8_000,
    );
  });

  it("waits as long as the outage has lasted once that is longer", () => {
    expect(resolveOutagePollMs(stubFailedRead(502, 90_000), 30_000)).toBe(
      90_000,
    );
  });

  it("never waits longer than five minutes", () => {
    expect(resolveOutagePollMs(stubFailedRead(502, 3_600_000), 30_000)).toBe(
      300_000,
    );
  });

  it("leaves a failure that is not an outage at the healthy cadence", () => {
    expect(resolveOutagePollMs(stubFailedRead(404, 90_000), 30_000)).toBe(
      30_000,
    );
  });

  it("stops polling once the viewer has to sign in", () => {
    const read = {
      error: new ApiError("signed-out", 401, "/api/x"),
      dataUpdatedAt: LAST_SUCCESS_AT,
      errorUpdatedAt: LAST_SUCCESS_AT,
    };

    expect(resolveOutagePollMs(read, 30_000)).toBe(false);
  });

  it("keeps a poll that is off switched off", () => {
    expect(resolveOutagePollMs(stubFailedRead(502, 4_000), false)).toBe(false);
  });
});
