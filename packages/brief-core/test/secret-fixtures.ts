import {
  SecretKinds,
  type SecretKind,
} from "../src/generation/redaction/types";

// Every fake is assembled from parts: the CI secrets scan reads this file's
// text, and a token-shaped literal here would fail it.
function joinParts(...parts: string[]): string {
  return parts.join("");
}

function encodeJwtSegment(value: object): string {
  const json = JSON.stringify(value);
  return Buffer.from(json).toString("base64url");
}

export const FAKE_PEM_BEGIN = joinParts(
  "-----BEGIN ",
  "RSA PRIVATE",
  " KEY-----",
);
export const FAKE_PEM_END = joinParts("-----END ", "RSA PRIVATE", " KEY-----");
export const FAKE_PEM_BODY = [
  joinParts(
    "MIIEow",
    "IBAAKCAQEAu1SU1LfVLPHCozMxH2Mo4lgOEePzNm0tRgeLezV6ffAt0gun",
  ),
  joinParts(
    "VTLw7o",
    "nhRaRqhPjNsaHUBbL9ek4DtPBi7Bb7JtLv8YUJmfXx9GqbrNcDn5Mt8u8l",
  ),
  joinParts("Qw", "=="),
];

export function makeFakePemBlock(prefix = ""): string[] {
  return [FAKE_PEM_BEGIN, ...FAKE_PEM_BODY, FAKE_PEM_END].map(
    (line) => `${prefix}${line}`,
  );
}

/** One fake per kind, each shaped like the real format so the pattern fires. */
export const FAKE_SECRETS: Readonly<Record<SecretKind, string>> = {
  [SecretKinds.PRIVATE_KEY]: joinParts(
    FAKE_PEM_BEGIN,
    "\\n",
    FAKE_PEM_BODY.join("\\n"),
    "\\n",
    FAKE_PEM_END,
  ),
  [SecretKinds.GITHUB_TOKEN]: joinParts(
    "ghp",
    "_",
    "A1b2C3d4".repeat(4),
    "E5f6",
  ),
  [SecretKinds.GITLAB_TOKEN]: joinParts("glpat", "-", "x1Y2z3W4v5U6t7S8r9Q0"),
  [SecretKinds.SLACK_TOKEN]: joinParts(
    "xoxb",
    "-",
    "1234567890-0987654321-AbCdEfGhIjKlMnOpQrStUvWx",
  ),
  [SecretKinds.STRIPE_KEY]: joinParts(
    "sk",
    "_live_",
    "4eC39HqLyjWDarjtT1zdp7dc",
  ),
  [SecretKinds.NPM_TOKEN]: joinParts("npm", "_", "Z9y8X7w6".repeat(4), "V5u4"),
  [SecretKinds.ANTHROPIC_KEY]: joinParts(
    "sk-ant",
    "-api03-",
    "Qr7Tz2Lm9Np4Vb6Xc1Kd8Hs3Jf5Gw0Ye".repeat(2),
  ),
  [SecretKinds.OPENAI_KEY]: joinParts(
    "sk-proj",
    "-",
    "Hq3Lm8Zp2Wr7Tn4Vx9Kb1Cd6".repeat(2),
  ),
  [SecretKinds.AWS_ACCESS_KEY_ID]: joinParts("AKIA", "IOSFODNN7EXAMPLE"),
  [SecretKinds.GOOGLE_API_KEY]: joinParts("AIza", "SyB", "x9".repeat(16)),
  [SecretKinds.JWT]: [
    encodeJwtSegment({ alg: "HS256", typ: "JWT" }),
    encodeJwtSegment({ sub: "1234567890" }),
    "SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c",
  ].join("."),
  [SecretKinds.URL_PASSWORD]: joinParts("s3cr3t", "-Pa55word"),
};

/** A second spelling for kinds with more than one format. */
export const FAKE_SECRET_VARIANTS: readonly (readonly [SecretKind, string])[] =
  [
    [
      SecretKinds.GITHUB_TOKEN,
      joinParts(
        "github",
        "_pat_",
        "11ABCDEFG0",
        "a1B2c3D4e5F6",
        "_",
        "Zz9".repeat(19),
        "Q0",
      ),
    ],
    [
      SecretKinds.GITHUB_TOKEN,
      joinParts("ghs", "_", "M4n5O6p7".repeat(4), "Q8r9"),
    ],
    [SecretKinds.OPENAI_KEY, joinParts("sk", "-", "T3st".repeat(12))],
    [SecretKinds.AWS_ACCESS_KEY_ID, joinParts("ASIA", "Y3FAKEFAKEFAKE12")],
    [
      SecretKinds.SLACK_TOKEN,
      joinParts("xoxc", "-", "1234567890-AbCdEfGhIjKl"),
    ],
    [
      SecretKinds.SLACK_TOKEN,
      joinParts("xapp", "-1-A0123456789-", "AbCdEf123"),
    ],
    [SecretKinds.GITLAB_TOKEN, joinParts("glrt", "-", "AbCdEfGhIjKlMnOpQrSt")],
    [
      SecretKinds.OPENAI_KEY,
      joinParts(
        "sk-None",
        "-",
        "Ab12".repeat(6),
        "T3Blbk",
        "FJ",
        "Cd34".repeat(6),
      ),
    ],
  ];
