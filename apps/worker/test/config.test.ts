import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ConfigErrorCodes, loadConfig } from "../src/config";

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
    // Key presence is createGenerator's boot check now, not loadConfig's;
    // the generator block just selects the adapter.
    const result = loadConfig(VALID_ENV);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.databaseUrl).toBe(VALID_ENV.DATABASE_URL);
    expect(result.value.generator).toEqual({ provider: "anthropic" });
    expect(result.value.publicBaseUrl).toBe(VALID_ENV.PUBLIC_BASE_URL);
    expect(result.value.autoMigrate).toBe(true);
  });

  it("carries the audit retention window, refusing one under the floor", () => {
    const kept = loadConfig({ ...VALID_ENV, AUDIT_RETENTION_DAYS: "90" });
    expect(kept.ok && kept.value.auditRetentionDays).toBe(90);
    // Unset is the default posture: keep forever.
    const unset = loadConfig(VALID_ENV);
    expect(unset.ok && unset.value.auditRetentionDays).toBe(null);

    const refused = loadConfig({ ...VALID_ENV, AUDIT_RETENTION_DAYS: "7" });
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.error.issues.join("; ")).toMatch(/AUDIT_RETENTION_DAYS/);
  });

  it("exposes MERGEBRIEF_AUTO_MIGRATE=false through persistence's loader", () => {
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
    // source, and silently ignoring it falls back to the default var.
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

  it("rejects a missing PUBLIC_BASE_URL", () => {
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
    expect(result.error.code).toBe(ConfigErrorCodes.INVALID);
    expect(result.error.issues.join(";")).toContain("DATABASE_URL");
  });

  it("rejects a non-postgres DATABASE_URL", () => {
    const result = loadConfig({
      ...VALID_ENV,
      DATABASE_URL: "mysql://localhost/db",
    });
    expect(result.ok).toBe(false);
  });

  it("defaults the slot count to one when unset", () => {
    const result = loadConfig(VALID_ENV);
    expect(result.ok && result.value.concurrency).toBe(1);
  });

  it("parses a slot count above one", () => {
    const result = loadConfig({ ...VALID_ENV, WORKER_CONCURRENCY: "3" });
    expect(result.ok && result.value.concurrency).toBe(3);
  });

  it("rejects a slot count below one", () => {
    const result = loadConfig({ ...VALID_ENV, WORKER_CONCURRENCY: "0" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.issues.join(";")).toContain("WORKER_CONCURRENCY");
  });

  it("rejects a non-integer slot count", () => {
    const result = loadConfig({ ...VALID_ENV, WORKER_CONCURRENCY: "abc" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.issues.join(";")).toContain("WORKER_CONCURRENCY");
  });

  it("collects issues from multiple surfaces at once", () => {
    const result = loadConfig({ GENERATOR_API_KEY_ENV: "X" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.issues.length).toBeGreaterThanOrEqual(3);
  });
});
