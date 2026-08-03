import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ConfigErrorCode, loadConfig } from "../src/config";

const VALID_ENV = {
  DATABASE_URL: "postgres://user:pass@localhost:5432/db",
  PUBLIC_BASE_URL: "https://brief.example",
};

const tempDirs: string[] = [];
function configFile(contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), "worker-config-"));
  tempDirs.push(dir);
  const path = join(dir, "mergebrief.config.yaml");
  writeFileSync(path, contents);
  return path;
}
afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("loadConfig", () => {
  it("parses a valid env into the zero-config generator default", () => {
    // Key presence is createGenerator's boot check now, not loadConfig's —
    // the generator block just selects the adapter.
    const result = loadConfig(VALID_ENV);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.databaseUrl).toBe(VALID_ENV.DATABASE_URL);
    expect(result.value.generator).toEqual({ provider: "anthropic" });
    expect(result.value.publicBaseUrl).toBe(VALID_ENV.PUBLIC_BASE_URL);
    expect(result.value.autoMigrate).toBe(true);
  });

  it("exposes MERGEBRIEF_AUTO_MIGRATE=false through persistence's loader (BRIEF-131)", () => {
    const result = loadConfig({
      ...VALID_ENV,
      MERGEBRIEF_AUTO_MIGRATE: "false",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.autoMigrate).toBe(false);
  });

  it("composes the instance config's generator block", () => {
    const path = configFile(
      "generator:\n  provider: anthropic\n  model: claude-sonnet-5\n",
    );
    const result = loadConfig({ ...VALID_ENV, MERGEBRIEF_CONFIG: path });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.generator).toEqual({
      provider: "anthropic",
      model: "claude-sonnet-5",
    });
  });

  it("refuses boot on a broken instance config with per-field issues", () => {
    const path = configFile("generator:\n  provider: gemini\n");
    const result = loadConfig({ ...VALID_ENV, MERGEBRIEF_CONFIG: path });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.issues.join(";")).toContain("unknown provider");
  });

  it("refuses boot when the removed GENERATOR_API_KEY_ENV is still set", () => {
    // Loud migration: a stale deployment believes it controls the key
    // source — silently ignoring it would fall back to the default var.
    const result = loadConfig({
      ...VALID_ENV,
      GENERATOR_API_KEY_ENV: "MY_PROVIDER_KEY",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const text = result.error.issues.join(";");
    expect(text).toContain("GENERATOR_API_KEY_ENV: removed");
    expect(text).toContain("generator.apiKeyEnv");
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

  it("rejects a missing DATABASE_URL", () => {
    const result = loadConfig({ PUBLIC_BASE_URL: VALID_ENV.PUBLIC_BASE_URL });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe(ConfigErrorCode.INVALID);
    expect(result.error.issues.join(";")).toContain("DATABASE_URL");
  });

  it("rejects a non-postgres DATABASE_URL", () => {
    const result = loadConfig({
      ...VALID_ENV,
      DATABASE_URL: "mysql://localhost/db",
    });
    expect(result.ok).toBe(false);
  });

  it("collects issues from multiple surfaces at once", () => {
    const result = loadConfig({ GENERATOR_API_KEY_ENV: "X" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.issues.length).toBeGreaterThanOrEqual(3);
  });
});
