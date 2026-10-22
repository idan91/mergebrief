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

    expect(secrets).toEqual([
      { envVar: "NOTION_CREDENTIAL", value: CUSTOM_CREDENTIAL },
    ]);
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

    expect(values).toEqual([QUOTED, 'ordinary-\\"private\\"-value']);
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
