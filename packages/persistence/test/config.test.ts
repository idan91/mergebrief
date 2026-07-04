// Stage 6 config tests. Defaults applied, bad DATABASE_URL rejected, boolean
// token parsing, injectable env (never touches process.env), no secret leak.
// Result narrowing uses `if (!x.ok) throw` so no `expect` is conditional.
import { describe, expect, it } from "vitest";
import {
  ConfigErrorCode,
  loadConfig,
  type ConfigError,
  type PersistenceConfig,
} from "../src/config.js";
import type { Result } from "../src/types.js";

const VALID_URL = "postgres://user:pass@localhost:5432/app";

function ok(result: Result<PersistenceConfig, ConfigError>): PersistenceConfig {
  if (!result.ok) {
    throw new Error(
      `expected config to load: ${result.error.issues.join("; ")}`,
    );
  }
  return result.value;
}

function err(result: Result<PersistenceConfig, ConfigError>): ConfigError {
  if (result.ok) {
    throw new Error("expected config to be rejected");
  }
  return result.error;
}

describe("config — loadConfig", () => {
  it("applies self-host defaults (both flags ON) when only DATABASE_URL is set", () => {
    const config = ok(loadConfig({ DATABASE_URL: VALID_URL }));
    expect(config.databaseUrl).toBe(VALID_URL);
    expect(config.persistBaselineSnapshot).toBe(true);
    expect(config.storeDisplayNames).toBe(true);
  });

  it("accepts the postgresql:// scheme", () => {
    expect(loadConfig({ DATABASE_URL: "postgresql://localhost/app" }).ok).toBe(
      true,
    );
  });

  it("rejects a missing DATABASE_URL", () => {
    const error = err(loadConfig({}));
    expect(error.code).toBe(ConfigErrorCode.invalid);
    expect(error.issues.some((i) => i.startsWith("DATABASE_URL"))).toBe(true);
  });

  it("rejects a non-URL / wrong-scheme DATABASE_URL", () => {
    for (const bad of [
      "not-a-url",
      "http://localhost/app",
      "mysql://localhost/app",
      "",
    ]) {
      expect(loadConfig({ DATABASE_URL: bad }).ok).toBe(false);
    }
  });

  it("does not echo the DATABASE_URL value (secret) in error output", () => {
    const secretish = "http://user:supersecret@host/db";
    const error = err(loadConfig({ DATABASE_URL: secretish }));
    const joined = [error.message, ...error.issues].join(" ");
    expect(joined).not.toContain("supersecret");
  });

  it("parses truthy boolean tokens", () => {
    for (const token of ["true", "1", "yes", "on", "TRUE", " On "]) {
      const config = ok(
        loadConfig({
          DATABASE_URL: VALID_URL,
          PERSIST_BASELINE_SNAPSHOT: token,
        }),
      );
      expect(config.persistBaselineSnapshot).toBe(true);
    }
  });

  it("parses falsy boolean tokens", () => {
    for (const token of ["false", "0", "no", "off", "FALSE", ""]) {
      const config = ok(
        loadConfig({ DATABASE_URL: VALID_URL, STORE_DISPLAY_NAMES: token }),
      );
      expect(config.storeDisplayNames).toBe(false);
    }
  });

  it("rejects an unrecognized boolean token", () => {
    const error = err(
      loadConfig({
        DATABASE_URL: VALID_URL,
        PERSIST_BASELINE_SNAPSHOT: "maybe",
      }),
    );
    expect(
      error.issues.some((i) => i.startsWith("PERSIST_BASELINE_SNAPSHOT")),
    ).toBe(true);
  });

  it("both flags can be independently overridden OFF (hosted-strict posture)", () => {
    const config = ok(
      loadConfig({
        DATABASE_URL: VALID_URL,
        PERSIST_BASELINE_SNAPSHOT: "false",
        STORE_DISPLAY_NAMES: "0",
      }),
    );
    expect(config.persistBaselineSnapshot).toBe(false);
    expect(config.storeDisplayNames).toBe(false);
  });

  it("ignores unknown env keys", () => {
    expect(
      loadConfig({ DATABASE_URL: VALID_URL, UNRELATED: "x", PATH: "/bin" }).ok,
    ).toBe(true);
  });
});
