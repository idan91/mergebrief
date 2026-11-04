import type { GenerateRequest, Generator } from "generators";
import { describe, expect, it } from "vitest";
import { z } from "zod/v4";
import {
  collectOutputSecrets,
  findOutputSecret,
  guardGeneratorOutput,
  listCredentialVars,
  OutputSecretError,
} from "../src/task/generate/logic/output-secret";

const DB_PASSWORD = "s3cr3t-db-password-value";
const DATABASE_URL = `postgres://mergebrief:${DB_PASSWORD}@db.internal:5432/mergebrief`;
const PEM_LINE =
  "MIIEowIBAAKCAQEAu1SU1LfVLPHCozMxH2Mo4lgOEePzNm0tRgeLezV6ffAt0gun";
const PRIVATE_KEY = `-----BEGIN RSA PRIVATE KEY-----\n${PEM_LINE}\n-----END RSA PRIVATE KEY-----\n`;

const SECRETS = collectOutputSecrets({
  DATABASE_URL,
  GITHUB_APP_PRIVATE_KEY: PRIVATE_KEY,
  MY_LINEAR_TOKEN: "lin_api_0123456789abcdef",
  SHORT_TOKEN: "abc",
  PUBLIC_BASE_URL: "https://mergebrief.example.com",
  HOME: "/Users/operator/home-directory",
});

const OutputSchema = z.object({
  summary: z.string(),
  groups: z.array(z.object({ title: z.string() })),
});

function stubFixedGenerator(output: z.infer<typeof OutputSchema>): Generator {
  return {
    async generate<S extends z.ZodType>(
      req: GenerateRequest<S>,
    ): Promise<z.infer<S>> {
      return req.schema.parse(output);
    },
    origin: (effort) => ({ provider: "stub", model: "stub-model", effort }),
  };
}

function makeRequest(): GenerateRequest<typeof OutputSchema> {
  return {
    schema: OutputSchema,
    system: "s",
    user: "u",
    effort: "medium",
    label: "brief",
  };
}

describe("collectOutputSecrets", () => {
  it("takes named secrets, the database password and PEM lines", () => {
    const values = SECRETS.map((secret) => secret.value);

    expect(values).toContain(DATABASE_URL);
    expect(values).toContain(DB_PASSWORD);
    expect(values).toContain(PEM_LINE);
    expect(values).toContain("lin_api_0123456789abcdef");
  });

  it("keeps a malformed URL escape instead of throwing", () => {
    const secrets = collectOutputSecrets({
      DATABASE_URL: "postgres://app:bad%E0%A4escape-pw@db/app",
    });

    expect(secrets.length).toBeGreaterThan(0);
  });

  it("skips short values and vars that hold no secret", () => {
    const names = SECRETS.map((secret) => secret.envVar);

    expect(names).not.toContain("SHORT_TOKEN");
    expect(names).not.toContain("PUBLIC_BASE_URL");
    expect(names).not.toContain("HOME");
  });
});

describe("findOutputSecret", () => {
  it("names the field and the env var a secret value sits in", () => {
    const output = {
      summary: "fine",
      groups: [{ title: `password is ${DB_PASSWORD}` }],
    };

    expect(findOutputSecret(output, SECRETS)).toEqual({
      fieldPath: "groups[0].title",
      envVar: "DATABASE_URL",
    });
  });

  it("finds nothing in output that carries no secret", () => {
    const output = { summary: "fine", groups: [{ title: "ok" }] };

    expect(findOutputSecret(output, SECRETS)).toBeUndefined();
  });
});

describe("findOutputSecret over encoded forms", () => {
  it.each([
    ["base64", "bGluX2FwaV8wMTIzNDU2Nzg5YWJjZGVm"],
    ["lowercase hex", "6c696e5f6170695f30313233343536373839616263646566"],
    ["uppercase hex", "6C696E5F6170695F30313233343536373839616263646566"],
    ["base64 one byte into a payload", "PWxpbl9hcGlfMDEyMzQ1Njc4OWFiY2RlZg=="],
    ["base64 two bytes into a payload", "dD1saW5fYXBpXzAxMjM0NTY3ODlhYmNkZWY="],
  ])("finds a secret written as %s", (_label, encoded) => {
    const output = { summary: `the value is ${encoded} here` };

    expect(findOutputSecret(output, SECRETS)).toEqual({
      fieldPath: "summary",
      envVar: "MY_LINEAR_TOKEN",
    });
  });

  it("finds a secret written as URL-safe base64", () => {
    const secrets = collectOutputSecrets({ URL_TOKEN: "~~~>>>secret???value" });

    expect(
      findOutputSecret({ summary: "fn5-Pj4-c2VjcmV0Pz8_dmFsdWU" }, secrets),
    ).toEqual({ fieldPath: "summary", envVar: "URL_TOKEN" });
  });

  it("never encodes a value under the minimum length", () => {
    const secrets = collectOutputSecrets({ SHORT_TOKEN: "abc123" });

    expect(findOutputSecret({ hex: "616263313233" }, secrets)).toBeUndefined();
    expect(findOutputSecret({ base64: "YWJjMTIz" }, secrets)).toBeUndefined();
  });
});

describe("findOutputSecret over spaced forms", () => {
  it.each([
    ["one char at a time", "l i n _ a p i _ 0 1 2 3 4 5 6 7 8 9 a b c d e f"],
    ["four char groups", "lin_ api_ 0123 4567 89ab cdef"],
    ["a quoted run", 'token="l i n _ a p i _ 0 1 2 3 4 5 6 7 8 9 a b c d e f"'],
    [
      "spaced hex",
      "6c 69 6e 5f 61 70 69 5f 30 31 32 33 34 35 36 37 38 39 61 62 63 64 65 66",
    ],
    ["line-wrapped base64", "bGluX2FwaV8wMTIz\nNDU2Nzg5YWJjZGVm"],
    ["five char groups", "lin_a pi_01 23456 789ab cdef"],
    ["uneven groups", "lin_api _0123456 789 abcdef"],
  ])("finds a secret written as %s", (_label, spaced) => {
    expect(findOutputSecret({ summary: spaced }, SECRETS)).toEqual({
      fieldPath: "summary",
      envVar: "MY_LINEAR_TOKEN",
    });
  });

  it("finds a spaced secret holding delimiter characters", () => {
    const secrets = collectOutputSecrets({
      PADDED_KEY: "q3T0:n8mL,wq0z5d1X2Y=",
    });
    const spaced = "q 3 T 0 : n 8 m L , w q 0 z 5 d 1 X 2 Y =";

    expect(findOutputSecret({ summary: spaced }, secrets)).toEqual({
      fieldPath: "summary",
      envVar: "PADDED_KEY",
    });
  });

  it("finds a spaced secret that itself holds spaces", () => {
    const secrets = collectOutputSecrets({ PASS_SECRET: "tr0ub4 dor and 3" });

    expect(
      findOutputSecret({ summary: "t r 0 u b 4 d o r a n d 3" }, secrets),
    ).toEqual({ fieldPath: "summary", envVar: "PASS_SECRET" });
  });

  it("finds a letters-only secret spaced one char at a time", () => {
    const secrets = collectOutputSecrets({ RANDOM_TOKEN: "QwErTyUiOpAsDf" });

    expect(
      findOutputSecret({ summary: "Q w E r T y U i O p A s D f" }, secrets),
    ).toEqual({ fieldPath: "summary", envVar: "RANDOM_TOKEN" });
  });

  it("reads a run of ordinary words as prose, not a spaced secret", () => {
    const secrets = collectOutputSecrets({ PLAIN_SECRET: "supersecretkey" });

    expect(
      findOutputSecret({ summary: "rotates a super secret key" }, secrets),
    ).toBeUndefined();
  });

  it("never spaces out a low-entropy letters value", () => {
    const secrets = collectOutputSecrets({ PLAIN_TOKEN: "aaaaaaaaaaaa" });

    expect(
      findOutputSecret({ table: "a a a a a a a a a a a a" }, secrets),
    ).toBeUndefined();
  });

  it("matches a low-entropy value only as written", () => {
    const secrets = collectOutputSecrets({ ZERO_TOKEN: "000000000000" });

    const zeros = { spaced: "0 0 0 0 0 0 0 0 0 0 0 0" };
    const encoded = { hex: "303030303030303030303030" };
    expect(findOutputSecret(zeros, secrets)).toBeUndefined();
    expect(findOutputSecret(encoded, secrets)).toBeUndefined();
    expect(findOutputSecret({ raw: "000000000000" }, secrets)).toEqual({
      fieldPath: "raw",
      envVar: "ZERO_TOKEN",
    });
  });
});

describe("collectOutputSecrets over OTLP headers", () => {
  const BEARER = "bearer-token-0123456789abcdef";
  const headerSecrets = collectOutputSecrets({
    OTEL_EXPORTER_OTLP_TRACES_HEADERS: `Authorization=Bearer%20${BEARER},x-team=team-credential-42,x-env=prod`,
    OTEL_EXPORTER_OTLP_HEADERS:
      "Authorization=Basic aW5zdGFuY2UtNDI6Z2xjX3Rva2VudmFsdWUwMTIzNDU2Nzg5",
  });

  it.each([
    ["the bearer token alone", BEARER],
    ["the bearer value as base64", "YmVhcmVyLXRva2VuLTAxMjM0NTY3ODlhYmNkZWY"],
    ["the header value with its scheme", `Bearer ${BEARER}`],
    ["another header's value", "team-credential-42"],
  ])("takes %s from the traces headers", (_label, text) => {
    expect(findOutputSecret({ summary: text }, headerSecrets)).toEqual({
      fieldPath: "summary",
      envVar: "OTEL_EXPORTER_OTLP_TRACES_HEADERS",
    });
  });

  it.each([
    [
      "the encoded credential",
      "aW5zdGFuY2UtNDI6Z2xjX3Rva2VudmFsdWUwMTIzNDU2Nzg5",
    ],
    ["the decoded password", "glc_tokenvalue0123456789"],
  ])("takes %s from a Basic header", (_label, text) => {
    expect(findOutputSecret({ summary: text }, headerSecrets)).toEqual({
      fieldPath: "summary",
      envVar: "OTEL_EXPORTER_OTLP_HEADERS",
    });
  });

  it.each([
    ["the value as written", "Bearer%20abc%2Fdef%2B0123456789"],
    ["the part past the scheme as written", "abc%2Fdef%2B0123456789"],
    ["the decoded part past the scheme", "abc/def+0123456789"],
  ])("takes %s from a percent-encoded header", (_label, text) => {
    const secrets = collectOutputSecrets({
      OTEL_EXPORTER_OTLP_HEADERS:
        "Authorization=Bearer%20abc%2Fdef%2B0123456789,x-env=prod",
    });

    expect(findOutputSecret({ summary: text }, secrets)).toEqual({
      fieldPath: "summary",
      envVar: "OTEL_EXPORTER_OTLP_HEADERS",
    });
  });

  it.each([
    ["a doubled space", "Authorization=Bearer%20%20abc%2Fdef0123456789"],
    ["an encoded tab", "Authorization=Bearer%09abc%2Fdef0123456789"],
  ])("takes the raw part past the scheme after %s", (_label, headers) => {
    const secrets = collectOutputSecrets({
      OTEL_EXPORTER_OTLP_HEADERS: headers,
    });

    expect(
      findOutputSecret({ summary: "abc%2Fdef0123456789" }, secrets),
    ).toEqual({ fieldPath: "summary", envVar: "OTEL_EXPORTER_OTLP_HEADERS" });
  });

  it("treats a signal-specific headers var as secret", () => {
    const secrets = collectOutputSecrets({
      OTEL_EXPORTER_OTLP_METRICS_HEADERS: "api-key=metrics-credential-1234",
    });

    expect(
      findOutputSecret({ summary: "metrics-credential-1234" }, secrets),
    ).toEqual({
      fieldPath: "summary",
      envVar: "OTEL_EXPORTER_OTLP_METRICS_HEADERS",
    });
  });

  it.each([
    ["x-honeycomb-dataset", "checkout-service"],
    ["Content-Type", "application/json"],
    ["X-Scope-OrgID", "mergebrief-prod"],
  ])("leaves the plain label in %s out", (name, value) => {
    const secrets = collectOutputSecrets({
      OTEL_EXPORTER_OTLP_HEADERS: `${name}=${value},x-env=prod`,
    });

    expect(findOutputSecret({ summary: `the ${value} path` }, secrets)).toBe(
      undefined,
    );
  });

  it("keeps a plain word value under a credential header name", () => {
    const secrets = collectOutputSecrets({
      OTEL_EXPORTER_OTLP_HEADERS: "x-api-key=correct-horse-battery-staple",
    });

    expect(
      findOutputSecret({ summary: "correct-horse-battery-staple" }, secrets),
    ).toEqual({
      fieldPath: "summary",
      envVar: "OTEL_EXPORTER_OTLP_HEADERS",
    });
  });

  it("leaves header names and short values out", () => {
    const prose = {
      summary: "sets the Authorization header, Bearer, x-env=prod",
    };

    expect(findOutputSecret(prose, headerSecrets)).toBeUndefined();
  });

  it("keeps a malformed header escape instead of throwing", () => {
    const secrets = collectOutputSecrets({
      OTEL_EXPORTER_OTLP_HEADERS: "api-key=bad%E0%A4escape-value",
    });

    expect(
      findOutputSecret({ summary: "bad%E0%A4escape-value" }, secrets),
    ).toEqual({ fieldPath: "summary", envVar: "OTEL_EXPORTER_OTLP_HEADERS" });
  });
});

describe("guardGeneratorOutput", () => {
  it("passes clean output through unchanged", async () => {
    const output = { summary: "fine", groups: [] };
    const guarded = guardGeneratorOutput(stubFixedGenerator(output), SECRETS);

    await expect(guarded.generate(makeRequest())).resolves.toEqual(output);
  });

  it("refuses output carrying a secret without echoing the value", async () => {
    const output = { summary: `key ${PEM_LINE}`, groups: [] };
    const guarded = guardGeneratorOutput(stubFixedGenerator(output), SECRETS);

    const caught = await guarded
      .generate(makeRequest())
      .catch((error: unknown) => error);

    expect(caught).toBeInstanceOf(OutputSecretError);
    const message = caught instanceof Error ? caught.message : "";
    expect(message).toContain("GITHUB_APP_PRIVATE_KEY");
    expect(message).toContain("summary");
    expect(message).not.toContain(PEM_LINE);
  });

  it("refuses an encoded secret naming only the var and field", async () => {
    const encoded = "bGluX2FwaV8wMTIzNDU2Nzg5YWJjZGVm";
    const output = { summary: `b64 ${encoded}`, groups: [] };
    const guarded = guardGeneratorOutput(stubFixedGenerator(output), SECRETS);

    const caught = await guarded
      .generate(makeRequest())
      .catch((error: unknown) => error);

    expect(caught).toBeInstanceOf(OutputSecretError);
    expect(caught instanceof Error ? caught.message : "").toBe(
      "generation output contained the value of MY_LINEAR_TOKEN at summary",
    );
  });

  it("keeps the wrapped generator's origin", () => {
    const guarded = guardGeneratorOutput(
      stubFixedGenerator({ summary: "", groups: [] }),
      SECRETS,
    );

    expect(guarded.origin("high")).toEqual({
      provider: "stub",
      model: "stub-model",
      effort: "high",
    });
  });
});

const CUSTOM_CREDENTIAL = "notion-credential-0123456789";

function stubSideChannelGenerator(
  write: (req: GenerateRequest<typeof OutputSchema>) => void,
): Generator {
  return {
    async generate<S extends z.ZodType>(
      req: GenerateRequest<S>,
    ): Promise<z.infer<S>> {
      write(req as unknown as GenerateRequest<typeof OutputSchema>);
      return req.schema.parse({ summary: "clean", groups: [] });
    },
    origin: (effort) => ({ provider: "stub", model: "stub-model", effort }),
  };
}

describe("collectOutputSecrets with configured credential names", () => {
  it("takes a var the config names even without a secret word", () => {
    const secrets = collectOutputSecrets(
      { NOTION_CREDENTIAL: CUSTOM_CREDENTIAL },
      ["NOTION_CREDENTIAL"],
    );

    expect(secrets).toContainEqual({
      envVar: "NOTION_CREDENTIAL",
      value: CUSTOM_CREDENTIAL,
    });
  });

  it("lists the generator key and each context-source token var", () => {
    const vars = listCredentialVars(
      { provider: "anthropic", model: "m", apiKeyEnv: "MY_ANTHROPIC" },
      [{ type: "notion", tokenEnv: "NOTION_CREDENTIAL" }],
    );

    expect(vars.toSorted()).toEqual(["MY_ANTHROPIC", "NOTION_CREDENTIAL"]);
  });
});

describe("guardGeneratorOutput side channels", () => {
  it("fails a run whose salvage warning carried a secret, masked", async () => {
    const warnings: string[] = [];
    const guarded = guardGeneratorOutput(
      stubSideChannelGenerator((req) =>
        req.onWarning?.({ kind: "salvaged", message: `dropped ${PEM_LINE}` }),
      ),
      SECRETS,
    );

    const caught = await guarded
      .generate({
        ...makeRequest(),
        onWarning: (warning) => warnings.push(warning.message),
      })
      .catch((error: unknown) => error);

    expect(caught).toBeInstanceOf(OutputSecretError);
    expect(warnings).toEqual(["dropped [GITHUB_APP_PRIVATE_KEY]"]);
  });

  it("masks a secret in a log line and fails the run", async () => {
    const lines: string[] = [];
    const guarded = guardGeneratorOutput(
      stubSideChannelGenerator((req) => req.log?.(`raw: ${DB_PASSWORD}`)),
      SECRETS,
    );

    const caught = await guarded
      .generate({ ...makeRequest(), log: (line) => lines.push(line) })
      .catch((error: unknown) => error);

    expect(caught).toBeInstanceOf(OutputSecretError);
    expect(lines.join("\n")).not.toContain(DB_PASSWORD);
  });

  it.each([
    ["base64", "bGluX2FwaV8wMTIzNDU2Nzg5YWJjZGVm", "raw: [MY_LINEAR_TOKEN]"],
    [
      "spaced",
      "l i n _ a p i _ 0 1 2 3 4 5 6 7 8 9 a b c d e f",
      "raw:[MY_LINEAR_TOKEN]",
    ],
  ])("masks a %s secret in a log line", async (_label, form, masked) => {
    const lines: string[] = [];
    const guarded = guardGeneratorOutput(
      stubSideChannelGenerator((req) => req.log?.(`raw: ${form}`)),
      SECRETS,
    );

    const caught = await guarded
      .generate({ ...makeRequest(), log: (line) => lines.push(line) })
      .catch((error: unknown) => error);

    expect(caught).toBeInstanceOf(OutputSecretError);
    expect(lines).toEqual([masked]);
  });

  it("leaves a clean log line's spacing alone", async () => {
    const lines: string[] = [];
    const guarded = guardGeneratorOutput(
      stubSideChannelGenerator((req) => req.log?.("a b c  d\nnext line")),
      SECRETS,
    );

    await guarded.generate({
      ...makeRequest(),
      log: (line) => lines.push(line),
    });

    expect(lines).toEqual(["a b c  d\nnext line"]);
  });

  it("masks a dumped attempt's secret and fails the run", async () => {
    let dumped = "";
    const guarded = guardGeneratorOutput(
      stubSideChannelGenerator((req) => {
        dumped = req.redact?.(`raw ${DB_PASSWORD}`) ?? "";
      }),
      SECRETS,
    );

    const caught = await guarded
      .generate(makeRequest())
      .catch((error: unknown) => error);

    expect(caught).toBeInstanceOf(OutputSecretError);
    expect(dumped).toBe("raw [DATABASE_URL]");
  });

  it("turns a failure whose message carries a secret into output-secret", async () => {
    const guarded = guardGeneratorOutput(
      {
        generate: () => Promise.reject(new Error(`schema: got ${PEM_LINE}`)),
        origin: (effort) => ({ provider: "stub", model: "m", effort }),
      },
      SECRETS,
    );

    const caught = await guarded
      .generate(makeRequest())
      .catch((error: unknown) => error);

    expect(caught).toBeInstanceOf(OutputSecretError);
    expect(caught instanceof Error ? caught.message : "").not.toContain(
      PEM_LINE,
    );
  });

  it("passes an abort through untouched", async () => {
    const controller = new AbortController();
    controller.abort();
    const abort = new Error("aborted");
    const guarded = guardGeneratorOutput(
      {
        generate: () => Promise.reject(abort),
        origin: (effort) => ({ provider: "stub", model: "m", effort }),
      },
      SECRETS,
    );

    const caught = await guarded
      .generate({ ...makeRequest(), signal: controller.signal })
      .catch((error: unknown) => error);

    expect(caught).toBe(abort);
  });
});

describe("guardGeneratorOutput attempt screening", () => {
  const QUOTED = 'ordinary-"private"-value';
  const quotedSecrets = collectOutputSecrets({ QUOTED_TOKEN: QUOTED });

  it("collects a value's JSON-escaped form beside the value", () => {
    const values = quotedSecrets.map((secret) => secret.value);

    expect(values).toContain(QUOTED);
    expect(values).toContain('ordinary-\\"private\\"-value');
  });

  it.each([
    [
      "the raw text",
      { raw: JSON.stringify({ tag: QUOTED }), parsed: undefined },
    ],
    ["the parsed value", { raw: "", parsed: { tag: QUOTED } }],
  ])("refuses an attempt carrying a secret in %s", async (_label, attempt) => {
    const guarded = guardGeneratorOutput(
      stubSideChannelGenerator((req) => req.screenAttempt?.(attempt)),
      quotedSecrets,
    );

    const caught = await guarded
      .generate(makeRequest())
      .catch((error: unknown) => error);

    expect(caught).toBeInstanceOf(OutputSecretError);
  });
});
