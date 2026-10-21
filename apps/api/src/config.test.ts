import { describe, expect, it } from "vitest";
import { loadConfig, loadServerVersion } from "./config";

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

  it("reads an empty MERGEBRIEF_UPDATE_CHECK as the default", () => {
    const result = loadConfig({ ...BASE, MERGEBRIEF_UPDATE_CHECK: "" });
    expect(result).toMatchObject({ ok: true, value: { updateCheck: true } });
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

describe("loadConfig attachment quota knobs", () => {
  const BASE = { PUBLIC_BASE_URL: "http://localhost:3000" };
  const MB = 1024 * 1024;
  const MINUTE_MS = 60_000;

  it("defaults to 10 files or 30 MB per 10 minutes", () => {
    const expected = {
      maxFiles: 10,
      maxBytes: 30 * MB,
      windowMs: 10 * MINUTE_MS,
    };
    expect(loadConfig(BASE)).toMatchObject({
      ok: true,
      value: { attachmentQuota: expected },
    });
    expect(
      loadConfig({
        ...BASE,
        MERGEBRIEF_ATTACHMENT_QUOTA_FILES: "",
        MERGEBRIEF_ATTACHMENT_QUOTA_MB: " ",
        MERGEBRIEF_ATTACHMENT_QUOTA_WINDOW_MINUTES: "",
      }),
    ).toMatchObject({ ok: true, value: { attachmentQuota: expected } });
  });

  it("takes an override for each of the three limits", () => {
    const result = loadConfig({
      ...BASE,
      MERGEBRIEF_ATTACHMENT_QUOTA_FILES: "3",
      MERGEBRIEF_ATTACHMENT_QUOTA_MB: "50",
      MERGEBRIEF_ATTACHMENT_QUOTA_WINDOW_MINUTES: "60",
    });
    expect(result).toMatchObject({
      ok: true,
      value: {
        attachmentQuota: {
          maxFiles: 3,
          maxBytes: 50 * MB,
          windowMs: 60 * MINUTE_MS,
        },
      },
    });
  });

  it("refuses a megabyte limit under the size limit of one file", () => {
    const result = loadConfig({ ...BASE, MERGEBRIEF_ATTACHMENT_QUOTA_MB: "9" });
    expect(result).toMatchObject({
      ok: false,
      error: {
        issues: [
          "MERGEBRIEF_ATTACHMENT_QUOTA_MB: must be at least 10, the megabyte limit of one file",
        ],
      },
    });
  });

  it("takes a megabyte limit equal to the size limit of one file", () => {
    const result = loadConfig({
      ...BASE,
      MERGEBRIEF_ATTACHMENT_QUOTA_MB: "10",
    });
    expect(result).toMatchObject({
      ok: true,
      value: { attachmentQuota: { maxBytes: 10 * MB } },
    });
  });

  const KEYS = [
    "MERGEBRIEF_ATTACHMENT_QUOTA_FILES",
    "MERGEBRIEF_ATTACHMENT_QUOTA_MB",
    "MERGEBRIEF_ATTACHMENT_QUOTA_WINDOW_MINUTES",
  ];
  const INVALID = ["ten", "99999999999999999999"];
  const CASES = KEYS.flatMap((key) => INVALID.map((value) => [key, value]));

  it.each(CASES)("refuses %s set to %s, naming the key", (key, value) => {
    const result = loadConfig({ ...BASE, [key]: value });
    expect(result).toMatchObject({
      ok: false,
      error: { issues: [`${key}: must be a positive whole number`] },
    });
  });
});

describe("loadConfig SERVER_VERSION", () => {
  const BASE = { PUBLIC_BASE_URL: "https://brief.example.test" };

  it("takes a printable version and refuses one a header cannot carry", () => {
    expect(loadConfig({ ...BASE, SERVER_VERSION: "1.4.0" }).ok).toBe(true);
    expect(loadConfig({ ...BASE, SERVER_VERSION: "1.4.0\n" }).ok).toBe(false);
    expect(loadConfig({ ...BASE, SERVER_VERSION: "1 .4.0" }).ok).toBe(false);
  });

  it("reads unset and empty as dev", () => {
    expect(loadConfig(BASE)).toMatchObject({
      ok: true,
      value: { serverVersion: "dev" },
    });
    expect(loadConfig({ ...BASE, SERVER_VERSION: "" })).toMatchObject({
      ok: true,
      value: { serverVersion: "dev" },
    });
  });

  it("loadServerVersion reads empty as dev and refuses a bad token", () => {
    expect(loadServerVersion({ SERVER_VERSION: "" })).toEqual({
      ok: true,
      value: "dev",
    });
    expect(loadServerVersion({ SERVER_VERSION: "1 .4.0" }).ok).toBe(false);
  });
});

describe("loadConfig local Briefs dir", () => {
  const BASE = {
    PUBLIC_BASE_URL: "https://brief.example.test",
    MERGEBRIEF_OUT_DIR: "tools/categorizer/out",
  };

  function readDir(env: Record<string, string>): string | undefined {
    const result = loadConfig(env);
    if (!result.ok) {
      throw new Error("expected a valid config");
    }
    return result.value.localBriefsDir;
  }

  it("takes the dir as written outside production", () => {
    expect(readDir(BASE)).toBe("tools/categorizer/out");
    expect(readDir({ ...BASE, NODE_ENV: "development" })).toBe(
      "tools/categorizer/out",
    );
  });

  it("reads unset and blank as no dir", () => {
    expect(readDir({ PUBLIC_BASE_URL: BASE.PUBLIC_BASE_URL })).toBeUndefined();
    expect(readDir({ ...BASE, MERGEBRIEF_OUT_DIR: "  " })).toBeUndefined();
  });

  it("never sets a dir in the shipped image or under NODE_ENV=production", () => {
    expect(
      readDir({ ...BASE, MERGEBRIEF_RUNTIME: "compose-worker" }),
    ).toBeUndefined();
    expect(readDir({ ...BASE, NODE_ENV: "production" })).toBeUndefined();
  });
});

describe("loadConfig refusals never echo the value", () => {
  const BASE = { PUBLIC_BASE_URL: "https://brief.example.test" };
  const MARKER = "leak-marker";

  it.each([
    ["SERVER_VERSION", { ...BASE, SERVER_VERSION: `${MARKER} 1.4.0` }],
    ["PUBLIC_BASE_URL", { PUBLIC_BASE_URL: `ftp://${MARKER}.test` }],
    ["MERGEBRIEF_UPDATE_CHECK", { ...BASE, MERGEBRIEF_UPDATE_CHECK: MARKER }],
    [
      "MERGEBRIEF_ATTACHMENT_QUOTA_FILES",
      { ...BASE, MERGEBRIEF_ATTACHMENT_QUOTA_FILES: MARKER },
    ],
    [
      "MERGEBRIEF_ATTACHMENT_QUOTA_MB",
      { ...BASE, MERGEBRIEF_ATTACHMENT_QUOTA_MB: MARKER },
    ],
    [
      "MERGEBRIEF_ATTACHMENT_QUOTA_WINDOW_MINUTES",
      { ...BASE, MERGEBRIEF_ATTACHMENT_QUOTA_WINDOW_MINUTES: MARKER },
    ],
  ])("names %s without its value", (key, env) => {
    const result = loadConfig(env);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    const text = result.error.issues.join("; ");
    expect(text).toContain(key);
    expect(text).not.toContain(MARKER);
  });
});
