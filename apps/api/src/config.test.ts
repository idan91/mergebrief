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

describe("loadConfig SESSION_KEY_REF", () => {
  const BASE = { PUBLIC_BASE_URL: "https://brief.example.test" };

  function readKeyRef(env: Record<string, string>): string {
    const result = loadConfig(env);
    if (!result.ok) {
      throw new Error("expected a valid config");
    }
    return result.value.sessionKeyRef;
  }

  it("reads unset and empty as SESSION_KEY_V1", () => {
    expect(readKeyRef(BASE)).toBe("SESSION_KEY_V1");
    expect(readKeyRef({ ...BASE, SESSION_KEY_REF: "" })).toBe("SESSION_KEY_V1");
  });

  it("takes another env var name", () => {
    expect(readKeyRef({ ...BASE, SESSION_KEY_REF: "SESSION_KEY_V2" })).toBe(
      "SESSION_KEY_V2",
    );
  });

  it("refuses a value that is not an env var name, such as key material", () => {
    const keyMaterial = "q3T0n8mLwq0z5d1X2YcFvQ9hG4kP7sRbJ6uE1aZoN0w=";
    const result = loadConfig({ ...BASE, SESSION_KEY_REF: keyMaterial });

    expect(result).toMatchObject({
      ok: false,
      error: { issues: [expect.stringMatching(/^SESSION_KEY_REF: /)] },
    });
    expect(JSON.stringify(result)).not.toContain(keyMaterial);
  });
});

describe("loadConfig refusals never echo the value", () => {
  const BASE = { PUBLIC_BASE_URL: "https://brief.example.test" };
  const MARKER = "leak-marker";

  it.each([
    ["SERVER_VERSION", { ...BASE, SERVER_VERSION: `${MARKER} 1.4.0` }],
    ["PUBLIC_BASE_URL", { PUBLIC_BASE_URL: `ftp://${MARKER}.test` }],
    ["SESSION_KEY_REF", { ...BASE, SESSION_KEY_REF: MARKER }],
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
