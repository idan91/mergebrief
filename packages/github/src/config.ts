// GitHub client env config (BRIEF-2, stage 1). Zod-parsed from an INJECTED
// env map — this module NEVER reads `process.env` implicitly at import time:
// `loadConfig(env)` takes the env explicitly so tests are hermetic and the
// read happens where the caller decides (composition root), mirroring
// `packages/persistence/src/config.ts`.
//
//   GITHUB_APP_ID                    required; numeric GitHub App id.
//   GITHUB_APP_PRIVATE_KEY            PEM contents. Exactly one of this OR
//   GITHUB_APP_PRIVATE_KEY_PATH       ...this (a path read to get the PEM)
//                                     is required — never both, never neither.
//   GITHUB_WEBHOOK_SECRET             required. Consumed by the webhook route
//                                     (stage 2) to verify inbound HMAC signatures.
//   GITHUB_OAUTH_CLIENT_ID            required. Consumed by the OAuth routes
//   GITHUB_OAUTH_CLIENT_SECRET        required. (later stage — reviewer auth).
//
// This stage only parses and shapes these values into `GitHubConfig`; it does
// not verify webhooks or perform an OAuth exchange.
import { readFileSync } from "node:fs";
import { z } from "zod";
import type { Result, ValueOf } from "./types";

// ---------------------------------------------------------------------------
// Public config shape.
// ---------------------------------------------------------------------------

export interface GitHubConfig {
  /** Numeric GitHub App id (`GITHUB_APP_ID`). */
  readonly appId: number;
  /**
   * PEM-encoded App private key, resolved from either `GITHUB_APP_PRIVATE_KEY`
   * directly or by reading the file at `GITHUB_APP_PRIVATE_KEY_PATH`.
   */
  readonly privateKey: string;
  /** HMAC secret for verifying webhook deliveries (stage 2). */
  readonly webhookSecret: string;
  /** OAuth App client id (reviewer-auth routes, later stage). */
  readonly oauthClientId: string;
  /** OAuth App client secret (reviewer-auth routes, later stage). */
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
   * Per-field problems as `field: reason`. Deliberately excludes the
   * offending VALUES — the private key, webhook secret, and OAuth client
   * secret are all credentials that must never reach a log.
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
// Private-key resolution — the one step that isn't pure Zod parsing (reads a
// file when GITHUB_APP_PRIVATE_KEY_PATH is used instead of the inline PEM).
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
    // Unreachable in practice: the schema's superRefine already enforces
    // exactly one of GITHUB_APP_PRIVATE_KEY / GITHUB_APP_PRIVATE_KEY_PATH.
    // Handled explicitly (no bare `as`) rather than asserted past the checker.
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
    // Message deliberately omits the underlying fs error (may echo the path
    // or platform details); the path itself is not a credential.
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
 * Parse GitHub client config from an injected env map into a `GitHubConfig`,
 * or a `ConfigError` listing the invalid fields (values omitted — the
 * private key and both secrets are credentials). Unknown env keys are
 * ignored. Never reads `process.env` itself — the caller passes it.
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
