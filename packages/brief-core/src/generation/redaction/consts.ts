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

/** How a secret-named key ends: `password`, `apiKey`, `client_secret`, `AUTH_TOKEN`, `x-api-key`. */
const SECRET_NAME_END =
  "(?:pass(?:word|wd|phrase)|secret|token|(?:api|secret|access|private)[_-]?key)";
/** The same ending as an env file writes it. */
const SHOUT_NAME_END = SECRET_NAME_END.toUpperCase();
const NAME_CHARS = "A-Za-z0-9_.-";
/** The bound keeps a run of nested assignments linear; a longer value is a blob, which the formats above judge. */
const KEYED_VALUE_LENGTH = "{8,256}";

/** A bracketed argument list with no bracket inside it: `[str]`, `<string, string>`. */
const TYPE_INNER_LIST = String.raw`[<\[][A-Za-z0-9_.,&*? ]{0,40}[>\]]`;

/**
 * One type name, with at most one bracketed argument list, which may nest
 * one level and hold a `|`: `string`, `&str`, `string[]`, `Optional[str]`,
 * `Map<string, string>`, `Final[str | None]`, `ClassVar[Optional[str]]`. A
 * comma or a space counts only inside the brackets, so a name can never run
 * on into the next key of a line. Inside a list a bracket only ever opens an
 * inner list, so each character has one reading and the scan stays linear.
 */
const TYPE_NAME = String.raw`[A-Za-z_&*][A-Za-z0-9_&*?.]{0,40}(?:[<\[](?:[A-Za-z0-9_.,&*? |]|${TYPE_INNER_LIST}){0,40}[>\]]\??)?`;

/** One to four type names joined by `|`, then the `=` a typed declaration always assigns through. */
const TYPE_AND_EQUALS = String.raw`${TYPE_NAME}(?:[ \t]*\|[ \t]*${TYPE_NAME}){0,3}[ \t]*:?=`;

/**
 * A type after a colon: `apiKey: string =`, `token: string | undefined =`.
 * Never a bare `:`, which after a type would be the next key's
 * (`{ apiKey: key, model: "..." }`).
 */
const COLON_TYPED_SEPARATOR = String.raw`[ \t]*:[ \t]*${TYPE_AND_EQUALS}`;

/**
 * A type after a space, as Go declares one: `password string =`. Only where
 * the key opens a statement, alone or after `var` or `const`, since prose
 * puts a word between a secret's name and `=` the same way (`the token type
 * =`) and so does markup (`type=password name=`). The lookahead keeps the
 * lookbehind off every secret word inside one long name.
 */
const SPACE_TYPED_SEPARATOR = String.raw`(?=[ \t])(?<=(?:^|@@ |[{;(])[ \t]*(?:(?:var|const)[ \t]+)?[${NAME_CHARS}]+)[ \t]+${TYPE_AND_EQUALS}`;

const PLAIN_SEPARATOR = String.raw`[ \t]*(?:=>|:=|[:=])`;

/**
 * What may follow a key before its value. A bare key, optional or not, takes
 * a colon-typed or a plain separator, or the space-typed one. A key closed
 * by a quote or a subscript takes a plain one only: a typed declaration
 * never quotes its name, and a quoted word followed by a name and `=` is an
 * attribute's value before the next attribute (`type="password" name="..."`).
 */
const KEY_SEPARATOR = String.raw`(?:\??(?:${COLON_TYPED_SEPARATOR}|${PLAIN_SEPARATOR})|${SPACE_TYPED_SEPARATOR}|(?:["']\]?|\])\??${PLAIN_SEPARATOR})`;

/**
 * A secret-named key up to the opening quote of its value: the key, then its
 * separator. A name that only starts with the word (`tokenCount`) is no key.
 */
const KEYED_QUOTED_HEAD = String.raw`(?<![${NAME_CHARS}])(?<head>(?<key>[${NAME_CHARS}]*${SECRET_NAME_END})${KEY_SEPARATOR}[ \t]*(?<quote>["'\x60]))`;

/** One character of a quoted literal: an escape, or anything but white space and the quote that opened it. */
const QUOTED_CHAR = String.raw`(?:\\.|(?!\k<quote>)[^\s\\])`;

/** A secret-named key, a separator and a quoted literal with no white space. */
export const KEYED_QUOTED_VALUE = new RegExp(
  String.raw`${KEYED_QUOTED_HEAD}(?<value>${QUOTED_CHAR}${KEYED_VALUE_LENGTH})\k<quote>`,
  "gi",
);

/** The same literal where git cut a hunk header before its closing quote: what is left runs to the end. */
export const TRUNCATED_KEYED_VALUE = new RegExp(
  String.raw`${KEYED_QUOTED_HEAD}(?<value>${QUOTED_CHAR}{4,})$`,
  "i",
);

/**
 * An env file's `NAME=value`, unquoted: only under a SHOUT_CASE name, since
 * code assigns identifiers and calls the same way. The value is read whole
 * or not at all, so one that runs into `(` or `$` is never cut to fit.
 */
export const KEYED_BARE_VALUE = new RegExp(
  String.raw`(?<![${NAME_CHARS}])(?<head>(?<key>[A-Z0-9_]*${SHOUT_NAME_END})=)(?=(?<value>[^\s"'\x60()$]${KEYED_VALUE_LENGTH}))\k<value>(?=[\s"'\x60]|$)`,
  "g",
);

/**
 * A value that reads as a name: lowercase words and short numbers behind
 * separators, as a design token (`--font-size-2`, `gray-200`), a resource
 * name (`db-secret-v2`) or a storage key (`app.session.v2`) is written. A
 * weak password has the same shape, so under a password key it is one.
 */
export const NAME_SHAPED_VALUE =
  /^-{0,2}(?:[a-z]+|v?\d{1,4})(?:[-._:/](?:[a-z]+|v?\d{1,4}))+$/;

/** A key that ends as a password's does, where even a name-shaped value is one. */
export const PASSWORD_KEY = /pass(?:word|wd|phrase)$/i;

/** How a stand-in starts where a cut left no end to judge it by. */
export const PLACEHOLDER_START = /^[$<{*]/;

/** A literal built at run time, which holds no secret of its own. */
export const INTERPOLATION = /\$\{|#\{|\{\{/;

/** A regular expression's source: a group, a class or a shorthand. */
export const PATTERN_SOURCE = /\(\?[:=!]|\[\^|\[(?:a-z|A-Z|0-9)|\\{1,2}[dwsb]/;

/** A key that ends in `token`, the word a lexer also names its patterns by. */
export const TOKEN_KEY = /token$/i;

/** Longer than any word a pattern spells out, so a value holding one is a credential whatever else it holds. */
export const LONG_ALPHANUMERIC_RUN = /[A-Za-z0-9]{16,}/;

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
