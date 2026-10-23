import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type * as AnthropicModule from "@anthropic-ai/sdk";
import type * as OpenAiModule from "openai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createOpenAiCore } from "../src/adapters/openai";
import { createOpenRouterCore } from "../src/adapters/openrouter";
import { createGenerator, Providers } from "../src/config/registry";
import { stubAmbientOpenAiEnv, stubCapturingFetch } from "./helpers";

/**
 * The constructed SDK client shows what each adapter resolved: the admin key
 * never rides the endpoints the adapters call, and the anthropic entry has no
 * boot request to observe its host on.
 */

interface ResolvedClientFields {
  baseURL: string;
  adminAPIKey: string | null;
  organization: string | null;
  project: string | null;
}

const constructedClients = vi.hoisted((): ResolvedClientFields[] => []);

interface ResolvedAnthropicFields {
  baseURL: string;
  authToken: string | null;
}

const constructedAnthropicClients = vi.hoisted(
  (): ResolvedAnthropicFields[] => [],
);

vi.mock("@anthropic-ai/sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof AnthropicModule>();
  class RecordingAnthropic extends actual.Anthropic {
    constructor(options?: AnthropicModule.ClientOptions) {
      super(options);
      constructedAnthropicClients.push(this);
    }
  }
  return {
    ...actual,
    default: RecordingAnthropic,
    Anthropic: RecordingAnthropic,
  };
});

vi.mock("openai", async (importOriginal) => {
  const actual = await importOriginal<typeof OpenAiModule>();
  class RecordingOpenAI extends actual.OpenAI {
    constructor(options?: OpenAiModule.ClientOptions) {
      super(options);
      constructedClients.push(this);
    }
  }
  return { ...actual, default: RecordingOpenAI, OpenAI: RecordingOpenAI };
});

const tempDirs: string[] = [];
function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function stubRejectingFetch(): typeof fetch {
  return stubCapturingFetch(() => new Response("{}", { status: 401 })).fetch;
}

beforeEach(() => {
  constructedClients.splice(0);
  constructedAnthropicClients.splice(0);
  stubAmbientOpenAiEnv();
  vi.stubEnv("ANTHROPIC_BASE_URL", "https://redirect.invalid");
  vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "canary-auth-token");
});

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const PINNED_ACCOUNT = { adminAPIKey: null, organization: null, project: null };

describe("OpenAI SDK clients ignore ambient env", () => {
  it("builds the openai client with no admin key, org or project", async () => {
    await createOpenAiCore({
      apiKey: "test-key",
      model: "gpt-test-1",
      failureDir: makeTempDir("ambient-openai-"),
      provider: "openai",
      fetch: stubRejectingFetch(),
    });

    expect(constructedClients).toHaveLength(1);
    expect(constructedClients[0]).toMatchObject({
      ...PINNED_ACCOUNT,
      baseURL: "https://api.openai.com/v1",
    });
  });

  it("builds the openrouter client with no admin key, org or project", async () => {
    await createOpenRouterCore({
      apiKey: "test-key",
      model: "test-lab/test-model-1",
      failureDir: makeTempDir("ambient-openrouter-"),
      fetch: stubRejectingFetch(),
    });

    expect(constructedClients).toHaveLength(1);
    expect(constructedClients[0]).toMatchObject({
      ...PINNED_ACCOUNT,
      baseURL: "https://openrouter.ai/api/v1",
    });
  });
});

describe("anthropic registry entry host", () => {
  const deps = {
    env: { ANTHROPIC_API_KEY: "test-key" },
    failureDir: "out",
  };

  it("builds the client on the Instance config's baseUrl", async () => {
    const result = await createGenerator(
      { provider: Providers.ANTHROPIC, baseUrl: "https://gateway.example" },
      deps,
    );

    expect(result.ok).toBe(true);
    expect(constructedAnthropicClients).toEqual([
      expect.objectContaining({
        baseURL: "https://gateway.example",
        authToken: null,
      }),
    ]);
  });

  it("builds the client on the canonical host when baseUrl is unset", async () => {
    const result = await createGenerator(
      { provider: Providers.ANTHROPIC },
      deps,
    );

    expect(result.ok).toBe(true);
    expect(constructedAnthropicClients).toEqual([
      expect.objectContaining({
        baseURL: "https://api.anthropic.com",
        authToken: null,
      }),
    ]);
  });
});
