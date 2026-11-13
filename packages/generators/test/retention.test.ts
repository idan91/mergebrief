import { describe, expect, it } from "vitest";
import { validateAuditBlock } from "../src/config/audit";
import { validateRetentionBlock } from "../src/config/retention";

function listIssues(block: unknown): readonly string[] {
  const result = validateRetentionBlock(block);
  return result.ok ? [] : result.error.issues;
}

describe("validateRetentionBlock", () => {
  it("keeps both kinds of row forever when the block names no window", () => {
    expect(validateRetentionBlock({})).toEqual({
      ok: true,
      value: { auditDays: null, pullRequestDays: null },
    });
  });

  it("takes an audit window at or above 30 days", () => {
    for (const days of [30, 365]) {
      const result = validateRetentionBlock({ auditDays: days });
      expect(result.ok && result.value.auditDays).toBe(days);
    }
  });

  it("takes a pull request window of one day or more", () => {
    for (const days of [1, 90]) {
      const result = validateRetentionBlock({ pullRequestDays: days });
      expect(result.ok && result.value.pullRequestDays).toBe(days);
    }
  });

  it("refuses an audit window under the floor and does not clamp it", () => {
    expect(listIssues({ auditDays: 7 })).toEqual([
      "retention: auditDays: must be at least 30 days",
    ]);
  });

  it.each([
    [0, "retention: pullRequestDays: must be at least 1 days"],
    [-7, "retention: pullRequestDays: must be at least 1 days"],
    [2.5, "retention: pullRequestDays: must be a whole number of days"],
    ["soon", "retention: pullRequestDays: must be a number of days"],
  ])("refuses a pull request window of %s", (days, issue) => {
    expect(listIssues({ pullRequestDays: days })).toEqual([issue]);
  });

  it("refuses an unknown key by name", () => {
    expect(listIssues({ auditDay: 30 })).toEqual([
      'retention: unrecognized key "auditDay"',
    ]);
  });

  it("redacts a secret-shaped unknown key", () => {
    const text = listIssues({ "sk-ant-api03-SENTINEL999": 30 }).join("; ");
    expect(text).toContain("(redacted)");
    expect(text).not.toContain("SENTINEL999");
  });
});

describe("validateAuditBlock", () => {
  it("records private writes unless the block turns them off", () => {
    expect(validateAuditBlock({})).toEqual({
      ok: true,
      value: { privateWrites: true },
    });
    expect(validateAuditBlock({ privateWrites: false })).toEqual({
      ok: true,
      value: { privateWrites: false },
    });
  });

  it("refuses a privateWrites that is not a boolean", () => {
    const result = validateAuditBlock({ privateWrites: "off" });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.issues).toEqual([
      "audit: privateWrites: must be true or false",
    ]);
  });
});
