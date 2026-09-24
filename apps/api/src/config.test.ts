import { describe, expect, it } from "vitest";
import { loadConfig } from "./config";

describe("loadConfig PUBLIC_BASE_URL", () => {
  it("accepts an absolute http or https URL", () => {
    expect(
      loadConfig({ PUBLIC_BASE_URL: "https://brief.example.test" }).ok,
    ).toBe(true);
    expect(loadConfig({ PUBLIC_BASE_URL: "http://localhost:3000" }).ok).toBe(
      true,
    );
  });

  it("refuses a value that is not a URL", () => {
    const result = loadConfig({ PUBLIC_BASE_URL: "brief.example.test" });
    expect(result).toMatchObject({
      ok: false,
      error: {
        issues: [expect.stringContaining("PUBLIC_BASE_URL")],
      },
    });
  });

  it("refuses a scheme other than http or https", () => {
    expect(loadConfig({ PUBLIC_BASE_URL: "ftp://brief.example.test" }).ok).toBe(
      false,
    );
  });

  it("still requires the value", () => {
    expect(loadConfig({}).ok).toBe(false);
  });
});
