// GitHub client env config, Zod-parsed from an INJECTED env map: this module
// NEVER reads `process.env` implicitly at import time; `loadConfig(env)` takes
// the env explicitly so the read happens where the caller decides.
// Exactly one of GITHUB_APP_PRIVATE_KEY (PEM contents) or
// GITHUB_APP_PRIVATE_KEY_PATH (a file read to get the PEM) is required.
import { readFileSync } from "node:fs";
import { z } from "zod/v4";
import type { Result, ValueOf } from "types/utils";
import { isOperatorToken } from "./client/operator";
import type { OperatorToken } from "./client/types";

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
  /** The App's URL name (`github.com/apps/<slug>`); absent, Home offers no Install link. */
  readonly appSlug: string | undefined;
  /** `MERGEBRIEF_URL_FALLBACK_TOKEN`; absent, no operator token. */
  readonly operatorToken?: OperatorToken | undefined;
}

export interface LoadConfigOptions {
  /** Sink for a removed key still set; boot passes its logger's `warn`. */
  readonly onWarning?: (message: string) => void;
}

// ---------------------------------------------------------------------------
// Errors: expected failure (bad/missing env). Never throws.
// ---------------------------------------------------------------------------

export const ConfigErrorCodes = {
  INVALID: "invalid",
} as const;
export type ConfigErrorCode = ValueOf<typeof ConfigErrorCodes>;

export interface ConfigError {
  readonly code: ConfigErrorCode;
  readonly message: string;
  /**
   * Per-field problems as `field: reason`, never the offending VALUES: the
   * private key, webhook secret, and OAuth client secret are all credentials.
   */
  readonly issues: readonly string[];
}

// ---------------------------------------------------------------------------
// Schema.
// ---------------------------------------------------------------------------

/** GitHub lower-cases an App's name and joins its words with hyphens. */
const APP_SLUG_PATTERN = /^[a-z0-9-]+$/;

/** Counted after trimming; the HMAC still keys on the value as set. */
const WEBHOOK_SECRET_MIN_LENGTH = 32;

const REMOVED_REVIEWERS_KEY = "MERGEBRIEF_URL_BOX_TOKEN_REVIEWERS";
const REMOVED_REVIEWERS_WARNING = `${REMOVED_REVIEWERS_KEY} is no longer read: the URL fallback token now serves only the GitHub account that owns it. Remove the key.`;

const FALLBACK_TOKEN_KEY = "MERGEBRIEF_URL_FALLBACK_TOKEN";
const RENAMED_TOKEN_KEY = "MERGEBRIEF_URL_BOX_TOKEN";
const RENAMED_TOKEN_WARNING = `${RENAMED_TOKEN_KEY} is no longer read: rename it to ${FALLBACK_TOKEN_KEY}.`;

/** Compose expands an unset `${KEY:-}` to an empty string; that is unset too. */
function readEmptyAsUnset(value: unknown): unknown {
  return value === "" ? undefined : value;
}

const ConfigSchema = z
  .object({
    GITHUB_APP_ID: z
      .string({ error: "GITHUB_APP_ID is required" })
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
      .string({ error: "GITHUB_WEBHOOK_SECRET is required" })
      .refine(
        (value) => value.trim().length >= WEBHOOK_SECRET_MIN_LENGTH,
        `GITHUB_WEBHOOK_SECRET must be at least ${WEBHOOK_SECRET_MIN_LENGTH} characters; generate one with openssl rand -hex 32`,
      ),
    GITHUB_OAUTH_CLIENT_ID: z
      .string({ error: "GITHUB_OAUTH_CLIENT_ID is required" })
      .min(1, "GITHUB_OAUTH_CLIENT_ID is required"),
    GITHUB_OAUTH_CLIENT_SECRET: z
      .string({ error: "GITHUB_OAUTH_CLIENT_SECRET is required" })
      .min(1, "GITHUB_OAUTH_CLIENT_SECRET is required"),
    GITHUB_APP_SLUG: z.preprocess(
      readEmptyAsUnset,
      z
        .string()
        .regex(APP_SLUG_PATTERN, "GITHUB_APP_SLUG must be the App's URL name")
        .optional(),
    ),
    [FALLBACK_TOKEN_KEY]: z.preprocess(readEmptyAsUnset, z.string().optional()),
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
// Private-key resolution, the one step that isn't pure Zod parsing.
// ---------------------------------------------------------------------------

function invalidConfigError(issue: string): ConfigError {
  return {
    code: ConfigErrorCodes.INVALID,
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

function parseOperatorToken(
  value: string | undefined,
): OperatorToken | undefined {
  if (value === undefined || !isOperatorToken(value)) {
    return undefined;
  }
  return value;
}

// ---------------------------------------------------------------------------
// Loader.
// ---------------------------------------------------------------------------

/**
 * Parse GitHub client config from an injected env map, or a `ConfigError`
 * listing invalid fields (values omitted, they are credentials). Never reads
 * `process.env` itself; the caller passes it.
 */
export function loadConfig(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
  options: LoadConfigOptions = {},
): Result<GitHubConfig, ConfigError> {
  const removedReviewers = readEmptyAsUnset(env[REMOVED_REVIEWERS_KEY]);
  if (removedReviewers !== undefined) {
    options.onWarning?.(REMOVED_REVIEWERS_WARNING);
  }
  const renamedToken = readEmptyAsUnset(env[RENAMED_TOKEN_KEY]);
  if (renamedToken !== undefined) {
    options.onWarning?.(RENAMED_TOKEN_WARNING);
  }

  const parsed = ConfigSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => {
      const field = issue.path.join(".") || "(root)";
      return `${field}: ${issue.message}`;
    });
    return {
      ok: false,
      error: {
        code: ConfigErrorCodes.INVALID,
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
      appSlug: parsed.data.GITHUB_APP_SLUG,
      operatorToken: parseOperatorToken(parsed.data[FALLBACK_TOKEN_KEY]),
    },
  };
}
