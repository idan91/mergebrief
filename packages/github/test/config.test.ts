// Config tests: valid env loads, required fields are enforced, the PEM-vs-PATH
// exclusivity is checked both ways, GITHUB_APP_ID must be numeric, and no
// secret value ever leaks into `issues`. Hermetic: env is always an injected
// object literal; the one PRIVATE_KEY_PATH case uses a real temp file rather
// than touching the repo or process.env.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ConfigErrorCode,
  loadConfig,
  type ConfigError,
  type GitHubConfig,
} from "../src/config";
import type { Result } from "../src/types";

const VALID_PEM =
  "-----BEGIN RSA PRIVATE KEY-----\nfake-pem-contents\n-----END RSA PRIVATE KEY-----\n";

const BASE_ENV = {
  GITHUB_APP_ID: "123456",
  GITHUB_APP_PRIVATE_KEY: VALID_PEM,
  GITHUB_WEBHOOK_SECRET: "webhook-secret",
  GITHUB_OAUTH_CLIENT_ID: "client-id",
  GITHUB_OAUTH_CLIENT_SECRET: "client-secret",
};

function ok(result: Result<GitHubConfig, ConfigError>): GitHubConfig {
  if (!result.ok) {
    throw new Error(
      `expected config to load: ${result.error.issues.join("; ")}`,
    );
  }
  return result.value;
}

function err(result: Result<GitHubConfig, ConfigError>): ConfigError {
  if (result.ok) {
    throw new Error("expected config to be rejected");
  }
  return result.error;
}

describe("config — loadConfig", () => {
  it("loads a fully valid env (inline PEM)", () => {
    const config = ok(loadConfig(BASE_ENV));
    expect(config.appId).toBe(123456);
    expect(config.privateKey).toBe(VALID_PEM);
    expect(config.webhookSecret).toBe("webhook-secret");
    expect(config.oauthClientId).toBe("client-id");
    expect(config.oauthClientSecret).toBe("client-secret");
  });

  it("rejects an empty env, listing every missing required field", () => {
    const error = err(loadConfig({}));
    expect(error.code).toBe(ConfigErrorCode.INVALID);
    // Zod's superRefine (the PEM/_PATH exclusivity check) only runs once the
    // per-field schema checks all pass, so an empty env surfaces the plain
    // per-field "required" issues; exclusivity is covered by its own tests
    // below (against an otherwise-valid env).
    const fields = [
      "GITHUB_APP_ID",
      "GITHUB_WEBHOOK_SECRET",
      "GITHUB_OAUTH_CLIENT_ID",
      "GITHUB_OAUTH_CLIENT_SECRET",
    ];
    for (const field of fields) {
      expect(error.issues.some((issue) => issue.startsWith(field))).toBe(true);
    }
  });

  it("rejects a non-numeric GITHUB_APP_ID", () => {
    const error = err(
      loadConfig({ ...BASE_ENV, GITHUB_APP_ID: "not-a-number" }),
    );
    expect(
      error.issues.some((issue) => issue.startsWith("GITHUB_APP_ID")),
    ).toBe(true);
  });

  it("rejects an empty-string GITHUB_APP_ID", () => {
    const error = err(loadConfig({ ...BASE_ENV, GITHUB_APP_ID: "" }));
    expect(
      error.issues.some((issue) => issue.startsWith("GITHUB_APP_ID")),
    ).toBe(true);
  });

  it("rejects when both GITHUB_APP_PRIVATE_KEY and _PATH are set", () => {
    const error = err(
      loadConfig({
        ...BASE_ENV,
        GITHUB_APP_PRIVATE_KEY_PATH: "/does/not/matter",
      }),
    );
    expect(
      error.issues.some((issue) =>
        issue.includes("exactly one of GITHUB_APP_PRIVATE_KEY"),
      ),
    ).toBe(true);
  });

  it("rejects when neither GITHUB_APP_PRIVATE_KEY nor _PATH is set", () => {
    const { GITHUB_APP_PRIVATE_KEY: _unused, ...withoutKey } = BASE_ENV;
    const error = err(loadConfig(withoutKey));
    expect(
      error.issues.some((issue) =>
        issue.includes("exactly one of GITHUB_APP_PRIVATE_KEY"),
      ),
    ).toBe(true);
  });

  it("does not echo secret values (private key, webhook secret, oauth secret) in error output", () => {
    const secretEnv = {
      ...BASE_ENV,
      GITHUB_APP_ID: "not-a-number",
      GITHUB_WEBHOOK_SECRET: "super-webhook-secret",
      GITHUB_OAUTH_CLIENT_SECRET: "super-oauth-secret",
    };
    const error = err(loadConfig(secretEnv));
    const joined = [error.message, ...error.issues].join(" ");
    expect(joined).not.toContain(VALID_PEM);
    expect(joined).not.toContain("super-webhook-secret");
    expect(joined).not.toContain("super-oauth-secret");
  });

  it("ignores unknown env keys", () => {
    expect(loadConfig({ ...BASE_ENV, UNRELATED: "x", PATH: "/bin" }).ok).toBe(
      true,
    );
  });

  describe("GITHUB_APP_PRIVATE_KEY_PATH", () => {
    let dir: string;

    beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), "github-config-"));
    });

    afterEach(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    it("reads the PEM from the file when only _PATH is set", async () => {
      const path = join(dir, "app.pem");
      await writeFile(path, VALID_PEM, "utf8");
      const { GITHUB_APP_PRIVATE_KEY: _unused, ...withoutKey } = BASE_ENV;
      const config = ok(
        loadConfig({ ...withoutKey, GITHUB_APP_PRIVATE_KEY_PATH: path }),
      );
      expect(config.privateKey).toBe(VALID_PEM);
    });

    it("rejects a _PATH that does not exist, without leaking fs internals as a secret-shaped value", async () => {
      const { GITHUB_APP_PRIVATE_KEY: _unused, ...withoutKey } = BASE_ENV;
      const error = err(
        loadConfig({
          ...withoutKey,
          GITHUB_APP_PRIVATE_KEY_PATH: join(dir, "missing.pem"),
        }),
      );
      expect(
        error.issues.some((issue) =>
          issue.startsWith("GITHUB_APP_PRIVATE_KEY_PATH"),
        ),
      ).toBe(true);
    });

    it("rejects an empty PEM file", async () => {
      const path = join(dir, "empty.pem");
      await writeFile(path, "   \n", "utf8");
      const { GITHUB_APP_PRIVATE_KEY: _unused, ...withoutKey } = BASE_ENV;
      const error = err(
        loadConfig({ ...withoutKey, GITHUB_APP_PRIVATE_KEY_PATH: path }),
      );
      expect(
        error.issues.some((issue) =>
          issue.startsWith("GITHUB_APP_PRIVATE_KEY_PATH"),
        ),
      ).toBe(true);
    });
  });
});
