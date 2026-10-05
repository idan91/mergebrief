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
  ConfigErrorCodes,
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
  GITHUB_APP_SLUG: "mergebrief-dev",
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

describe("loadConfig", () => {
  it("loads a fully valid env with an inline PEM", () => {
    const config = ok(loadConfig(BASE_ENV));
    expect(config.appId).toBe(123456);
    expect(config.privateKey).toBe(VALID_PEM);
    expect(config.webhookSecret).toBe("webhook-secret");
    expect(config.oauthClientId).toBe("client-id");
    expect(config.oauthClientSecret).toBe("client-secret");
    expect(config.appSlug).toBe("mergebrief-dev");
  });

  it("loads without GITHUB_APP_SLUG, leaving the Install link unset", () => {
    const { GITHUB_APP_SLUG: _slug, ...env } = BASE_ENV;

    expect(ok(loadConfig(env)).appSlug).toBeUndefined();
  });

  it("an empty GITHUB_APP_SLUG reads as unset", () => {
    expect(ok(loadConfig({ ...BASE_ENV, GITHUB_APP_SLUG: "" })).appSlug).toBe(
      undefined,
    );
  });

  it("rejects a GITHUB_APP_SLUG that is not a URL segment", () => {
    const error = err(loadConfig({ ...BASE_ENV, GITHUB_APP_SLUG: "my app" }));

    expect(error.issues).toContain(
      "GITHUB_APP_SLUG: GITHUB_APP_SLUG must be the App's URL name",
    );
  });

  it("rejects an empty env, listing every missing required field", () => {
    const error = err(loadConfig({}));
    expect(error.code).toBe(ConfigErrorCodes.INVALID);
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

  it("never echoes the private key or either secret in error output", () => {
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

  describe("the operator token and its reviewer list", () => {
    const OPERATOR_TOKEN = "github_pat_OPERATOR_FIXTURE";
    const REVIEWERS_KEY = "MERGEBRIEF_URL_BOX_TOKEN_REVIEWERS";

    it("parses a token and its list into a set of reviewer ids", () => {
      const config = ok(
        loadConfig({
          ...BASE_ENV,
          MERGEBRIEF_URL_BOX_TOKEN: OPERATOR_TOKEN,
          MERGEBRIEF_URL_BOX_TOKEN_REVIEWERS: "583231, 9919 ,583231",
        }),
      );

      expect(config.operatorToken?.token).toBe(OPERATOR_TOKEN);
      expect([...(config.operatorToken?.reviewerIds ?? [])]).toEqual([
        583231n,
        9919n,
      ]);
    });

    it("leaves the operator token absent when both keys are empty", () => {
      const config = ok(
        loadConfig({
          ...BASE_ENV,
          MERGEBRIEF_URL_BOX_TOKEN: "",
          MERGEBRIEF_URL_BOX_TOKEN_REVIEWERS: "",
        }),
      );

      expect(config.operatorToken).toBeUndefined();
    });

    it("leaves the operator token absent when both keys are unset", () => {
      const config = ok(loadConfig(BASE_ENV));

      expect(config.operatorToken).toBeUndefined();
    });

    it("refuses a token with no reviewer list", () => {
      const error = err(
        loadConfig({ ...BASE_ENV, MERGEBRIEF_URL_BOX_TOKEN: OPERATOR_TOKEN }),
      );

      expect(error.issues).toEqual([
        `${REVIEWERS_KEY}: required when MERGEBRIEF_URL_BOX_TOKEN is set`,
      ]);
    });

    it("refuses a token whose reviewer list is empty", () => {
      const error = err(
        loadConfig({
          ...BASE_ENV,
          MERGEBRIEF_URL_BOX_TOKEN: OPERATOR_TOKEN,
          MERGEBRIEF_URL_BOX_TOKEN_REVIEWERS: "",
        }),
      );

      expect(error.issues).toEqual([
        `${REVIEWERS_KEY}: required when MERGEBRIEF_URL_BOX_TOKEN is set`,
      ]);
    });

    it.each([
      "octocat",
      "583231,octocat",
      "583231,",
      "0",
      "-5",
      "1".repeat(20),
    ])(
      "refuses a malformed reviewer list without echoing it: %#",
      (reviewers) => {
        const error = err(
          loadConfig({
            ...BASE_ENV,
            MERGEBRIEF_URL_BOX_TOKEN: OPERATOR_TOKEN,
            MERGEBRIEF_URL_BOX_TOKEN_REVIEWERS: reviewers,
          }),
        );
        const joined = [error.message, ...error.issues].join(" ");

        expect(error.issues).toHaveLength(1);
        expect(error.issues[0]).toMatch(new RegExp(`^${REVIEWERS_KEY}: `));
        expect(joined).not.toContain(reviewers);
        expect(joined).not.toContain(OPERATOR_TOKEN);
      },
    );

    it("ignores a reviewer list when no token is set", () => {
      const config = ok(
        loadConfig({
          ...BASE_ENV,
          MERGEBRIEF_URL_BOX_TOKEN_REVIEWERS: "not-an-id",
        }),
      );

      expect(config.operatorToken).toBeUndefined();
    });
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

    it("rejects a missing key file without leaking fs internals", async () => {
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
