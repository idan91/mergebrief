import { describe, expect, it } from "vitest";
import { ConfigErrorCode, loadConfig } from "../src/config";

const VALID_ENV = {
  DATABASE_URL: "postgres://user:pass@localhost:5432/db",
  ANTHROPIC_API_KEY: "sk-ant-test",
  PUBLIC_BASE_URL: "https://brief.example",
};

describe("loadConfig", () => {
  it("parses a valid env with the default key var", () => {
    const result = loadConfig(VALID_ENV);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.databaseUrl).toBe(VALID_ENV.DATABASE_URL);
    expect(result.value.providerApiKeyEnv).toBe("ANTHROPIC_API_KEY");
    expect(result.value.providerApiKey).toBe("sk-ant-test");
    expect(result.value.publicBaseUrl).toBe("https://brief.example");
  });

  it("rejects a missing PUBLIC_BASE_URL (the Entry comment's deep-link base)", () => {
    const { PUBLIC_BASE_URL: _omitted, ...withoutBaseUrl } = VALID_ENV;
    const result = loadConfig(withoutBaseUrl);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.issues.join(";")).toContain("PUBLIC_BASE_URL");
  });

  it("rejects a non-URL PUBLIC_BASE_URL", () => {
    const result = loadConfig({ ...VALID_ENV, PUBLIC_BASE_URL: "not a url" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.issues.join(";")).toContain("PUBLIC_BASE_URL");
  });

  it("resolves the key from a custom env-var name (BYOK by env-name)", () => {
    const result = loadConfig({
      DATABASE_URL: VALID_ENV.DATABASE_URL,
      PUBLIC_BASE_URL: VALID_ENV.PUBLIC_BASE_URL,
      GENERATOR_API_KEY_ENV: "MY_PROVIDER_KEY",
      MY_PROVIDER_KEY: "byok-key",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.providerApiKeyEnv).toBe("MY_PROVIDER_KEY");
    expect(result.value.providerApiKey).toBe("byok-key");
  });

  it("rejects a missing DATABASE_URL", () => {
    const result = loadConfig({ ANTHROPIC_API_KEY: "sk-ant-test" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe(ConfigErrorCode.INVALID);
    expect(result.error.issues.join(";")).toContain("DATABASE_URL");
  });

  it("rejects a non-postgres DATABASE_URL", () => {
    const result = loadConfig({
      DATABASE_URL: "mysql://localhost/db",
      ANTHROPIC_API_KEY: "sk-ant-test",
    });
    expect(result.ok).toBe(false);
  });

  it("rejects when the named key var is unset, naming the VARIABLE only", () => {
    const result = loadConfig({
      DATABASE_URL: VALID_ENV.DATABASE_URL,
      GENERATOR_API_KEY_ENV: "MISSING_KEY_VAR",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.issues.join(";")).toContain("MISSING_KEY_VAR");
  });

  it("rejects an empty key value without echoing any value", () => {
    const result = loadConfig({
      DATABASE_URL: VALID_ENV.DATABASE_URL,
      ANTHROPIC_API_KEY: "",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // No secret material in the error surface.
    expect(JSON.stringify(result.error)).not.toContain("pass");
  });

  it("collects issues from both fields at once", () => {
    const result = loadConfig({});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.issues.length).toBeGreaterThanOrEqual(2);
  });
});
