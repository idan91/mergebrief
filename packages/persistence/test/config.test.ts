// Config tests. Defaults applied, bad DATABASE_URL rejected, boolean
// token parsing, injectable env (never touches process.env), no secret leak.
// Result narrowing uses `if (!x.ok) throw` so no `expect` is conditional.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ConfigErrorCodes,
  loadConfig,
  type ConfigError,
  type PersistenceConfig,
} from "../src/db/config";
import type { Result } from "types/utils";

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

describe("config: loadConfig", () => {
  it("keeps display names ON by default when only DATABASE_URL is set", () => {
    const config = ok(loadConfig({ DATABASE_URL: VALID_URL }));
    expect(config.databaseUrl).toBe(VALID_URL);
    expect(config.storeDisplayNames).toBe(true);
  });

  it("keeps audit history forever and records private writes by default", () => {
    const config = ok(loadConfig({ DATABASE_URL: VALID_URL }));
    expect(config.auditRetentionDays).toBeNull();
    expect(config.auditPrivateWrites).toBe(true);
  });

  it("accepts an audit retention window at or above the floor", () => {
    expect(
      ok(loadConfig({ DATABASE_URL: VALID_URL, AUDIT_RETENTION_DAYS: "30" }))
        .auditRetentionDays,
    ).toBe(30);
    expect(
      ok(loadConfig({ DATABASE_URL: VALID_URL, AUDIT_RETENTION_DAYS: "365" }))
        .auditRetentionDays,
    ).toBe(365);
  });

  it("refuses a retention window below the floor rather than clamping it", () => {
    const error = err(
      loadConfig({ DATABASE_URL: VALID_URL, AUDIT_RETENTION_DAYS: "7" }),
    );
    expect(error.code).toBe(ConfigErrorCodes.INVALID);
    expect(error.issues.join("; ")).toMatch(/AUDIT_RETENTION_DAYS/);
  });

  it("refuses a non-integer or unparseable retention window", () => {
    expect(
      err(
        loadConfig({ DATABASE_URL: VALID_URL, AUDIT_RETENTION_DAYS: "30.5" }),
      ).issues.join("; "),
    ).toMatch(/whole number/);
    expect(
      err(
        loadConfig({ DATABASE_URL: VALID_URL, AUDIT_RETENTION_DAYS: "soon" }),
      ).issues.join("; "),
    ).toMatch(/AUDIT_RETENTION_DAYS/);
  });

  it("keeps closed pull requests forever by default", () => {
    const unsetConfig = ok(loadConfig({ DATABASE_URL: VALID_URL }));
    const blankConfig = ok(
      loadConfig({ DATABASE_URL: VALID_URL, PR_RETENTION_DAYS: "" }),
    );
    expect(unsetConfig.prRetentionDays).toBe(null);
    expect(blankConfig.prRetentionDays).toBe(null);
  });

  it("accepts a pull request retention window of one day or more", () => {
    const oneDayConfig = ok(
      loadConfig({ DATABASE_URL: VALID_URL, PR_RETENTION_DAYS: "1" }),
    );
    const ninetyDayConfig = ok(
      loadConfig({ DATABASE_URL: VALID_URL, PR_RETENTION_DAYS: "90" }),
    );
    expect(oneDayConfig.prRetentionDays).toBe(1);
    expect(ninetyDayConfig.prRetentionDays).toBe(90);
  });

  it.each([
    ["0", /at least 1/],
    ["-7", /at least 1/],
    ["2.5", /whole number/],
    ["soon", /PR_RETENTION_DAYS/],
  ])("refuses a pull request retention window of %s", (raw, reason) => {
    const error = err(
      loadConfig({ DATABASE_URL: VALID_URL, PR_RETENTION_DAYS: raw }),
    );
    expect(error.code).toBe(ConfigErrorCodes.INVALID);
    expect(error.issues.join("; ")).toMatch(/PR_RETENTION_DAYS/);
    expect(error.issues.join("; ")).toMatch(reason);
  });

  it("takes the audit opt-out as a boolean token", () => {
    const config = ok(
      loadConfig({ DATABASE_URL: VALID_URL, AUDIT_PRIVATE_WRITES: "off" }),
    );
    expect(config.auditPrivateWrites).toBe(false);
  });

  it("accepts the postgresql:// scheme", () => {
    expect(loadConfig({ DATABASE_URL: "postgresql://localhost/app" }).ok).toBe(
      true,
    );
  });

  it("rejects a missing DATABASE_URL", () => {
    const error = err(loadConfig({}));
    expect(error.code).toBe(ConfigErrorCodes.INVALID);
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

  it("does not echo the secret DATABASE_URL value in error output", () => {
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
          STORE_DISPLAY_NAMES: token,
        }),
      );
      expect(config.storeDisplayNames).toBe(true);
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
        AUDIT_PRIVATE_WRITES: "maybe",
      }),
    );
    const namesTheFlag = error.issues.some((issue) =>
      issue.startsWith("AUDIT_PRIVATE_WRITES"),
    );
    expect(namesTheFlag).toBe(true);
  });

  it("ignores unknown env keys", () => {
    expect(
      loadConfig({ DATABASE_URL: VALID_URL, UNRELATED: "x", PATH: "/bin" }).ok,
    ).toBe(true);
  });
});

// DATABASE_URL_FILE: the `_FILE` secret-file convention for exactly this
// one variable. File wins over the plain variable (with a
// warning through the injected sink); content is trimmed; an unreadable
// file is a clear boot error.
const fileEnv = (path: string) => ({ DATABASE_URL_FILE: path });

describe("config: DATABASE_URL_FILE", () => {
  it("trims CRLF and surrounding whitespace from the file content", () => {
    const config = ok(
      loadConfig(fileEnv("/run/secrets/db-url"), {
        readFile: () => `  ${VALID_URL}\r\n`,
      }),
    );
    expect(config.databaseUrl).toBe(VALID_URL);
  });

  it("prefers the file and warns, naming the shadowed DATABASE_URL", () => {
    const warnings: string[] = [];
    const config = ok(
      loadConfig(
        {
          DATABASE_URL: "postgres://other:secret@localhost:5432/shadowed",
          DATABASE_URL_FILE: "/run/secrets/db-url",
        },
        {
          readFile: () => VALID_URL,
          onWarning: (message) => warnings.push(message),
        },
      ),
    );
    expect(config.databaseUrl).toBe(VALID_URL);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("DATABASE_URL_FILE");
    expect(warnings[0]).toContain("DATABASE_URL");
  });

  it("neither warns nor crashes when both are set and no sink is injected", () => {
    const config = ok(
      loadConfig(
        {
          DATABASE_URL: "postgres://other:secret@localhost:5432/shadowed",
          DATABASE_URL_FILE: "/run/secrets/db-url",
        },
        { readFile: () => VALID_URL },
      ),
    );
    expect(config.databaseUrl).toBe(VALID_URL);
  });

  it("does not warn when compose leaves DATABASE_URL an empty string", () => {
    const warnings: string[] = [];
    const config = ok(
      loadConfig(
        { DATABASE_URL: "", DATABASE_URL_FILE: "/run/secrets/db-url" },
        {
          readFile: () => VALID_URL,
          onWarning: (message) => warnings.push(message),
        },
      ),
    );
    expect(config.databaseUrl).toBe(VALID_URL);
    expect(warnings).toHaveLength(0);
  });

  it("does not warn when only the file variable is set", () => {
    const warnings: string[] = [];
    ok(
      loadConfig(fileEnv("/run/secrets/db-url"), {
        readFile: () => VALID_URL,
        onWarning: (message) => warnings.push(message),
      }),
    );
    expect(warnings).toHaveLength(0);
  });

  it("rejects an unreadable file with a clear issue naming the path", () => {
    const error = err(
      loadConfig(fileEnv("/run/secrets/missing"), {
        readFile: (path) => {
          throw new Error(`ENOENT: no such file or directory, open '${path}'`);
        },
      }),
    );
    expect(error.code).toBe(ConfigErrorCodes.INVALID);
    expect(
      error.issues.some(
        (issue) =>
          issue.startsWith("DATABASE_URL_FILE") &&
          issue.includes("/run/secrets/missing"),
      ),
    ).toBe(true);
  });

  it("rejects a bad scheme in the file content like the plain variable", () => {
    const result = loadConfig(fileEnv("/run/secrets/db-url"), {
      readFile: () => "mysql://localhost/app",
    });
    expect(result.ok).toBe(false);
  });

  it("rejects an empty file", () => {
    const result = loadConfig(fileEnv("/run/secrets/db-url"), {
      readFile: () => "\n",
    });
    expect(result.ok).toBe(false);
  });

  it("does not echo the secret file content in error output", () => {
    const error = err(
      loadConfig(fileEnv("/run/secrets/db-url"), {
        readFile: () => "http://user:filesecret@host/db",
      }),
    );
    const joined = [error.message, ...error.issues].join(" ");
    expect(joined).not.toContain("filesecret");
  });

  it("reads through the real filesystem by default", () => {
    const dir = mkdtempSync(join(tmpdir(), "brief-131-dsn-"));
    const path = join(dir, "db-url");
    writeFileSync(path, `${VALID_URL}\n`);
    const config = ok(loadConfig(fileEnv(path)));
    expect(config.databaseUrl).toBe(VALID_URL);
  });
});

// MERGEBRIEF_AUTO_MIGRATE: default TRUE (apply at boot); false
// switches both services to the check-only ledger comparison.
describe("config: MERGEBRIEF_AUTO_MIGRATE", () => {
  it("defaults to auto-migrate ON", () => {
    const config = ok(loadConfig({ DATABASE_URL: VALID_URL }));
    expect(config.autoMigrate).toBe(true);
  });

  it("parses an explicit false", () => {
    const config = ok(
      loadConfig({ DATABASE_URL: VALID_URL, MERGEBRIEF_AUTO_MIGRATE: "false" }),
    );
    expect(config.autoMigrate).toBe(false);
  });

  it("rejects an unrecognized token", () => {
    const error = err(
      loadConfig({ DATABASE_URL: VALID_URL, MERGEBRIEF_AUTO_MIGRATE: "maybe" }),
    );
    expect(
      error.issues.some((i) => i.startsWith("MERGEBRIEF_AUTO_MIGRATE")),
    ).toBe(true);
  });
});

describe("config: DATABASE_POOL_MAX", () => {
  it("defaults the pool to ten connections", () => {
    const unsetConfig = ok(loadConfig({ DATABASE_URL: VALID_URL }));
    const blankConfig = ok(
      loadConfig({ DATABASE_URL: VALID_URL, DATABASE_POOL_MAX: "" }),
    );
    expect(unsetConfig.poolMax).toBe(10);
    expect(blankConfig.poolMax).toBe(10);
  });

  it("takes a positive whole number of connections", () => {
    const config = ok(
      loadConfig({ DATABASE_URL: VALID_URL, DATABASE_POOL_MAX: "25" }),
    );
    expect(config.poolMax).toBe(25);
  });

  it.each([
    ["1", /at least 2/],
    ["0", /at least 2/],
    ["-3", /at least 2/],
    ["2.5", /whole number/],
    ["many", /DATABASE_POOL_MAX/],
  ])("refuses a pool size of %s", (raw, reason) => {
    const error = err(
      loadConfig({ DATABASE_URL: VALID_URL, DATABASE_POOL_MAX: raw }),
    );
    expect(error.issues.join("; ")).toMatch(/^DATABASE_POOL_MAX: /);
    expect(error.issues.join("; ")).toMatch(reason);
  });
});

// TLS explicit-or-refuse. A non-loopback host with no `sslmode`
// DSN parameter refuses boot: the operator must choose; loopback and
// unix-socket DSNs are exempt. Any EXPLICIT sslmode (including `disable`)
// passes the gate.
describe("config: TLS explicit-or-refuse gate", () => {
  const REMOTE = "postgres://user:pass@db.example.com:5432/app";

  it.each([
    ["localhost", "postgres://user:pass@localhost:5432/app"],
    ["127.0.0.0/8 non-canonical", "postgres://user:pass@127.5.5.5:5432/app"],
    ["IPv6 ::1", "postgres://user:pass@[::1]:5432/app"],
    ["unix socket via host param", "postgres:///app?host=/var/run/postgresql"],
  ])("exempts loopback: %s", (_label, url) => {
    expect(loadConfig({ DATABASE_URL: url }).ok).toBe(true);
  });

  it("refuses a non-loopback host with no sslmode", () => {
    const error = err(loadConfig({ DATABASE_URL: REMOTE }));
    expect(error.code).toBe(ConfigErrorCodes.INVALID);
    expect(error.issues.some((i) => i.startsWith("DATABASE_URL"))).toBe(true);
  });

  it("refuses an EMPTY sslmode, which pg's truthiness check runs plaintext", () => {
    expect(loadConfig({ DATABASE_URL: `${REMOTE}?sslmode=` }).ok).toBe(false);
  });

  it("treats a 127.x literal with an out-of-range octet as non-loopback", () => {
    expect(
      loadConfig({ DATABASE_URL: "postgres://user:pass@127.0.0.999:5432/app" })
        .ok,
    ).toBe(false);
  });

  it("refuses boot naming the path of an unreadable sslrootcert file", () => {
    const error = err(
      loadConfig({
        DATABASE_URL: `${REMOTE}?sslmode=verify-full&sslrootcert=/nonexistent-brief131-ca.pem`,
      }),
    );
    expect(
      error.issues.some(
        (issue) =>
          issue.startsWith("DATABASE_URL") &&
          issue.includes("/nonexistent-brief131-ca.pem"),
      ),
    ).toBe(true);
  });

  it("names the three choices in the refusal", () => {
    const error = err(loadConfig({ DATABASE_URL: REMOTE }));
    const joined = error.issues.join(" ");
    expect(joined).toContain("sslmode=verify-full");
    expect(joined).toContain("sslrootcert");
    expect(joined).toContain("sslmode=require");
    expect(joined).toContain("sslmode=disable");
  });

  it("does not echo the host or credentials in the refusal", () => {
    const error = err(
      loadConfig({
        DATABASE_URL: "postgres://user:topsecret@db.example.com:5432/app",
      }),
    );
    const joined = [error.message, ...error.issues].join(" ");
    expect(joined).not.toContain("topsecret");
    expect(joined).not.toContain("db.example.com");
  });

  it("accepts an explicit sslmode", () => {
    expect(
      loadConfig({ DATABASE_URL: `${REMOTE}?sslmode=verify-full` }).ok,
    ).toBe(true);
  });

  it("accepts the bundled compose's derived in-network DSN", () => {
    // Shape-pinned to docker-compose.yml's DATABASE_URL derivation: a compose
    // service hostname is non-loopback and needs its explicit disable, and
    // refusing this exact form broke the default `docker compose up`.
    expect(
      loadConfig({
        DATABASE_URL:
          "postgres://code_review:code_review@postgres:5432/code_review?sslmode=disable",
      }).ok,
    ).toBe(true);
  });

  it("gates the file-resolved DSN too", () => {
    const result = loadConfig(
      { DATABASE_URL_FILE: "/run/secrets/db-url" },
      { readFile: () => REMOTE },
    );
    expect(result.ok).toBe(false);
  });

  it("passes a file-resolved DSN with an explicit sslmode", () => {
    const result = loadConfig(
      { DATABASE_URL_FILE: "/run/secrets/db-url" },
      { readFile: () => `${REMOTE}?sslmode=verify-full` },
    );
    expect(result.ok).toBe(true);
  });
});
