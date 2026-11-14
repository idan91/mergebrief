import { describe, expect, it } from "vitest";
import type { FetchedPr } from "../../src/github/types";
import {
  countPullRequestSecrets,
  countSecretKinds,
  redactDiffSecrets,
  redactProseSecrets,
} from "../../src/generation/redaction";
import { TOKEN_PREFIX } from "../../src/generation/redaction/consts";
import {
  SecretKinds,
  type SecretKind,
} from "../../src/generation/redaction/types";
import {
  FAKE_PEM_BEGIN,
  FAKE_PEM_BODY,
  FAKE_PEM_END,
  FAKE_SECRETS,
  FAKE_SECRET_VARIANTS,
  makeFakePemBlock,
} from "../secret-fixtures";
import { LINEAR_GROWTH_CEILING, measureGrowthRatio } from "../growth-ratio";

/** Kinds a value shows by its own shape; the rest take a URL, a fence or a key name around it. */
const CONTEXT_KINDS: readonly SecretKind[] = [
  SecretKinds.URL_PASSWORD,
  SecretKinds.PRIVATE_KEY,
  SecretKinds.KEYED_SECRET,
  SecretKinds.KEYED_NAME,
];
const WHOLE_VALUE_KINDS: readonly SecretKind[] = Object.values(
  SecretKinds,
).filter((kind) => !CONTEXT_KINDS.includes(kind));
/** Far past every bounded quantifier, so a lost bound shows as quadratic growth. */
const BASE_SCAN_CHARS = 64_000;

function stubMarker(kind: SecretKind): string {
  return `[redacted:${kind}]`;
}

describe("redactProseSecrets", () => {
  it.each(WHOLE_VALUE_KINDS)("replaces a %s with its marker", (kind) => {
    const text = `token: ${FAKE_SECRETS[kind]} end`;

    expect(redactProseSecrets(text).text).toBe(
      `token: ${stubMarker(kind)} end`,
    );
  });

  it.each(FAKE_SECRET_VARIANTS)(
    "replaces a second %s spelling",
    (kind, secret) => {
      expect(redactProseSecrets(`x ${secret} y`).text).toBe(
        `x ${stubMarker(kind)} y`,
      );
    },
  );

  it("keeps the URL user and host and replaces only the password", () => {
    const url = `postgres://app:${FAKE_SECRETS[SecretKinds.URL_PASSWORD]}@db.internal:5432/app`;

    expect(redactProseSecrets(url).text).toBe(
      `postgres://app:${stubMarker(SecretKinds.URL_PASSWORD)}@db.internal:5432/app`,
    );
  });

  it.each([
    "postgres://app:${DB_PASSWORD}@db/app",
    "postgres://app:$DB_PASSWORD@db/app",
    "postgres://app:${db_password}@db/app",
    "https://user:<password>@host",
    "https://user:{{ password }}@host",
    "https://user:****@host",
    "postgres://user:pass@localhost:5432",
    "postgres://app:Password@db/app",
    "amqp://guest:changeme@queue",
  ])("keeps a placeholder password in %s", (url) => {
    expect(redactProseSecrets(url).text).toBe(url);
  });

  it("redacts a multi-line key block and keeps its fence lines", () => {
    const text = ["Here is the key:", ...makeFakePemBlock(), "Thanks"].join(
      "\n",
    );
    const marker = stubMarker(SecretKinds.PRIVATE_KEY);

    expect(redactProseSecrets(text).text).toBe(
      [
        "Here is the key:",
        FAKE_PEM_BEGIN,
        marker,
        marker,
        marker,
        FAKE_PEM_END,
        "Thanks",
      ].join("\n"),
    );
  });

  it("stops a key block at the first line that is not key material", () => {
    const text = `Files open with ${FAKE_PEM_BEGIN} and then\nthe rest of the description`;

    expect(redactProseSecrets(text).text).toBe(text);
  });
});

describe("redactDiffSecrets", () => {
  it.each(["+", "-", " "])(
    "redacts a token on a line starting %j",
    (prefix) => {
      const diff = `${prefix}const token = "${FAKE_SECRETS[SecretKinds.GITHUB_TOKEN]}";`;

      expect(redactDiffSecrets(diff).text).toBe(
        `${prefix}const token = "${stubMarker(SecretKinds.GITHUB_TOKEN)}";`,
      );
    },
  );

  it("redacts an added key block line by line and keeps the prefix", () => {
    const diff = ["@@ -0,0 +1,5 @@", ...makeFakePemBlock("+")].join("\n");
    const marker = `+${stubMarker(SecretKinds.PRIVATE_KEY)}`;

    expect(redactDiffSecrets(diff).text).toBe(
      [
        "@@ -0,0 +1,5 @@",
        `+${FAKE_PEM_BEGIN}`,
        marker,
        marker,
        marker,
        `+${FAKE_PEM_END}`,
      ].join("\n"),
    );
  });

  it("keeps the indent of an indented key block body", () => {
    const diff = ["+key: |", ...makeFakePemBlock("+    ")].join("\n");
    const lines = redactDiffSecrets(diff).text.split("\n");

    expect(lines[2]).toBe(`+    ${stubMarker(SecretKinds.PRIVATE_KEY)}`);
  });

  it("redacts a removed key block too", () => {
    const diff = makeFakePemBlock("-").join("\n");

    expect(redactDiffSecrets(diff).text).not.toContain(FAKE_PEM_BODY[0]);
  });

  it("redacts the one-line escaped key of a service-account file", () => {
    const diff = `+  "private_key": "${FAKE_SECRETS[SecretKinds.PRIVATE_KEY]}\\n",`;

    expect(redactDiffSecrets(diff).text).toBe(
      `+  "private_key": "${FAKE_PEM_BEGIN}${stubMarker(SecretKinds.PRIVATE_KEY)}${FAKE_PEM_END}\\n",`,
    );
  });

  it("ends a key block at a hunk header", () => {
    const diff = [
      "+" + FAKE_PEM_BEGIN,
      "@@ -10,2 +10,2 @@",
      "+MIIEowIBAAKCAQ",
    ].join("\n");

    expect(redactDiffSecrets(diff).text.split("\n")[2]).toBe("+MIIEowIBAAKCAQ");
  });

  it("keeps every line in place across a mixed diff", () => {
    const diff = [
      "diff --git a/config.ts b/config.ts",
      "@@ -1,3 +1,9 @@",
      " export const config = {",
      `-  token: "${FAKE_SECRETS[SecretKinds.SLACK_TOKEN]}",`,
      `+  token: process.env.SLACK_TOKEN,`,
      ...makeFakePemBlock("+"),
      `+  aws: "${FAKE_SECRETS[SecretKinds.AWS_ACCESS_KEY_ID]}",`,
      " };",
    ];
    const redacted = redactDiffSecrets(diff.join("\n")).text.split("\n");

    expect(redacted).toHaveLength(diff.length);
    for (const index of [0, 1, 2, 4, 5, 9, 11]) {
      expect(redacted[index]).toBe(diff[index]);
    }
  });

  it("reports each hit with its kind and line", () => {
    const diff = [
      " unchanged",
      `+const a = "${FAKE_SECRETS[SecretKinds.NPM_TOKEN]}";`,
      ...makeFakePemBlock("+"),
    ].join("\n");

    expect(redactDiffSecrets(diff).hits).toEqual([
      { kind: SecretKinds.NPM_TOKEN, line: 1 },
      { kind: SecretKinds.PRIVATE_KEY, line: 3 },
      { kind: SecretKinds.PRIVATE_KEY, line: 4 },
      { kind: SecretKinds.PRIVATE_KEY, line: 5 },
    ]);
  });
});

describe("redactDiffSecrets around key blocks and headers", () => {
  const firstBody = FAKE_PEM_BODY[0] ?? "";
  const marker = stubMarker(SecretKinds.PRIVATE_KEY);

  it("redacts a token git copied into a hunk header", () => {
    const secret = FAKE_SECRETS[SecretKinds.ANTHROPIC_KEY];

    expect(
      redactDiffSecrets(`@@ -17,6 +17,7 @@ API_KEY = "${secret}"`).text,
    ).toBe(
      `@@ -17,6 +17,7 @@ API_KEY = "${stubMarker(SecretKinds.ANTHROPIC_KEY)}"`,
    );
  });

  it("redacts a token git cut short at the end of a hunk header", () => {
    const cut = FAKE_SECRETS[SecretKinds.GITHUB_TOKEN].slice(0, 30);

    expect(
      redactDiffSecrets(`@@ -9,6 +9,7 @@ export const bot = { token: "${cut}`)
        .text,
    ).toBe(
      `@@ -9,6 +9,7 @@ export const bot = { token: "${stubMarker(SecretKinds.GITHUB_TOKEN)}`,
    );
  });

  it("redacts a cut-short header token right after a percent escape", () => {
    const cut = FAKE_SECRETS[SecretKinds.GITHUB_TOKEN].slice(0, 30);

    expect(
      redactDiffSecrets(`@@ -1,2 +1,2 @@ fetch("https://x?t=%22${cut}`).text,
    ).toBe(
      `@@ -1,2 +1,2 @@ fetch("https://x?t=%22${stubMarker(SecretKinds.GITHUB_TOKEN)}`,
    );
  });

  it("redacts a key line git copied into a hunk header", () => {
    const diff = [
      `@@ -8,4 +8,4 @@ ${firstBody}`,
      ` ${FAKE_PEM_END}"`,
      "-API_URL=old",
      "+API_URL=new",
    ];
    const redacted = redactDiffSecrets(diff.join("\n")).text.split("\n");

    expect(redacted[0]).toBe(`@@ -8,4 +8,4 @@ ${marker}`);
    expect(redacted.slice(2)).toEqual(["-API_URL=old", "+API_URL=new"]);
  });

  it("redacts a hunk that starts inside a key block", () => {
    const [first = "", second = "", last = ""] = FAKE_PEM_BODY;
    const diff = [
      `@@ -2,4 +2,4 @@ ${first}`,
      ` ${second}`,
      `-${first}`,
      `+${second}`,
      ` ${last}`,
      ` ${FAKE_PEM_END}`,
    ];
    const redacted = redactDiffSecrets(diff.join("\n")).text;

    for (const body of [first, second, last]) {
      expect(redacted).not.toContain(body);
    }
    expect(redacted.split("\n")[5]).toBe(` ${FAKE_PEM_END}`);
  });

  it("opens a key block when the hunk header holds its BEGIN fence", () => {
    const [first = "", second = ""] = FAKE_PEM_BODY;
    const diff = [
      `@@ -2,4 +2,4 @@ RSA_KEY="${FAKE_PEM_BEGIN}`,
      ` ${first}`,
      `-${second}`,
      `+${second.slice(1)}`,
    ];
    const redacted = redactDiffSecrets(diff.join("\n")).text;

    expect(redacted).not.toContain(first);
    expect(redacted).not.toContain(second.slice(1));
  });

  it("redacts key material git cut short in a hunk header", () => {
    const header = `@@ -2,5 +2,5 @@ KEY="${FAKE_PEM_BEGIN}\\n${firstBody.slice(0, 30)}`;

    expect(redactDiffSecrets(header).text).toBe(
      `@@ -2,5 +2,5 @@ KEY="${FAKE_PEM_BEGIN}${marker}`,
    );
  });

  it("redacts a URL password git cut short in a hunk header", () => {
    const password = FAKE_SECRETS[SecretKinds.URL_PASSWORD];
    const header = `@@ -1,3 +1,3 @@ DATABASE_URL=postgresql://app:${password.slice(0, 10)}`;

    expect(redactDiffSecrets(header).text).toBe(
      `@@ -1,3 +1,3 @@ DATABASE_URL=postgresql://app:${stubMarker(SecretKinds.URL_PASSWORD)}`,
    );
  });

  it("keeps a port at the end of a hunk header", () => {
    const header = "@@ -1,3 +1,3 @@ BASE_URL=http://localhost:3000";

    expect(redactDiffSecrets(header).text).toBe(header);
  });

  it.each([
    ["no context", ""],
    ["an armor header", " DEK-Info: AES-128-CBC,3F17F5316E2BAC89"],
  ])("redacts a hunk inside a key with %s in its header", (_label, context) => {
    const [first = "", second = ""] = FAKE_PEM_BODY;
    const diff = [
      `@@ -2,3 +2,3 @@${context}`,
      ` ${first}`,
      `-${first}`,
      `+${second}`,
    ];
    const redacted = redactDiffSecrets(diff.join("\n")).text;

    expect(redacted).not.toContain(first);
    expect(redacted).not.toContain(second);
  });

  it.each([
    ["a blank line", "@@ -2,7 +2,7 @@", [" "]],
    [
      "armor headers",
      "@@ -2,7 +2,7 @@ Proc-Type: 4,ENCRYPTED",
      [" DEK-Info: AES-128-CBC,3F17F5316E2BAC89", " "],
    ],
  ])("waits past %s for a key below a hunk header", (_label, header, lead) => {
    const [first = "", second = ""] = FAKE_PEM_BODY;
    const diff = [header, ...lead, ` ${first}`, `-${first}`, `+${second}`];
    const redacted = redactDiffSecrets(diff.join("\n")).text;

    expect(redacted).not.toContain(first);
    expect(redacted).not.toContain(second);
  });

  it("redacts key lines below an unlisted armor header", () => {
    const [first = "", second = ""] = FAKE_PEM_BODY;
    const diff = [
      "@@ -3,3 +3,3 @@ Key-Usage: signing",
      ` ${first}`,
      `+${second}`,
    ];
    const redacted = redactDiffSecrets(diff.join("\n")).text;

    expect(redacted).not.toContain(first);
    expect(redacted).not.toContain(second);
  });

  it("closes a header-opened block on a line that is not key material", () => {
    const diff = ["@@ -4,3 +4,3 @@", " name: ci", ` ${firstBody}`];

    expect(redactDiffSecrets(diff.join("\n")).text).toBe(diff.join("\n"));
  });

  it.each([
    [
      "a SHA in its header",
      "@@ -17,7 +17,7 @@ a94a8fe5ccb19ba61c4c0873d391e987982fbbd3",
    ],
    ["an empty header", "@@ -17,7 +17,7 @@"],
  ])("keeps a SHA manifest hunk with %s", (_label, header) => {
    const shas = [
      "da39a3ee5e6b4b0d3255bfef95601890afd80709",
      "2fd4e1c67a2d28fced849ee1bb76e7391b93eb12",
      "de9f2c7fd25e1b3afad3e85a0bd17d9b100db4b3",
    ];
    const diff = [
      header,
      ` ${shas[0]}`,
      ` ${shas[1]}`,
      `-${shas[2]}`,
      `+${"f".repeat(64)}`,
      " 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
    ].join("\n");

    const redaction = redactDiffSecrets(diff);

    expect(redaction.text).toBe(diff);
    expect(redaction.hits).toEqual([]);
  });

  it.each([
    ["a certificate", "-----END CERTIFICATE-----"],
    ["a PGP public key", "-----END PGP PUBLIC KEY BLOCK-----"],
    ["an SSH2 public key", "---- END SSH2 PUBLIC KEY ----"],
  ])("keeps the body of %s a hunk ends in", (_label, end) => {
    const [first = "", second = ""] = FAKE_PEM_BODY;
    const diff = [
      `@@ -9,5 +9,5 @@ ${first}`,
      ` ${second}`,
      `-${first}`,
      `+${second}`,
      " =Yd4A",
      ` ${end}`,
    ].join("\n");

    const redaction = redactDiffSecrets(diff);

    expect(redaction.text).toBe(diff);
    expect(redaction.hits).toEqual([]);
  });

  it.each([
    [
      "its short last line and checksum",
      (tail: string) => [` ${tail}`, " =Yd4A"],
    ],
    [
      "an old and a new tail",
      (tail: string) => [`-${tail}`, "-=Yd4A", `+${tail}`, "+=Qw9z"],
    ],
    ["an eight char last line", () => [" iQ8kVw==", " =Yd4A"]],
  ])("keeps a PGP public key that ends after %s", (_label, ending) => {
    const [first = "", second = ""] = FAKE_PEM_BODY;
    const tail = second.slice(0, 40);
    const diff = [
      `@@ -40,6 +40,6 @@ ${first}`,
      ` ${second}`,
      `-${first}`,
      `+${second}`,
      ...ending(tail),
      " -----END PGP PUBLIC KEY BLOCK-----",
    ].join("\n");

    expect(redactDiffSecrets(diff).hits).toEqual([]);
  });

  it("keeps an inferred key redacted past its END and a later certificate", () => {
    const [first = "", second = ""] = FAKE_PEM_BODY;
    const diff = [
      `@@ -9,4 +9,4 @@ ${first}`,
      ` ${second}`,
      ` ${FAKE_PEM_END}`,
      " -----END CERTIFICATE-----",
    ].join("\n");

    const redacted = redactDiffSecrets(diff).text;

    expect(redacted).not.toContain(first);
    expect(redacted).not.toContain(second);
  });

  it("keeps an inferred key redacted when its END line holds a certificate", () => {
    const [first = "", second = ""] = FAKE_PEM_BODY;
    const glued = `${FAKE_PEM_END}\\n-----BEGIN CERTIFICATE-----\\nMIIB\\n-----END CERTIFICATE-----`;
    const diff = [`@@ -9,3 +9,3 @@ ${first}`, ` ${second}`, ` ${glued}`].join(
      "\n",
    );

    expect(redactDiffSecrets(diff).text).not.toContain(first);
  });

  it("redacts the private lines of a PuTTY key", () => {
    const [first = "", second = ""] = FAKE_PEM_BODY;
    const diff = [
      "@@ -0,0 +1,6 @@",
      "+PuTTY-User-Key-File-3: ssh-rsa",
      "+Encryption: none",
      "+Private-Lines: 2",
      `+${first}`,
      `+${second}`,
      "+Private-MAC: 9a1f",
    ].join("\n");

    const redacted = redactDiffSecrets(diff).text;

    expect(redacted).not.toContain(first);
    expect(redacted).not.toContain(second);
    expect(redacted).toContain("+Private-MAC: 9a1f");
  });

  it("redacts PuTTY private lines below a hunk header that names them", () => {
    const [first = "", second = ""] = FAKE_PEM_BODY;
    const diff = [
      "@@ -9,2 +9,2 @@ Private-Lines: 14",
      ` ${first}`,
      `+${second}`,
    ];

    const redacted = redactDiffSecrets(diff.join("\n")).text;

    expect(redacted).not.toContain(first);
    expect(redacted).not.toContain(second);
  });

  it("redacts the short last line of an inferred key the hunk ends on", () => {
    const [first = "", second = ""] = FAKE_PEM_BODY;
    const tail = second.slice(0, 40);
    const diff = [
      `@@ -9,3 +9,3 @@ ${first}`,
      ` ${second}`,
      `-${first}`,
      `+${tail}`,
    ];

    expect(redactDiffSecrets(diff.join("\n")).text).not.toContain(tail);
  });

  it("keeps a base64 line at the top of a new file", () => {
    const diff = ["@@ -0,0 +1,2 @@", `+${firstBody}`, "+done"].join("\n");

    expect(redactDiffSecrets(diff).text).toBe(diff);
  });

  it("keeps code after a key-line header once the block ends", () => {
    const diff = [`@@ -9,2 +9,2 @@ ${firstBody}`, "-return;", "+return 1;"];
    const redacted = redactDiffSecrets(diff.join("\n")).text.split("\n");

    expect(redacted.slice(1)).toEqual(["-return;", "+return 1;"]);
  });

  it("keeps a token-prefixed path in a file header", () => {
    const header = "diff --git a/bin/sk-deploy-tool b/bin/sk-deploy-tool";

    expect(redactDiffSecrets(header).text).toBe(header);
  });

  it("keeps a short prefix-shaped word in a hunk header", () => {
    const header = "@@ -1,2 +1,2 @@ function sk-flag";

    expect(redactDiffSecrets(header).text).toBe(header);
  });

  it.each([
    ["a leading concatenation operator", `    + "${firstBody}\\n"`],
    ["a bytes literal", `    b"${firstBody}\\n"`],
    ["a trailing dot operator", `"${firstBody}\\n" .`],
    ["an escaped CRLF", `"${firstBody}\\r\\n" +`],
  ])("redacts a key body written with %s", (_label, bodyLine) => {
    const diff = [
      `+  "${FAKE_PEM_BEGIN}\\n"`,
      `+${bodyLine}`,
      `+  "${FAKE_PEM_END}"`,
    ];
    const redacted = redactDiffSecrets(diff.join("\n")).text.split("\n");

    expect(redacted[1]).toContain(marker);
    expect(redacted[1]).not.toContain(firstBody);
  });

  it("redacts a removed key block inside a pasted diff", () => {
    const pasted = makeFakePemBlock("-").join("\n");

    expect(redactProseSecrets(pasted).text).not.toContain(firstBody);
  });

  it.each([
    ["a line comment", "// "],
    ["a hash comment", "# "],
    ["a block comment star", " * "],
    ["a quote marker", "> "],
  ])("redacts a key body behind %s", (_label, marker_) => {
    const diff = makeFakePemBlock(`+${marker_}`).join("\n");

    expect(redactDiffSecrets(diff).text).not.toContain(firstBody);
  });

  it("keeps the added side's block open past a removed END fence", () => {
    const diff = [
      ` ${FAKE_PEM_BEGIN}`,
      `-${firstBody}`,
      `-${FAKE_PEM_END}`,
      "\\ No newline at end of file",
      `+${FAKE_PEM_BODY[1] ?? ""}`,
      `+${FAKE_PEM_END}`,
    ];
    const redacted = redactDiffSecrets(diff.join("\n")).text.split("\n");

    expect(redacted[1]).toBe(`-${marker}`);
    expect(redacted[4]).toBe(`+${marker}`);
  });

  it("redacts a token on a header-shaped line inside a block", () => {
    const token = FAKE_SECRETS[SecretKinds.GITHUB_TOKEN];
    const diff = `+  marker: ${FAKE_PEM_BEGIN}\n+  token: ${token}`;

    expect(redactDiffSecrets(diff).text).not.toContain(token);
  });

  it("redacts the key body above an END fence whose BEGIN is out of the hunk", () => {
    const diff = [
      "@@ -20,4 +20,4 @@",
      ` ${firstBody}`,
      ` ${FAKE_PEM_BODY[2] ?? ""}`,
      ` ${FAKE_PEM_END}`,
      " -----BEGIN CERTIFICATE-----",
    ];
    const redacted = redactDiffSecrets(diff.join("\n")).text.split("\n");

    expect(redacted.slice(1, 3)).toEqual([` ${marker}`, ` ${marker}`]);
    expect(redacted[4]).toBe(" -----BEGIN CERTIFICATE-----");
  });

  it("leaves short words above a stray END fence alone", () => {
    const diff = [" Example", ` ${FAKE_PEM_END}`].join("\n");

    expect(redactDiffSecrets(diff).text).toBe(diff);
  });

  it.each([
    ["a percent escape", "%22"],
    ["a unicode escape", "\\u0022"],
    ["a hex escape", "\\x22"],
  ])("redacts a token right after %s", (_label, escape) => {
    const token = FAKE_SECRETS[SecretKinds.GITHUB_TOKEN];

    expect(redactDiffSecrets(`+q=${escape}${token}`).text).toBe(
      `+q=${escape}${stubMarker(SecretKinds.GITHUB_TOKEN)}`,
    );
  });

  it("redacts a token right after an escaped newline in a string", () => {
    const token = FAKE_SECRETS[SecretKinds.GITHUB_TOKEN];

    expect(redactDiffSecrets(`+"first\\n${token}"`).text).toBe(
      `+"first\\n${stubMarker(SecretKinds.GITHUB_TOKEN)}"`,
    );
  });
});

describe("redaction around hidden chars", () => {
  it.each(WHOLE_VALUE_KINDS)("knows where a %s starts", (kind) => {
    TOKEN_PREFIX.lastIndex = 0;

    expect(TOKEN_PREFIX.test(FAKE_SECRETS[kind])).toBe(true);
  });

  it("redacts a JWT a hidden char splits after a word ending in its prefix", () => {
    const jwt = FAKE_SECRETS[SecretKinds.JWT];
    const split = `${jwt.slice(0, 8)}\u200B${jwt.slice(8)}`;

    expect(redactProseSecrets(`keyJWT.${split}`).text).toBe(
      `keyJWT.${stubMarker(SecretKinds.JWT)}\u200B`,
    );
  });

  it("puts the hidden chars of a redacted run after its marker", () => {
    const token = FAKE_SECRETS[SecretKinds.SLACK_TOKEN];
    const split = `${token.slice(0, 10)}\u202E${token.slice(10)}`;

    expect(redactDiffSecrets(`+t = "${split}";`).text).toBe(
      `+t = "${stubMarker(SecretKinds.SLACK_TOKEN)}\u202E";`,
    );
  });
});

describe("redactProseSecrets on URL passwords", () => {
  const password = FAKE_SECRETS[SecretKinds.URL_PASSWORD];
  const marker = stubMarker(SecretKinds.URL_PASSWORD);

  it("redacts a password that only looks like a lowercase variable", () => {
    expect(redactProseSecrets("postgres://app:$ecr3t9@db/app").text).toBe(
      `postgres://app:${marker}@db/app`,
    );
  });

  it("redacts a password with an empty user", () => {
    expect(redactProseSecrets(`redis://:${password}@cache:6379`).text).toBe(
      `redis://:${marker}@cache:6379`,
    );
  });

  it("redacts a password holding an unencoded at sign whole", () => {
    expect(redactProseSecrets(`postgres://app:p@${password}@db/app`).text).toBe(
      `postgres://app:${marker}@db/app`,
    );
  });

  it("stops a URL password at a quote in minified JSON", () => {
    const json = `{"a":"pg://u:${password}@h","b":"me@x.com"}`;

    expect(redactProseSecrets(json).text).toBe(
      `{"a":"pg://u:${marker}@h","b":"me@x.com"}`,
    );
  });

  it("redacts a URL password right after a percent escape", () => {
    expect(redactProseSecrets(`%22pg://u:${password}@db%22`).text).toBe(
      `%22pg://u:${marker}@db%22`,
    );
  });

  it("counts a token used as a URL password once", () => {
    const token = FAKE_SECRETS[SecretKinds.GITHUB_TOKEN];

    expect(
      redactProseSecrets(`https://x-access-token:${token}@github.com`).hits,
    ).toHaveLength(1);
  });

  it("keeps a port and a path with an at sign untouched", () => {
    const url = "http://localhost:3000/users/@me";

    expect(redactProseSecrets(url).text).toBe(url);
  });
});

describe("redaction of a value assigned to a secret-named key", () => {
  const value = FAKE_SECRETS[SecretKinds.KEYED_SECRET];
  const marker = stubMarker(SecretKinds.KEYED_SECRET);
  const nameMarker = stubMarker(SecretKinds.KEYED_NAME);

  it.each([
    ["a quoted assignment", `password = "${value}"`, `password = "${marker}"`],
    [
      "a password that reads as a name",
      'db_password = "winter-2024"',
      `db_password = "${marker}"`,
    ],
    [
      "a name-shaped start with a random end",
      'token: "live_app_a1b2c3d4e5f6"',
      `token: "${marker}"`,
    ],
    [
      "a single-quoted entry",
      `  API_KEY: '${value}'`,
      `  API_KEY: '${marker}'`,
    ],
    [
      "a JSON entry",
      `  "client_secret": "${value}",`,
      `  "client_secret": "${marker}",`,
    ],
    [
      "a header name",
      `  "x-api-key": "${value}",`,
      `  "x-api-key": "${marker}",`,
    ],
    [
      "a camel-case name",
      `const accessToken = "${value}";`,
      `const accessToken = "${marker}";`,
    ],
    [
      "a hash rocket",
      `  'db_password' => '${value}',`,
      `  'db_password' => '${marker}',`,
    ],
    [
      "a typed declaration",
      `const apiKey: string = "${value}";`,
      `const apiKey: string = "${marker}";`,
    ],
    [
      "a declaration with the type after the name",
      `var password string = "${value}"`,
      `var password string = "${marker}"`,
    ],
    ["a sigil variable", `$password = '${value}';`, `$password = '${marker}';`],
    [
      "a flag's literal after an equals sign",
      `--from-literal=password='${value}'`,
      `--from-literal=password='${marker}'`,
    ],
    [
      "a dotted key after an equals sign",
      `--set=auth.password="${value}"`,
      `--set=auth.password="${marker}"`,
    ],
    [
      "a Go variable inside a one-line function",
      `func f() { var password string = "${value}" }`,
      `func f() { var password string = "${marker}" }`,
    ],
    [
      "a token with a pattern fragment beside a long run",
      'token: "a1B2c3D4e5F6g7H8i9J0[a-z]"',
      `token: "${marker}"`,
    ],
    [
      "a password holding pattern characters",
      'db_password = "Sup3r[a-z]Pw"',
      `db_password = "${marker}"`,
    ],
    [
      "a Go variable inside a block",
      `\tapiKey string = "${value}"`,
      `\tapiKey string = "${marker}"`,
    ],
    ["a symbol key", `:password => "${value}"`, `:password => "${marker}"`],
    [
      "a subscript",
      `os.environ['API_KEY'] = '${value}'`,
      `os.environ['API_KEY'] = '${marker}'`,
    ],
    [
      "a value holding the other quote",
      `password = "it's-${value}"`,
      `password = "${marker}"`,
    ],
    [
      "a value holding an escaped quote",
      `password = "a\\"${value}"`,
      `password = "${marker}"`,
    ],
    [
      "an optional typed property",
      `  apiKey?: string = "${value}";`,
      `  apiKey?: string = "${marker}";`,
    ],
    [
      "a union-typed declaration",
      `let token: string | undefined = "${value}";`,
      `let token: string | undefined = "${marker}";`,
    ],
    [
      "a type with a bracketed argument list",
      `api_key: Union[str, None] = "${value}"`,
      `api_key: Union[str, None] = "${marker}"`,
    ],
    [
      "a union with an array member",
      `let token: string | string[] = "${value}";`,
      `let token: string | string[] = "${marker}";`,
    ],
    [
      "a union with a digit in a member",
      `const apiKey: string | Uint8Array = "${value}";`,
      `const apiKey: string | Uint8Array = "${marker}";`,
    ],
    [
      "a generic type",
      `val secret: Map<String, String> = "${value}"`,
      `val secret: Map<String, String> = "${marker}"`,
    ],
    [
      "a union inside a type's brackets",
      `API_TOKEN: Final[str | None] = "${value}"`,
      `API_TOKEN: Final[str | None] = "${marker}"`,
    ],
    [
      "a type nested one level",
      `password: ClassVar[Optional[str]] = "${value}"`,
      `password: ClassVar[Optional[str]] = "${marker}"`,
    ],
    [
      "a union inside a generic",
      `const token: NonNullable<string | undefined> = "${value}";`,
      `const token: NonNullable<string | undefined> = "${marker}";`,
    ],
    ["an env file line", `DB_PASSWORD=${value}`, `DB_PASSWORD=${marker}`],
    ["an env name that is only the word", `TOKEN=${value}`, `TOKEN=${marker}`],
    ["a two-word env name", `API_KEY=${value}`, `API_KEY=${marker}`],
    [
      "an exported one-word name",
      `export PASSWORD=${value}`,
      `export PASSWORD=${marker}`,
    ],
    [
      "an exported variable",
      `export AUTH_TOKEN=${value}`,
      `export AUTH_TOKEN=${marker}`,
    ],
    [
      "a compose environment entry",
      `      - AWS_SECRET_ACCESS_KEY=${value}`,
      `      - AWS_SECRET_ACCESS_KEY=${marker}`,
    ],
  ])("replaces the value of %s", (_label, text, expected) => {
    expect(redactProseSecrets(text).text).toBe(expected);
    expect(redactDiffSecrets(`+${text}`).text).toBe(`+${expected}`);
  });

  it.each([
    [
      "the next key after a secret-named one",
      'new S3Client({ secretAccessKey: secret, region: "eu-west-1" })',
    ],
    [
      "a model id beside an api key",
      'new Client({ apiKey: key, model: "claude-opus-4" })',
    ],
    [
      "a base URL beside a token",
      'createClient({ token: env.TOKEN, baseUrl: "https://api.v2.example.com" })',
    ],
    [
      "a default beside a typed secret parameter",
      'function sign(accessToken: string, scope = "repo:read1") {}',
    ],
    [
      "a literal type beside a typed secret parameter",
      'function sign(accessToken: string, scope: "repo:read1") {}',
    ],
    [
      "the attribute after a password field's type",
      '<input type="password" name="password2" id="id_password2">',
    ],
    [
      "the attribute after an unquoted password type",
      '<input type=password name="password2">',
    ],
    [
      "the attribute after a token-named one",
      '<meta name="csrf-token" content="abc123def456">',
    ],
    [
      "a struct tag after a password tag",
      'Password string `json:"password" db:"password_hash1"`',
    ],
    [
      "a comparison after a quoted token",
      "WHERE kind = 'token' AND name = 'abc12345'",
    ],
    [
      "a keyword beside a quoted password",
      '{:type "password" :name "password2"}',
    ],
    ["prose with a word before the equals", '// the token type = "bearer1234"'],
    [
      "a lexer pattern under a token name",
      'const IDENT_TOKEN = "[a-zA-Z_][a-zA-Z0-9_]*";',
    ],
    [
      "a pattern with a group under a token name",
      String.raw`const escToken = '\(?:[^\r\n\f\da-f]|[\da-f]{1,6})';`,
    ],
    ["an identifier", "password = userPassword2"],
    ["a member read", "const token = config.auth.token2;"],
    ["a function call", 'password = readSecret("primary1")'],
    ["an env reference", "API_KEY=$UPSTREAM_KEY_V2"],
    ["a braced env reference", 'API_KEY="${UPSTREAM_KEY_V2}"'],
    ["a command substitution", "TOKEN=$(vault read secret/app1)"],
    ["a template slot", 'password: "{{ .Values.db2 }}"'],
    ["an interpolated literal", "token: `${prefix}-abc12345`"],
    ["a docs stand-in", 'api_key: "<your-api-key-1>"'],
    ["a value with no digit", 'password = "correct-horse"'],
    ["a value with no letter", 'token = "1234567890"'],
    ["a short value", 'token = "abc123"'],
    ["a sentence", 'password: "must hold 8 characters"'],
    ["a name that only starts with the word", 'tokenCount = "12345678ab"'],
    ["a name with a later part", 'password_hint = "use8chars"'],
    ["a plural name", "MAX_TOKENS=4096abcd"],
    ["a lowercase unquoted pair", "token=abcdef123456"],
  ])("keeps %s untouched", (_label, text) => {
    expect(redactProseSecrets(text).text).toBe(text);
    expect(redactDiffSecrets(`+${text}`).text).toBe(`+${text}`);
  });

  it.each([
    [
      "a CSS custom property under a token name",
      'export const FONT_SIZE_TOKEN: DesignToken = "--font-size-2";',
      `export const FONT_SIZE_TOKEN: DesignToken = "${nameMarker}";`,
    ],
    [
      "a design token",
      'colorToken: "blue-500",',
      `colorToken: "${nameMarker}",`,
    ],
    [
      "a storage key under a token name",
      'STORAGE_TOKEN = "mb.session.v2"',
      `STORAGE_TOKEN = "${nameMarker}"`,
    ],
    [
      "the name of a stored secret",
      'existingSecret: "db-secret-v2"',
      `existingSecret: "${nameMarker}"`,
    ],
    [
      "a name under a reset token's key",
      'passwordResetToken: "reset-link-v2"',
      `passwordResetToken: "${nameMarker}"`,
    ],
    [
      "a name under an env token",
      "SESSION_TOKEN=app-session-v2",
      `SESSION_TOKEN=${nameMarker}`,
    ],
  ])("hides %s under the name marker", (_label, text, expected) => {
    expect(redactProseSecrets(text).text).toBe(expected);
    expect(redactDiffSecrets(`+${text}`).text).toBe(`+${expected}`);
  });

  it("replaces a whole value a known format covers only the start of", () => {
    const start = FAKE_SECRETS[SecretKinds.AWS_ACCESS_KEY_ID];

    const redaction = redactProseSecrets(
      `client_secret = "${start}/rest-of-it-Qw7"`,
    );

    expect(redaction.text).toBe(`client_secret = "${marker}"`);
  });

  it("names the format when the value is a known token", () => {
    const token = FAKE_SECRETS[SecretKinds.GITHUB_TOKEN];

    const redaction = redactProseSecrets(`const token = "${token}";`);

    expect(redaction.text).toBe(
      `const token = "${stubMarker(SecretKinds.GITHUB_TOKEN)}";`,
    );
    expect(redaction.hits).toEqual([
      { kind: SecretKinds.GITHUB_TOKEN, line: 0 },
    ]);
  });

  it("keeps every line and reports the value's line", () => {
    const diff = ["@@ -1,2 +1,3 @@", " a = 1", `+password = "${value}"`, " b"];

    const redaction = redactDiffSecrets(diff.join("\n"));

    expect(redaction.text.split("\n")).toHaveLength(diff.length);
    expect(redaction.hits).toEqual([
      { kind: SecretKinds.KEYED_SECRET, line: 2 },
    ]);
  });

  it("replaces what a hunk header kept of a value git cut short", () => {
    const header = `@@ -40,6 +40,7 @@ DATABASE_PASSWORD = "Xy9-${value}-and-then-the-cut`;

    const redaction = redactDiffSecrets(`${header}\n context`);

    expect(redaction.text).toBe(
      `@@ -40,6 +40,7 @@ DATABASE_PASSWORD = "${marker}\n context`,
    );
  });

  it("leaves a hunk header's cut stand-in as written", () => {
    const header = '@@ -40,6 +40,7 @@ password = "{{ .Values.database';

    expect(redactDiffSecrets(header).text).toBe(header);
  });

  it("finds a value a hidden char splits", () => {
    const split = `${value.slice(0, 4)}\u200B${value.slice(4)}`;

    const redaction = redactProseSecrets(`password = "${split}"`);

    expect(redaction.text).not.toContain(value.slice(4));
  });
});

describe("hunk header cost", () => {
  it.each([
    [
      "secret names beside other keys",
      (chars: number) => 'token: t, x="ab '.repeat(chars / 16),
    ],
    [
      "cut values that open the next",
      (chars: number) => 'password="a'.repeat(chars / 11),
    ],
  ])("scans a long header of %s in linear time", (_label, makeContext) => {
    const ratio = measureGrowthRatio((scale) => {
      const header = `@@ -2 +2 @@ ${makeContext(BASE_SCAN_CHARS * scale)}`;
      return () => redactDiffSecrets(header);
    });

    expect(ratio).toBeLessThan(LINEAR_GROWTH_CEILING);
  });
});

describe("the negative set", () => {
  it.each([
    ["a UUID", "id = 3f2b8c1e-9a4d-4e6f-b2c7-1d0e5a9b8c7f"],
    ["a git SHA", "commit 90ff6d1774a3c2b9e8f0d1c2b3a4e5f6a7b8c9d0"],
    ["a sha256 hex digest", `sha256 ${"9f86d081884c7d65".repeat(4)}`],
    [
      "a lockfile integrity hash",
      "integrity sha512-z4PhNX7vuL3xVChQ1m2AB9Yg5AULVxXcg/SpIdNs6c5H0NE8XYXysP+DGNKHfuwvY7kxvUdBeoGlODJ6+SfaPg==",
    ],
    [
      "a base64 blob",
      `data:image/png;base64,${"iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB".repeat(3)}`,
    ],
    ["sklearn prose", "uses sk-learn and task-runner"],
    ["a short AKIA word", "AKIA is the prefix"],
    ["a lone eyJ word", "eyJ is base64 for a brace"],
    ["a non-JSON dotted triple", "eyJnotjson.eyJalsonot.sig"],
    ["a URL without a password", "https://user@github.com/o/r"],
  ])("keeps %s untouched", (_label, text) => {
    expect(redactProseSecrets(text).text).toBe(text);
    expect(redactDiffSecrets(`+${text}`).text).toBe(`+${text}`);
  });
});

describe("countSecretKinds", () => {
  it("counts hits by kind and leaves out kinds with none", () => {
    const hits = [
      { kind: SecretKinds.JWT, line: 0 },
      { kind: SecretKinds.JWT, line: 4 },
      { kind: SecretKinds.GITHUB_TOKEN, line: 2 },
    ];

    expect(countSecretKinds(hits)).toEqual({
      [SecretKinds.JWT]: 2,
      [SecretKinds.GITHUB_TOKEN]: 1,
    });
  });
});

describe("countPullRequestSecrets", () => {
  const meta: FetchedPr["meta"] = {
    title: "t",
    body: "d",
    url: "https://github.com/o/r/pull/1",
    sha: "deadbeef00000000",
    baseSha: "base0000000000000",
    commitCount: 1,
    files: [],
  };

  it("counts the diff, the prose and the linked text together", () => {
    const pr: FetchedPr = {
      locator: { owner: "o", repo: "r", number: 1 },
      meta: {
        ...meta,
        title: `t ${FAKE_SECRETS[SecretKinds.JWT]}`,
        body: `d ${FAKE_SECRETS[SecretKinds.JWT]}`,
      },
      diff: makeFakePemBlock("+").join("\n"),
      links: [
        {
          id: "ctx-1",
          providerId: "url",
          source: "https://docs.example/a",
          text: FAKE_SECRETS[SecretKinds.STRIPE_KEY],
        },
      ],
    };

    expect(countPullRequestSecrets(pr)).toEqual({
      [SecretKinds.PRIVATE_KEY]: FAKE_PEM_BODY.length,
      [SecretKinds.JWT]: 2,
      [SecretKinds.STRIPE_KEY]: 1,
    });
  });

  it("counts a secret in the primary ticket header", () => {
    const pr: FetchedPr = {
      locator: { owner: "o", repo: "r", number: 1 },
      meta,
      diff: "",
      links: [],
      primaryTicket: {
        status: "read",
        snippet: {
          providerId: "url",
          source: "https://github.com/o/r/issues/7",
          text: "clean body",
          tracker: "github",
          key: "",
          title: "t",
          header: `t ${FAKE_SECRETS[SecretKinds.GITHUB_TOKEN]} · open`,
          foundIn: "description",
        },
      },
    };

    expect(countPullRequestSecrets(pr)).toEqual({
      [SecretKinds.GITHUB_TOKEN]: 1,
    });
  });
});

describe("pattern cost", () => {
  it.each([
    ["one long word", (chars: number) => "a".repeat(chars)],
    [
      "repeated prefixes",
      (chars: number) => "ghp_sk-ant-xoxb-AKIAeyJ.".repeat(chars / 24),
    ],
    [
      "scheme runs without an at sign",
      (chars: number) => "a://b:".repeat(chars / 6),
    ],
    [
      "key fences without an end",
      (chars: number) => `${FAKE_PEM_BEGIN} `.repeat(chars / 32),
    ],
    [
      "prefixes after one hidden char",
      (chars: number) => `\u200B${"sk-".repeat(chars / 3)}`,
    ],
    [
      "a hidden char before every prefix",
      (chars: number) => "\u200BeyJ".repeat(chars / 4),
    ],
    [
      "hidden chars inside a run",
      (chars: number) => "\u200Bsk-a".repeat(chars / 5),
    ],
    [
      "secret names with no value",
      (chars: number) => "token_".repeat(chars / 6),
    ],
    [
      "bare assignments ending in a call",
      (chars: number) => `${"TOKEN=".repeat(chars / 6)}(`,
    ],
    [
      "keyed literals amid URL passwords",
      (chars: number) => 'a://b:c@d password="a1b2c3d4" '.repeat(chars / 31),
    ],
    [
      "bracketed types that never assign",
      (chars: number) => "token: Map<a, b> | Map<a, b> ".repeat(chars / 29),
    ],
    [
      "nested type lists that never close",
      (chars: number) => `token:a<${"b<c>|".repeat(chars / 5)}`,
    ],
    [
      "unions in brackets that never close",
      (chars: number) => `token:a<${">|a<".repeat(chars / 4)}`,
    ],
    [
      "secret names before type-like words",
      (chars: number) => "token string of words ".repeat(chars / 22),
    ],
    [
      "one indented name of repeats",
      (chars: number) =>
        `${" ".repeat(chars / 2)}${"token_".repeat(chars / 12)}`,
    ],
    [
      "dotted secret words in one name",
      (chars: number) => "token.".repeat(chars / 6),
    ],
    [
      "quoted secret words by attributes",
      (chars: number) => 'a="password" b="x1" '.repeat(chars / 20),
    ],
    [
      "name-shaped values under a token",
      (chars: number) => 'token="a-b-c-d-e-f-g-1" '.repeat(chars / 24),
    ],
    [
      "quoted assignments that never close",
      (chars: number) => 'password="a1 '.repeat(chars / 13),
    ],
  ])("scans a long run of %s in linear time", (_label, makeText) => {
    const ratio = measureGrowthRatio((scale) => {
      const text = makeText(BASE_SCAN_CHARS * scale);
      return () => redactProseSecrets(text);
    });

    expect(ratio).toBeLessThan(LINEAR_GROWTH_CEILING);
  });
});
