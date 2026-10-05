// GitHub client env config, Zod-parsed from an INJECTED env map: this module
// NEVER reads `process.env` implicitly at import time; `loadConfig(env)` takes
// the env explicitly so the read happens where the caller decides.
// Exactly one of GITHUB_APP_PRIVATE_KEY (PEM contents) or
// GITHUB_APP_PRIVATE_KEY_PATH (a file read to get the PEM) is required.
import { readFileSync } from "node:fs";
import { z } from "zod/v4";
import type { ReviewerId } from "persistence";
import type { Result, ValueOf } from "types/utils";
import { isReviewerId } from "./ids";

// ---------------------------------------------------------------------------
// Public config shape.
// ---------------------------------------------------------------------------

/** The operator's token and the only reviewers it may be used for. */
export interface OperatorTokenConfig {
  readonly token: string;
  readonly reviewerIds: ReadonlySet<ReviewerId>;
}

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
  /** `MERGEBRIEF_URL_BOX_TOKEN` with its reviewer list; absent, no operator token. */
  readonly operatorToken?: OperatorTokenConfig | undefined;
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

const REVIEWER_ID_PATTERN = /^[0-9]{1,19}$/;
const REVIEWERS_KEY = "MERGEBRIEF_URL_BOX_TOKEN_REVIEWERS";
const REVIEWERS_REQUIRED = "required when MERGEBRIEF_URL_BOX_TOKEN is set";
const REVIEWERS_MALFORMED = "must be comma-separated numeric GitHub user ids";

/** Compose expands an unset `${KEY:-}` to an empty string; that is unset too. */
function readEmptyAsUnset(value: unknown): unknown {
  return value === "" ? undefined : value;
}

/** The reason never carries an entry: the list names people. */
function parseReviewerIds(
  list: string | undefined,
): Result<ReadonlySet<ReviewerId>, string> {
  if (list === undefined) {
    return { ok: false, error: REVIEWERS_REQUIRED };
  }

  const reviewerIds = new Set<ReviewerId>();
  for (const entry of list.split(",")) {
    const digits = entry.trim();
    const allDigits = REVIEWER_ID_PATTERN.test(digits);
    if (!allDigits) {
      return { ok: false, error: REVIEWERS_MALFORMED };
    }
    const reviewerId = BigInt(digits);
    const validReviewerId = isReviewerId(reviewerId);
    if (!validReviewerId) {
      return { ok: false, error: REVIEWERS_MALFORMED };
    }
    reviewerIds.add(reviewerId);
  }
  return { ok: true, value: reviewerIds };
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
      .min(1, "GITHUB_WEBHOOK_SECRET is required"),
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
    MERGEBRIEF_URL_BOX_TOKEN: z.preprocess(
      readEmptyAsUnset,
      z.string().optional(),
    ),
    MERGEBRIEF_URL_BOX_TOKEN_REVIEWERS: z.preprocess(
      readEmptyAsUnset,
      z.string().optional(),
    ),
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

    if (data.MERGEBRIEF_URL_BOX_TOKEN === undefined) {
      return;
    }
    const reviewerIds = parseReviewerIds(
      data.MERGEBRIEF_URL_BOX_TOKEN_REVIEWERS,
    );
    if (!reviewerIds.ok) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [REVIEWERS_KEY],
        message: reviewerIds.error,
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

/** A reviewer list with no token is ignored: there is nothing for it to open. */
function resolveOperatorToken(
  data: ParsedEnv,
): Result<OperatorTokenConfig | undefined, ConfigError> {
  const token = data.MERGEBRIEF_URL_BOX_TOKEN;
  if (token === undefined) {
    return { ok: true, value: undefined };
  }

  const reviewerIds = parseReviewerIds(data.MERGEBRIEF_URL_BOX_TOKEN_REVIEWERS);
  if (!reviewerIds.ok) {
    // Unreachable: superRefine already refused this list.
    return {
      ok: false,
      error: invalidConfigError(`${REVIEWERS_KEY}: ${reviewerIds.error}`),
    };
  }

  return { ok: true, value: { token, reviewerIds: reviewerIds.value } };
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
  const operatorToken = resolveOperatorToken(parsed.data);
  if (!operatorToken.ok) {
    return operatorToken;
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
      operatorToken: operatorToken.value,
    },
  };
}
