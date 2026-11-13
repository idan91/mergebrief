import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";

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
    if (!result.ok) {
      return;
    }
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
    if (refused.ok) {
      return;
    }
    expect(refused.error.issues.join("; ")).toMatch(/AUDIT_RETENTION_DAYS/);
  });

  it("carries the pull request retention window, unset means keep forever", () => {
    const kept = loadConfig({ ...VALID_ENV, PR_RETENTION_DAYS: "30" });
    expect(kept.ok && kept.value.prRetentionDays).toBe(30);
    const unset = loadConfig(VALID_ENV);
    expect(unset.ok && unset.value.prRetentionDays).toBe(null);

    const refused = loadConfig({ ...VALID_ENV, PR_RETENTION_DAYS: "0" });
    expect(refused.ok).toBe(false);
    if (refused.ok) {
      return;
    }
    expect(refused.error.issues.join("; ")).toMatch(/PR_RETENTION_DAYS/);
  });

  it("carries the pool size, ten when DATABASE_POOL_MAX is unset", () => {
    const sized = loadConfig({ ...VALID_ENV, DATABASE_POOL_MAX: "4" });
    expect(sized.ok && sized.value.poolMax).toBe(4);
    const unset = loadConfig(VALID_ENV);
    expect(unset.ok && unset.value.poolMax).toBe(10);
  });

  it("exposes MERGEBRIEF_AUTO_MIGRATE=false through persistence's loader", () => {
    const result = loadConfig({
      ...VALID_ENV,
      MERGEBRIEF_AUTO_MIGRATE: "false",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.autoMigrate).toBe(false);
  });

  it("composes the instance config's generator block", () => {
    const path = configFile(
      "generator:\n  provider: anthropic\n  model: claude-sonnet-5\n",
    );
    const result = loadConfig({ ...VALID_ENV, MERGEBRIEF_CONFIG: path });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.generator).toEqual({
      provider: "anthropic",
      model: "claude-sonnet-5",
    });
  });

  it("carries the instance's siblingRepos, off when the config is silent", () => {
    const path = configFile(
      "trackers:\n  - kind: github\n    siblingRepos: true\n",
    );
    const on = loadConfig({ ...VALID_ENV, MERGEBRIEF_CONFIG: path });
    const off = loadConfig(VALID_ENV);
    expect(on.ok && on.value.siblingRepos).toBe(true);
    expect(off.ok && off.value.siblingRepos).toBe(false);
  });

  it("refuses boot on a siblingRepos that is not a boolean", () => {
    const path = configFile(
      "trackers:\n  - kind: github\n    siblingRepos: yes please\n",
    );
    const result = loadConfig({ ...VALID_ENV, MERGEBRIEF_CONFIG: path });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.issues.join(";")).toContain("siblingRepos");
  });

  it("refuses boot on a broken instance config with per-field issues", () => {
    const path = configFile("generator:\n  provider: gemini\n");
    const result = loadConfig({ ...VALID_ENV, MERGEBRIEF_CONFIG: path });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.issues.join(";")).toContain("unknown provider");
  });

  it("composes the instance config's linkFetch block", () => {
    const path = configFile(
      "linkFetch:\n  mode: allowlist\n  hosts:\n    - docs.example.com\n",
    );
    const result = loadConfig({ ...VALID_ENV, MERGEBRIEF_CONFIG: path });
    expect(result.ok && result.value.linkFetch).toEqual({
      mode: "allowlist",
      hosts: ["docs.example.com"],
      maxTotalChars: 40_000,
    });
  });

  it("refuses boot on a bad linkFetch block", () => {
    const path = configFile("linkFetch:\n  mode: allowlist\n");
    const result = loadConfig({ ...VALID_ENV, MERGEBRIEF_CONFIG: path });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.issues).toContain(
      'linkFetch: "hosts": the allowlist mode needs at least one host',
    );
  });

  it("refuses boot when the removed GENERATOR_API_KEY_ENV is still set", () => {
    // Loud migration: a stale deployment believes it controls the key
    // source, and silently ignoring it falls back to the default var.
    const result = loadConfig({
      ...VALID_ENV,
      GENERATOR_API_KEY_ENV: "MY_PROVIDER_KEY",
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    const text = result.error.issues.join(";");
    expect(text).toContain("GENERATOR_API_KEY_ENV: removed");
    expect(text).toContain("generator.apiKeyEnv");
  });

  it("rejects a missing PUBLIC_BASE_URL", () => {
    const { PUBLIC_BASE_URL: _omitted, ...withoutBaseUrl } = VALID_ENV;
    const result = loadConfig(withoutBaseUrl);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.issues.join(";")).toContain("PUBLIC_BASE_URL");
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
    if (result.ok) {
      return;
    }
    expect(result.error.issues.join(";")).toContain("WORKER_CONCURRENCY");
  });

  it("rejects a non-integer slot count", () => {
    const result = loadConfig({ ...VALID_ENV, WORKER_CONCURRENCY: "abc" });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.issues.join(";")).toContain("WORKER_CONCURRENCY");
  });

  it("defaults the large pool to one slot when unset or empty", () => {
    const unset = loadConfig(VALID_ENV);
    expect(unset.ok && unset.value.largeConcurrency).toBe(1);
    const empty = loadConfig({ ...VALID_ENV, WORKER_LARGE_CONCURRENCY: "" });
    expect(empty.ok && empty.value.largeConcurrency).toBe(1);
  });

  it("parses a large pool slot count above one", () => {
    const result = loadConfig({ ...VALID_ENV, WORKER_LARGE_CONCURRENCY: "2" });
    expect(result.ok && result.value.largeConcurrency).toBe(2);
  });

  it("rejects a large pool slot count below one by name", () => {
    const result = loadConfig({ ...VALID_ENV, WORKER_LARGE_CONCURRENCY: "0" });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.issues.join(";")).toContain("WORKER_LARGE_CONCURRENCY");
  });

  it("defaults detailConcurrency to eight without a generator block", () => {
    const result = loadConfig(VALID_ENV);
    expect(result.ok && result.value.detailConcurrency).toBe(8);
  });

  it("reads detailConcurrency from the generator block", () => {
    const path = configFile(
      "generator:\n  provider: anthropic\n  detailConcurrency: 3\n",
    );
    const result = loadConfig({ ...VALID_ENV, MERGEBRIEF_CONFIG: path });
    expect(result.ok && result.value.detailConcurrency).toBe(3);
  });

  it.each([
    ["zero", "0"],
    ["a fraction", "1.5"],
  ])("refuses boot on a detailConcurrency of %s", (_label, value) => {
    const path = configFile(
      `generator:\n  provider: anthropic\n  detailConcurrency: ${value}\n`,
    );
    const result = loadConfig({ ...VALID_ENV, MERGEBRIEF_CONFIG: path });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.issues.join(";")).toContain("detailConcurrency");
  });

  it("reads forceMultiCall from the generator block, off by default", () => {
    const unset = loadConfig(VALID_ENV);
    expect(unset.ok && unset.value.forceMultiCall).toBe(false);

    const path = configFile(
      "generator:\n  provider: anthropic\n  forceMultiCall: true\n",
    );
    const result = loadConfig({ ...VALID_ENV, MERGEBRIEF_CONFIG: path });
    expect(result.ok && result.value.forceMultiCall).toBe(true);
  });

  it("reads SERVER_VERSION unset and empty as dev", () => {
    const unset = loadConfig(VALID_ENV);
    expect(unset.ok && unset.value.serverVersion).toBe("dev");
    const empty = loadConfig({ ...VALID_ENV, SERVER_VERSION: "" });
    expect(empty.ok && empty.value.serverVersion).toBe("dev");
    const set = loadConfig({ ...VALID_ENV, SERVER_VERSION: "1.4.0" });
    expect(set.ok && set.value.serverVersion).toBe("1.4.0");
  });

  it("defaults the revision narrative on when unset or empty", () => {
    const unset = loadConfig(VALID_ENV);
    expect(unset.ok && unset.value.revisionNarrative).toEqual({
      enabled: true,
    });
    const empty = loadConfig({ ...VALID_ENV, REVISION_NARRATIVE_ENABLED: "" });
    expect(empty.ok && empty.value.revisionNarrative).toEqual({
      enabled: true,
    });
  });

  it("reads REVISION_NARRATIVE_ENABLED=false as off", () => {
    const result = loadConfig({
      ...VALID_ENV,
      REVISION_NARRATIVE_ENABLED: "false",
    });
    expect(result.ok && result.value.revisionNarrative).toEqual({
      enabled: false,
    });
  });

  it("defaults HUGE_SPAN_RATIO to 0.65 when unset or empty", () => {
    const unset = loadConfig(VALID_ENV);
    expect(unset.ok && unset.value.hugeSpanRatio).toBe(0.65);
    const empty = loadConfig({ ...VALID_ENV, HUGE_SPAN_RATIO: "" });
    expect(empty.ok && empty.value.hugeSpanRatio).toBe(0.65);
    const set = loadConfig({ ...VALID_ENV, HUGE_SPAN_RATIO: "0.5" });
    expect(set.ok && set.value.hugeSpanRatio).toBe(0.5);
  });

  it.each([
    ["PUBLIC_BASE_URL", { PUBLIC_BASE_URL: "ftp://leak-marker.test" }],
    ["SERVER_VERSION", { SERVER_VERSION: "leak-marker 1.4.0" }],
    [
      "REVISION_NARRATIVE_ENABLED",
      { REVISION_NARRATIVE_ENABLED: "leak-marker" },
    ],
    ["HUGE_SPAN_RATIO", { HUGE_SPAN_RATIO: "leak-marker" }],
  ])("names %s without echoing its value", (key, overrides) => {
    const result = loadConfig({ ...VALID_ENV, ...overrides });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    const text = result.error.issues.join(";");
    expect(text).toContain(key);
    expect(text).not.toContain("leak-marker");
  });

  it("collects issues from multiple surfaces at once", () => {
    const result = loadConfig({ GENERATOR_API_KEY_ENV: "X" });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.issues.length).toBeGreaterThanOrEqual(3);
  });
});
