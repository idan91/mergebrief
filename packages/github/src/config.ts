// GitHub client env config, Zod-parsed from an INJECTED env map — this module
// NEVER reads `process.env` implicitly at import time; `loadConfig(env)` takes
// the env explicitly so the read happens where the caller decides.
// Exactly one of GITHUB_APP_PRIVATE_KEY (PEM contents) or
// GITHUB_APP_PRIVATE_KEY_PATH (a file read to get the PEM) is required.
import { readFileSync } from "node:fs";
import { z } from "zod";
import type { Result, ValueOf } from "./types";

// ---------------------------------------------------------------------------
// Public config shape.
// ---------------------------------------------------------------------------

export interface GitHubConfig {
  readonly appId: number;
  /** PEM-encoded App private key, from the inline env var or the key file. */
  readonly privateKey: string;
  /** HMAC secret for verifying webhook deliveries. */
  readonly webhookSecret: string;
  readonly oauthClientId: string;
  readonly oauthClientSecret: string;
}

// ---------------------------------------------------------------------------
// Errors — expected failure (bad/missing env). Never throws.
// ---------------------------------------------------------------------------

export const ConfigErrorCode = {
  INVALID: "invalid",
} as const;
export type ConfigErrorCode = ValueOf<typeof ConfigErrorCode>;

export interface ConfigError {
  readonly code: ConfigErrorCode;
  readonly message: string;
  /**
   * Per-field problems as `field: reason` — never the offending VALUES: the
   * private key, webhook secret, and OAuth client secret are all credentials.
   */
  readonly issues: readonly string[];
}

// ---------------------------------------------------------------------------
// Schema.
// ---------------------------------------------------------------------------

const ConfigSchema = z
  .object({
    GITHUB_APP_ID: z
      .string({ required_error: "GITHUB_APP_ID is required" })
      .min(1, "GITHUB_APP_ID is required")
      .refine(
        (value) => /^\d+$/.test(value),
        "GITHUB_APP_ID must be a positive integer",
      )
      .transform((value) => Number(value)),
    GITHUB_APP_PRIVATE_KEY: z
      .string()
      .min(1, "GITHUB_APP_PRIVATE_KEY must not be empty")
      .optional(),
    GITHUB_APP_PRIVATE_KEY_PATH: z
      .string()
      .min(1, "GITHUB_APP_PRIVATE_KEY_PATH must not be empty")
      .optional(),
    GITHUB_WEBHOOK_SECRET: z
      .string({ required_error: "GITHUB_WEBHOOK_SECRET is required" })
      .min(1, "GITHUB_WEBHOOK_SECRET is required"),
    GITHUB_OAUTH_CLIENT_ID: z
      .string({ required_error: "GITHUB_OAUTH_CLIENT_ID is required" })
      .min(1, "GITHUB_OAUTH_CLIENT_ID is required"),
    GITHUB_OAUTH_CLIENT_SECRET: z
      .string({ required_error: "GITHUB_OAUTH_CLIENT_SECRET is required" })
      .min(1, "GITHUB_OAUTH_CLIENT_SECRET is required"),
  })
  .superRefine((data, ctx) => {
    const hasKey = data.GITHUB_APP_PRIVATE_KEY !== undefined;
    const hasPath = data.GITHUB_APP_PRIVATE_KEY_PATH !== undefined;
    if (hasKey === hasPath) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["GITHUB_APP_PRIVATE_KEY"],
        message: hasKey
          ? "exactly one of GITHUB_APP_PRIVATE_KEY or GITHUB_APP_PRIVATE_KEY_PATH may be set, not both"
          : "exactly one of GITHUB_APP_PRIVATE_KEY or GITHUB_APP_PRIVATE_KEY_PATH is required",
      });
    }
  });

type ParsedEnv = z.infer<typeof ConfigSchema>;

// ---------------------------------------------------------------------------
// Private-key resolution — the one step that isn't pure Zod parsing.
// ---------------------------------------------------------------------------

function invalidConfigError(issue: string): ConfigError {
  return {
    code: ConfigErrorCode.INVALID,
    message: "invalid GitHub App configuration",
    issues: [issue],
  };
}

function resolvePrivateKey(data: ParsedEnv): Result<string, ConfigError> {
  if (data.GITHUB_APP_PRIVATE_KEY !== undefined) {
    return { ok: true, value: data.GITHUB_APP_PRIVATE_KEY };
  }

  const path = data.GITHUB_APP_PRIVATE_KEY_PATH;
  if (path === undefined) {
    // Unreachable: superRefine already enforces exactly one of the two.
    // Handled explicitly rather than asserted past the checker.
    return {
      ok: false,
      error: invalidConfigError(
        "GITHUB_APP_PRIVATE_KEY: exactly one of GITHUB_APP_PRIVATE_KEY or GITHUB_APP_PRIVATE_KEY_PATH is required",
      ),
    };
  }

  let pem: string;
  try {
    pem = readFileSync(path, "utf8");
  } catch {
    // Message omits the underlying fs error, which may echo path or platform
    // details.
    return {
      ok: false,
      error: invalidConfigError(
        "GITHUB_APP_PRIVATE_KEY_PATH: could not read the private key file",
      ),
    };
  }

  if (pem.trim().length === 0) {
    return {
      ok: false,
      error: invalidConfigError(
        "GITHUB_APP_PRIVATE_KEY_PATH: private key file is empty",
      ),
    };
  }

  return { ok: true, value: pem };
}

// ---------------------------------------------------------------------------
// Loader.
// ---------------------------------------------------------------------------

/**
 * Parse GitHub client config from an injected env map, or a `ConfigError`
 * listing invalid fields (values omitted — they are credentials). Never reads
 * `process.env` itself; the caller passes it.
 */
export function loadConfig(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
): Result<GitHubConfig, ConfigError> {
  const parsed = ConfigSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => {
      const field = issue.path.join(".") || "(root)";
      return `${field}: ${issue.message}`;
    });
    return {
      ok: false,
      error: {
        code: ConfigErrorCode.INVALID,
        message: "invalid GitHub client configuration",
        issues,
      },
    };
  }

  const privateKeyResult = resolvePrivateKey(parsed.data);
  if (!privateKeyResult.ok) {
    return privateKeyResult;
  }

  return {
    ok: true,
    value: {
      appId: parsed.data.GITHUB_APP_ID,
      privateKey: privateKeyResult.value,
      webhookSecret: parsed.data.GITHUB_WEBHOOK_SECRET,
      oauthClientId: parsed.data.GITHUB_OAUTH_CLIENT_ID,
      oauthClientSecret: parsed.data.GITHUB_OAUTH_CLIENT_SECRET,
    },
  };
}
