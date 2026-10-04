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

describe("loadConfig update check knobs", () => {
  const BASE = { PUBLIC_BASE_URL: "http://localhost:3000" };

  it("defaults the check on with the GitHub release URL", () => {
    const result = loadConfig(BASE);
    expect(result).toMatchObject({
      ok: true,
      value: {
        updateCheck: true,
        updateCheckUrl: expect.stringContaining("/releases/latest/download/"),
      },
    });
  });

  it("reads MERGEBRIEF_UPDATE_CHECK=false as off", () => {
    const result = loadConfig({ ...BASE, MERGEBRIEF_UPDATE_CHECK: "false" });
    expect(result).toMatchObject({ ok: true, value: { updateCheck: false } });
  });

  it("refuses an update check token it does not know", () => {
    expect(loadConfig({ ...BASE, MERGEBRIEF_UPDATE_CHECK: "maybe" }).ok).toBe(
      false,
    );
  });

  it("takes an absolute update check URL and refuses a relative one", () => {
    const mirror = "https://mirror.example.test/version.json";
    expect(
      loadConfig({ ...BASE, MERGEBRIEF_UPDATE_CHECK_URL: mirror }),
    ).toMatchObject({ ok: true, value: { updateCheckUrl: mirror } });
    expect(
      loadConfig({
        ...BASE,
        MERGEBRIEF_UPDATE_CHECK_URL: "mirror/version.json",
      }).ok,
    ).toBe(false);
  });
});

describe("loadConfig SERVER_VERSION", () => {
  const BASE = { PUBLIC_BASE_URL: "https://brief.example.test" };

  it("takes a printable version and refuses one a header cannot carry", () => {
    expect(loadConfig({ ...BASE, SERVER_VERSION: "1.4.0" }).ok).toBe(true);
    expect(loadConfig({ ...BASE, SERVER_VERSION: "1.4.0\n" }).ok).toBe(false);
    expect(loadConfig({ ...BASE, SERVER_VERSION: "1 .4.0" }).ok).toBe(false);
  });
});
