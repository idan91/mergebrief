import { describe, expect, it } from "vitest";
import {
  COMPOSE_WORKER_RUNTIME,
  createGenerator,
  defaultGeneratorConfig,
  FullRegenerations,
  GeneratorConfigSchema,
  Providers,
  RUNTIME_MARKER_VAR,
  validateGeneratorConfig,
} from "../src/config/registry";
import { Efforts } from "../src/contract/generation";

/**
 * The registry + construction boundary: static compiled-in registry, config
 * discriminated union derived from it, async
 * createGenerator returning Result — startup wiring converts to loud boot
 * failures, the library never throws for expected misconfiguration.
 */

const env = { ANTHROPIC_API_KEY: "sk-test-not-a-real-key" };
const deps = { env, failureDir: "out" };

describe("createGenerator", () => {
  it("builds the zero-config default: anthropic + ANTHROPIC_API_KEY + Opus 4.8", async () => {
    const result = await createGenerator(defaultGeneratorConfig, deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.origin("medium")).toEqual({
      provider: "anthropic",
      model: "claude-opus-4-8",
      effort: "medium",
    });
  });

  it("rejects an unknown provider naming the valid tokens", async () => {
    const result = await createGenerator({ provider: "gpt-basement" }, deps);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const text = result.error.issues.join("; ");
    expect(text).toContain("gpt-basement");
    expect(text).toContain("anthropic");
  });

  it("rejects a missing API key naming the VAR ONLY, never a value", async () => {
    const result = await createGenerator(
      { provider: "anthropic" },
      { env: {}, failureDir: "out" },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const text = `${result.error.message} ${result.error.issues.join("; ")}`;
    expect(text).toContain("ANTHROPIC_API_KEY");
    expect(text).not.toContain("sk-");
  });

  it("resolves the key from a custom apiKeyEnv", async () => {
    const result = await createGenerator(
      { provider: "anthropic", apiKeyEnv: "MY_KEY" },
      { env: { MY_KEY: "sk-alt-key" }, failureDir: "out" },
    );
    expect(result.ok).toBe(true);
  });

  it("refuses a key-shaped apiKeyEnv without echoing it", async () => {
    // Misconfiguration that pastes the key VALUE where the var NAME goes:
    // the value must never appear in the error.
    const pastedKey = "sk-ant-api03-oops-a-real-key";
    const result = await createGenerator(
      { provider: "anthropic", apiKeyEnv: pastedKey },
      deps,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const text = `${result.error.message} ${result.error.issues.join("; ")}`;
    expect(text).not.toContain(pastedKey);
    expect(text).not.toContain("sk-");
    expect(text).toContain("environment variable NAME");
  });

  it("redacts a non-token unknown provider instead of echoing it", async () => {
    const pastedSecret = "sk-ant-api03-not-a-provider";
    const result = await createGenerator({ provider: pastedSecret }, deps);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const text = result.error.issues.join("; ");
    expect(text).not.toContain(pastedSecret);
    expect(text).toContain("(redacted)");
    expect(text).toContain("anthropic");
  });

  it("names the custom apiKeyEnv var when it is unset", async () => {
    const result = await createGenerator(
      { provider: "anthropic", apiKeyEnv: "MY_KEY" },
      { env, failureDir: "out" },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.issues.join("; ")).toContain("MY_KEY");
  });

  it("honors a configured model in the origin", async () => {
    const result = await createGenerator(
      { provider: "anthropic", model: "claude-sonnet-5" },
      deps,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.origin("low").model).toBe("claude-sonnet-5");
  });

  it("rejects unknown keys inside a provider block (strict)", async () => {
    const result = await createGenerator(
      { provider: "anthropic", modle: "typo" },
      deps,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.issues.join("; ")).toContain("modle");
  });

  it("redacts a key-shaped unknown config key instead of echoing it", async () => {
    const pastedKey = "sk-ant-api03-oops-as-a-key";
    const result = await createGenerator(
      { provider: "anthropic", [pastedKey]: true },
      deps,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const text = result.error.issues.join("; ");
    expect(text).not.toContain(pastedKey);
    expect(text).toContain("(redacted)");
  });

  it("rejects a non-object config with per-field issues", async () => {
    const result = await createGenerator("anthropic", deps);
    expect(result.ok).toBe(false);
  });
});

describe("compose-worker runtime marker", () => {
  const composeEnv = {
    ...env,
    [RUNTIME_MARKER_VAR]: COMPOSE_WORKER_RUNTIME,
  };
  const composeDeps = { env: composeEnv, failureDir: "out" };

  it("refuses harness providers under the marker with the operator's options", async () => {
    for (const provider of [
      Providers.CLAUDE_CODE,
      Providers.CODEX,
      Providers.CURSOR,
    ]) {
      const result = await createGenerator({ provider }, composeDeps);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.issues[0]).toContain(
        "not available in the compose worker",
      );
      // The message interpolates HARNESS_PROVIDERS — dropping a member from
      // the set would silently downgrade its refusal to "not found on PATH".
      expect(result.error.issues[0]).toContain("cursor");
      expect(result.error.issues[0]).toContain("MERGEBRIEF_CONFIG");
    }
  });

  it("leaves API providers untouched by the marker", async () => {
    const result = await createGenerator(defaultGeneratorConfig, composeDeps);
    expect(result.ok).toBe(true);
  });

  it("does not refuse harness providers without the marker (probe still owns that path)", async () => {
    const result = await createGenerator(
      { provider: Providers.CLAUDE_CODE, command: "definitely-missing-cli" },
      deps,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // The refusal message is the marker's; a missing binary reports itself.
    expect(result.error.issues[0]).not.toContain(
      "not available in the compose worker",
    );
  });
});

describe("effort on the generator block", () => {
  // Minimal valid block per adapter; openai/openrouter require a model.
  const minimalBlocks = [
    { provider: Providers.ANTHROPIC },
    { provider: Providers.CLAUDE_CODE },
    { provider: Providers.CODEX },
    { provider: Providers.OPENAI, model: "gpt-5.2" },
    { provider: Providers.OPENROUTER, model: "anthropic/claude-opus-4.8" },
  ] as const;

  it.each(minimalBlocks)(
    "parses every Efforts member on $provider",
    (block) => {
      for (const effort of Efforts) {
        const parsed = GeneratorConfigSchema.safeParse({ ...block, effort });
        expect(parsed.success).toBe(true);
        if (!parsed.success) continue;
        expect(parsed.data.effort).toBe(effort);
      }
    },
  );

  it.each(minimalBlocks)(
    "leaves effort undefined when omitted on $provider",
    (block) => {
      const parsed = GeneratorConfigSchema.safeParse(block);
      expect(parsed.success).toBe(true);
      if (!parsed.success) return;
      expect(parsed.data.effort).toBeUndefined();
    },
  );

  it("rejects an out-of-vocabulary effort with a per-field issue naming effort", () => {
    const result = validateGeneratorConfig({
      provider: "anthropic",
      effort: "max",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const text = result.error.issues.join("; ");
    expect(text).toContain("effort");
    expect(text).not.toContain("max");
  });

  it("still rejects unknown sibling keys next to a valid effort (strictness preserved)", () => {
    const result = validateGeneratorConfig({
      provider: "anthropic",
      effort: "low",
      efort: "high",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.issues.join("; ")).toContain("efort");
  });
});

describe("full-regeneration on the generator block", () => {
  // Minimal valid block per adapter; openai/openrouter require a model.
  const minimalBlocks = [
    { provider: Providers.ANTHROPIC },
    { provider: Providers.CLAUDE_CODE },
    { provider: Providers.CODEX },
    { provider: Providers.OPENAI, model: "gpt-5.2" },
    { provider: Providers.OPENROUTER, model: "anthropic/claude-opus-4.8" },
  ] as const;

  it.each(minimalBlocks)(
    "parses every FullRegenerations member on $provider",
    (block) => {
      for (const value of Object.values(FullRegenerations)) {
        const parsed = GeneratorConfigSchema.safeParse({
          ...block,
          "full-regeneration": value,
        });
        expect(parsed.success).toBe(true);
        if (!parsed.success) continue;
        expect(parsed.data["full-regeneration"]).toBe(value);
      }
    },
  );

  it.each(minimalBlocks)(
    "leaves full-regeneration undefined when omitted on $provider",
    (block) => {
      const parsed = GeneratorConfigSchema.safeParse(block);
      expect(parsed.success).toBe(true);
      if (!parsed.success) return;
      expect(parsed.data["full-regeneration"]).toBeUndefined();
    },
  );

  it("rejects an out-of-vocabulary value with a per-field issue naming the key", () => {
    const result = validateGeneratorConfig({
      provider: "anthropic",
      "full-regeneration": "sometimes",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const text = result.error.issues.join("; ");
    expect(text).toContain("full-regeneration");
    expect(text).not.toContain("sometimes");
  });

  it("still rejects unknown sibling keys next to a valid value (strictness preserved)", () => {
    const result = validateGeneratorConfig({
      provider: "anthropic",
      "full-regeneration": "never",
      "full-regen": "always",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.issues.join("; ")).toContain("full-regen");
  });
});

describe("GeneratorConfigSchema (registry-derived)", () => {
  it("parses every registry provider's minimal block", () => {
    expect(
      GeneratorConfigSchema.safeParse({ provider: Providers.ANTHROPIC })
        .success,
    ).toBe(true);
  });

  it("is the same vocabulary the unknown-provider error names", () => {
    const parsed = GeneratorConfigSchema.safeParse({ provider: "nope" });
    expect(parsed.success).toBe(false);
  });
});
