import { describe, expect, it } from "vitest";
import { sanitizeErrorDetail } from "../src/sanitize";

const LEAKY_URL = "postgres://user:hunter2@db.internal:5432/app";

describe("sanitizeErrorDetail", () => {
  it("keeps only the first line", () => {
    expect(sanitizeErrorDetail("config invalid\nstack frame 1\nframe 2")).toBe(
      "config invalid",
    );
  });

  it("drops the trailing carriage return of a CRLF line", () => {
    expect(sanitizeErrorDetail("config invalid\r\nrest")).toBe(
      "config invalid",
    );
  });

  it("redacts a URL-shaped substring", () => {
    expect(sanitizeErrorDetail(`connect failed for ${LEAKY_URL}`)).toBe(
      "connect failed for [redacted-url]",
    );
    expect(
      sanitizeErrorDetail(`connect failed for ${LEAKY_URL}`),
    ).not.toContain("hunter2");
  });

  it("redacts every URL on the line", () => {
    expect(
      sanitizeErrorDetail(`tried ${LEAKY_URL} then https://api.github.com/x`),
    ).toBe("tried [redacted-url] then [redacted-url]");
  });

  it("redacts file:// URLs too — detail is never a stack", () => {
    expect(sanitizeErrorDetail("thrown at file:///app/src/main.ts:10:5")).toBe(
      "thrown at [redacted-url]",
    );
  });

  it("caps at 300 chars after redaction", () => {
    const long = "x".repeat(400);
    expect(sanitizeErrorDetail(long)).toBe("x".repeat(300));
  });

  it("leaves empty input empty — no fallback copy", () => {
    expect(sanitizeErrorDetail("")).toBe("");
  });

  it("yields empty for a leading newline — callers gate on the result", () => {
    expect(sanitizeErrorDetail("\nreal message on line two")).toBe("");
  });

  it("redacts a credential-shaped token — this text reaches a DB column", () => {
    expect(
      sanitizeErrorDetail("401 invalid x-api-key sk-ant-api03-LeAkEd_Key-999"),
    ).toBe("401 invalid x-api-key [redacted-token]");
  });

  it("redacts every issuer shape the log boundary knows", () => {
    for (const token of [
      "sk-proj-AbCdEfGhIjKlMnOpQrSt",
      "ghp_AbCdEfGhIjKlMnOpQrStUvWx0123",
      "github_pat_11ABCDEFG0abcdefghij_KLMNOP",
      "xoxb-1234567890-abcdefghij",
      "mergebrief_AbCdEfGhIjKlMnOpQr",
      "AKIAIOSFODNN7EXAMPLE",
    ]) {
      expect(sanitizeErrorDetail(`failed with ${token} today`)).not.toContain(
        token,
      );
    }
  });

  it("leaves a short URL-free line untouched", () => {
    expect(sanitizeErrorDetail("missing ANTHROPIC_API_KEY")).toBe(
      "missing ANTHROPIC_API_KEY",
    );
  });
});
