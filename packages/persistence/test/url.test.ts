import { describe, expect, it } from "vitest";
import { isHttpUrl } from "../src/url";

describe("isHttpUrl", () => {
  it("accepts an absolute http or https URL", () => {
    expect(isHttpUrl("http://localhost:3000")).toBe(true);
    expect(isHttpUrl("https://brief.example.test/path")).toBe(true);
  });

  it("refuses a relative URL, a bare host and other schemes", () => {
    expect(isHttpUrl("brief.example.test")).toBe(false);
    expect(isHttpUrl("/version.json")).toBe(false);
    expect(isHttpUrl("ftp://brief.example.test")).toBe(false);
    expect(isHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isHttpUrl("")).toBe(false);
  });

  it("refuses a URL that carries credentials", () => {
    expect(isHttpUrl("https://reviewer:secret@brief.example.test")).toBe(false);
    expect(isHttpUrl("https://reviewer@brief.example.test")).toBe(false);
  });
});
