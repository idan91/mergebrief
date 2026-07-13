import { describe, expect, it } from "vitest";
import {
  createGenerator,
  defaultGeneratorConfig,
  GeneratorConfigSchema,
  Providers,
} from "../src/registry";

/**
 * The registry + construction seam (BRIEF-11 decision 1): static compiled-in
 * registry, config discriminated union derived from it, async
 * createGenerator returning Result — composition roots convert to loud boot
 * failures, the library never throws for expected misconfiguration.
 */

const env = { ANTHROPIC_API_KEY: "sk-test-not-a-real-key" };
const deps = { env, failureDir: "out" };

describe("createGenerator", () => {
  it("builds the zero-config default: anthropic + ANTHROPIC_API_KEY + Opus 4.8", async () => {
    const result = await createGenerator(defaultGeneratorConfig, deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.provenance("medium")).toEqual({
      provider: "anthropic",
      model: "claude-opus-4-8",
      effort: "medium",
    });
  });

  it("rejects an unknown provider naming the valid tokens", async () => {
    const result = await createGenerator(
      { provider: "gpt-basement" },
      deps,
    );
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

  it("honors a configured model in provenance", async () => {
    const result = await createGenerator(
      { provider: "anthropic", model: "claude-sonnet-5" },
      deps,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.provenance("low").model).toBe("claude-sonnet-5");
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

describe("GeneratorConfigSchema (registry-derived)", () => {
  it("parses every registry provider's minimal block", () => {
    expect(
      GeneratorConfigSchema.safeParse({ provider: Providers.ANTHROPIC }).success,
    ).toBe(true);
  });

  it("is the same vocabulary the unknown-provider error names", () => {
    const parsed = GeneratorConfigSchema.safeParse({ provider: "nope" });
    expect(parsed.success).toBe(false);
  });
});
