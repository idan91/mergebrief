import { describe, expect, it } from "vitest";

import { isFullCommitSha } from "./commit-sha";

describe("isFullCommitSha", () => {
  it("accepts forty lowercase hex characters", () => {
    expect(isFullCommitSha("0123456789abcdef0123456789abcdef01234567")).toBe(
      true,
    );
  });

  it("refuses a branch name, a short SHA and uppercase hex", () => {
    expect(isFullCommitSha("main")).toBe(false);
    expect(isFullCommitSha("0123456")).toBe(false);
    expect(isFullCommitSha("A".repeat(40))).toBe(false);
  });
});
