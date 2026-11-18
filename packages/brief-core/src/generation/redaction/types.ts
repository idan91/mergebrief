import type { ValueOf } from "types/utils";

/** What a redaction marker names in place of the value. */
export const SecretKinds = {
  PRIVATE_KEY: "private-key",
  GITHUB_TOKEN: "github-token",
  GITLAB_TOKEN: "gitlab-token",
  SLACK_TOKEN: "slack-token",
  STRIPE_KEY: "stripe-key",
  NPM_TOKEN: "npm-token",
  ANTHROPIC_KEY: "anthropic-key",
  OPENAI_KEY: "openai-key",
  AWS_ACCESS_KEY_ID: "aws-access-key-id",
  GOOGLE_API_KEY: "google-api-key",
  JWT: "jwt",
  URL_PASSWORD: "url-password",
  /** A literal assigned to a key named for a secret, whatever its format. */
  KEYED_SECRET: "keyed-secret",
  /** Such a literal that reads as a name: hidden like one, never counted as an added credential. */
  KEYED_NAME: "keyed-name",
} as const;
export type SecretKind = ValueOf<typeof SecretKinds>;

/** The diff side a line belongs to: a context line is on both. */
export const DiffSides = {
  OLD: "old",
  NEW: "new",
} as const;
export type DiffSide = ValueOf<typeof DiffSides>;

/**
 * Where an open key block's evidence came from: a BEGIN fence; a PEM-shaped
 * line, which proves an inferred block; or a hunk header with no context or
 * an armor-like one, which waits through armor and blank lines for that line.
 */
export const KeyBlocks = {
  FENCED: "fenced",
  IMPLIED: "implied",
  ARMOR: "armor",
} as const;
export type KeyBlock = ValueOf<typeof KeyBlocks>;

/** A span an inferred key block added, held until the block is known not to be a public one. */
export interface InferredSpan {
  readonly line: number;
  readonly span: SecretSpan;
}

/** A redacted run of one line, by UTF-16 offset, end exclusive. */
export interface SecretSpan {
  readonly start: number;
  readonly end: number;
  readonly kind: SecretKind;
}

/** One redacted value: its kind and the zero-based line it sat on. */
export interface SecretHit {
  readonly kind: SecretKind;
  readonly line: number;
}

export interface SecretRedaction {
  readonly text: string;
  readonly hits: readonly SecretHit[];
}

export type SecretKindCounts = Partial<Record<SecretKind, number>>;

/** A single-line format; `accepts` vetoes a match the shape alone cannot rule out. */
export interface TokenPattern {
  readonly kind: SecretKind;
  readonly pattern: RegExp;
  readonly accepts?: (match: string) => boolean;
}
