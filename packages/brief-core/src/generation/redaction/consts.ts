import { SecretKinds, type SecretKind, type TokenPattern } from "./types";
import { buildTokenPattern, ESCAPE_BEFORE_TOKEN, isJwt } from "./utils";

const KEY_LABEL = String.raw`(?:(?:RSA|EC|DSA|OPENSSH|ENCRYPTED|PGP) )?PRIVATE KEY(?: BLOCK)?-----`;

export const KEY_BEGIN = new RegExp(String.raw`-----BEGIN ${KEY_LABEL}`, "g");
export const KEY_END = new RegExp(String.raw`-----END ${KEY_LABEL}`, "g");

/**
 * A body line of a key block, bare, behind a comment or quote marker, or as a
 * string literal in code: a leading `+` or `.` operator or a pasted diff's `-`, a `b`/`r`/`u`
 * prefix, an escaped line ending, and a trailing operator, comma or
 * backslash continuation.
 */
export const KEY_BODY_LINE =
  /^(?:(?:\/\/|--|[#;>*])[ \t]*)?(?:[-+.][ \t]*)?(?:[bBrRuU]?["'`])?[A-Za-z0-9+/]+={0,2}(?:\\r)?(?:\\n)?["'`]?(?:[ \t]*[+.,;)])?(?:[ \t]*\\)?$/;

/** Armor headers inside a block (`Proc-Type:`, `Version:`): the block stays open. */
export const KEY_HEADER_LINE = /^[A-Za-z][A-Za-z-]*: /;

/** A PEM or OpenPGP armor header by name, which a YAML `key: value` line is not. */
export const KEY_ARMOR_LINE =
  /^(?:Proc-Type|DEK-Info|Version|Comment|Hash|Charset|MessageID): /;

/**
 * One PEM or OpenSSH body line: a 60 to 76 char base64 run on its own. With no
 * fence in view this is the only evidence an inferred block takes, so a hex
 * digest (one case) or a longer base64 blob never opens one.
 */
export const KEY_LINE_RUN =
  /(?<![A-Za-z0-9+/])[A-Za-z0-9+/]{60,76}={0,2}(?![A-Za-z0-9+/=])/;

/** The END fence of an armored block that holds no private key; one right below an inferred block shows it was public. */
export const PUBLIC_END =
  /-----END (?:CERTIFICATE|TRUSTED CERTIFICATE|X509 CERTIFICATE|PUBLIC KEY|RSA PUBLIC KEY|CERTIFICATE REQUEST|NEW CERTIFICATE REQUEST|X509 CRL|PKCS7|PGP PUBLIC KEY BLOCK|PGP SIGNATURE|PGP MESSAGE)-----|---- END SSH2 PUBLIC KEY ----/;

/** The CRC line OpenPGP armor ends its body with. */
export const ARMOR_CHECKSUM = /^=[A-Za-z0-9+/]{4}$/;

/** A PuTTY key file's private section, which has no fence: its base64 rows follow this line. */
export const PPK_PRIVATE_LINES = /^Private-Lines: \d+$/;

/** Enough base64 after a fence to be key material rather than prose. */
export const KEY_MATERIAL = /[A-Za-z0-9+/]{16,}/;

/** The password runs to the last `@` before the path, so an unencoded `@` inside it stays covered. */
export const URL_PASSWORD = new RegExp(
  String.raw`(?<=^|[^A-Za-z0-9+.-]|${ESCAPE_BEFORE_TOKEN})([A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s/?#@:"'\x60]*:)([^\s/?#"'\x60]+)@`,
  "g",
);

/** The start of each fixed-prefix format below, tried only where a hidden char was removed. */
export const TOKEN_PREFIX =
  /gh[pousr]_|github_pat_|gl(?:pat|rt|dt|ptt|cbt|oas|imt|soat|ffct|agent)-|xox[abcdeprs]-|xapp-|[rs]k_live_|npm_|sk-|AKIA|ASIA|AIza|eyJ/y;

/** A URL password git cut at the end of a hunk header, before its `@`; an all-digit run is a port. */
export const TRUNCATED_URL_PASSWORD = new RegExp(
  String.raw`(?<=^|[^A-Za-z0-9+.-]|${ESCAPE_BEFORE_TOKEN})([A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s/?#@:"'\x60]*:)(?!\d+$)([^\s/?#"'\x60@]+)$`,
);

/** A hunk header up to its function context, `@@ -1,2 +1,2 @@ `, with each side's start line. */
export const HUNK_HEADER_RANGES = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@ ?/;

/** Template and docs stand-ins, which carry no secret; a bare `$NAME` only in env-var casing. */
export const PLACEHOLDER_TEMPLATE =
  /^(?:\$[A-Z_][A-Z0-9_]*|\$\{[A-Za-z_][A-Za-z0-9_]*\}|<[^<>]*>|\{\{[^{}]*\}\}|\*+)$/;
export const PLACEHOLDER_WORD = /^(?:pass|password|secret|changeme|example)$/i;

/**
 * Git cuts a hunk header's function context at 80 bytes, which can end a
 * token short of its pattern's length: a known prefix running to the end of
 * the header is redacted whatever its length.
 */
export const TRUNCATED_HEADER_TOKEN = new RegExp(
  String.raw`(?<=^|[^A-Za-z0-9_-]|${ESCAPE_BEFORE_TOKEN})(gh[pousr]_|github_pat_|npm_|AIza|gl(?:pat|rt|dt|ptt)-|xox[a-z]-|xapp-|sk-ant-|sk-)[A-Za-z0-9_-]{8,}$`,
);

export const TRUNCATED_TOKEN_KINDS: readonly (readonly [RegExp, SecretKind])[] =
  [
    [/^(?:gh|github_pat_)/, SecretKinds.GITHUB_TOKEN],
    [/^npm_/, SecretKinds.NPM_TOKEN],
    [/^AIza/, SecretKinds.GOOGLE_API_KEY],
    [/^gl/, SecretKinds.GITLAB_TOKEN],
    [/^x/, SecretKinds.SLACK_TOKEN],
    [/^sk-ant-/, SecretKinds.ANTHROPIC_KEY],
    [/^sk-/, SecretKinds.OPENAI_KEY],
  ];

const WORD = "A-Za-z0-9_";
const WORD_OR_DASH = "A-Za-z0-9_-";
const ALPHANUMERIC = "A-Za-z0-9";

/** Fixed-prefix formats only; `sk-ant-` precedes the OpenAI rule that shares `sk-`. */
export const TOKEN_PATTERNS: readonly TokenPattern[] = [
  {
    kind: SecretKinds.GITHUB_TOKEN,
    pattern: buildTokenPattern(
      "gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{22,255}",
      WORD,
    ),
  },
  {
    kind: SecretKinds.GITLAB_TOKEN,
    pattern: buildTokenPattern(
      "gl(?:pat|rt|dt|ptt|cbt|oas|imt|soat|ffct|agent)-[A-Za-z0-9_-]{20,}",
      WORD_OR_DASH,
    ),
  },
  {
    kind: SecretKinds.SLACK_TOKEN,
    pattern: buildTokenPattern(
      "(?:xox[abcdeprs]|xapp)-[A-Za-z0-9-]{10,}",
      WORD_OR_DASH,
    ),
  },
  {
    kind: SecretKinds.STRIPE_KEY,
    pattern: buildTokenPattern("[rs]k_live_[A-Za-z0-9]{16,}", WORD),
  },
  {
    kind: SecretKinds.NPM_TOKEN,
    pattern: buildTokenPattern("npm_[A-Za-z0-9]{36}", WORD),
  },
  {
    kind: SecretKinds.ANTHROPIC_KEY,
    pattern: buildTokenPattern("sk-ant-[A-Za-z0-9_-]{20,}", WORD_OR_DASH),
  },
  {
    kind: SecretKinds.OPENAI_KEY,
    pattern: buildTokenPattern(
      "sk-(?:(?:proj|svcacct|admin)-[A-Za-z0-9_-]{20,}|[A-Za-z0-9_-]{20,}T3BlbkFJ[A-Za-z0-9_-]{20,}|[A-Za-z0-9]{48})",
      WORD_OR_DASH,
    ),
  },
  {
    kind: SecretKinds.AWS_ACCESS_KEY_ID,
    pattern: buildTokenPattern("(?:AKIA|ASIA)[A-Z0-9]{16}", ALPHANUMERIC),
  },
  {
    kind: SecretKinds.GOOGLE_API_KEY,
    pattern: buildTokenPattern("AIza[0-9A-Za-z_-]{35}", WORD_OR_DASH),
  },
  {
    kind: SecretKinds.JWT,
    pattern: buildTokenPattern(
      String.raw`eyJ[A-Za-z0-9_-]{2,}\.eyJ[A-Za-z0-9_-]{2,}\.[A-Za-z0-9_-]*`,
      WORD_OR_DASH,
    ),
    accepts: isJwt,
  },
];
