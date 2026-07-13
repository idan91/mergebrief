import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod/v4";
import type { Result, ValueOf } from "types";
import { AnthropicGenerator, type Generator, type Logger } from "./generator";

/**
 * The static compiled-in generator registry (BRIEF-11 decision 1, ADR 0013
 * as amended 2026-07-12): each entry = a provider token, a strict Zod
 * options schema (carrying the provider literal as discriminant), and an
 * async `create`. The config discriminated union is DERIVED from the
 * registry — one source of truth for the provider vocabulary, the config
 * schema, and unknown-provider errors. Adding an adapter = one class + one
 * options schema + one entry (+ one dispatch case, which the compiler
 * enforces via exhaustiveness).
 *
 * Construction returns `Result` — a misconfigured instance must refuse to
 * boot loudly at the composition root, never limp into jobs. `generate()`
 * keeps throwing (GeneratorError) — Result is for construction only.
 */

/** Provider vocabulary. Harness tokens exist now; entries land in PRs 4-6. */
export const Providers = {
  ANTHROPIC: "anthropic",
  CLAUDE_CODE: "claude-code",
  CODEX: "codex",
  OPENAI: "openai",
  OPENROUTER: "openrouter",
} as const;
export type Provider = ValueOf<typeof Providers>;

/** What a composition root injects; roots stay the only process.env readers. */
export interface CreateGeneratorDeps {
  env: Record<string, string | undefined>;
  /** Where failed-generation raw outputs are dumped (ephemeral). */
  failureDir: string;
  log?: Logger;
}

/**
 * Expected construction failure (bad config, missing key var, failed boot
 * probe). Mirrors the worker-config ConfigError pattern: per-field issues,
 * VALUES OMITTED — key material never appears, env vars by NAME only.
 */
export interface ConfigError {
  readonly code: "invalid";
  readonly message: string;
  readonly issues: readonly string[];
}

function configError(issues: readonly string[]): Result<never, ConfigError> {
  return {
    ok: false,
    error: {
      code: "invalid",
      message: "invalid generator configuration",
      issues,
    },
  };
}

interface RegistryEntry<O extends z.ZodType> {
  options: O;
  create(
    options: z.infer<O>,
    deps: CreateGeneratorDeps,
  ): Promise<Result<Generator, ConfigError>>;
}

/** Generic entry helper: ties each schema to its create without widening. */
function defineEntry<O extends z.ZodType>(entry: RegistryEntry<O>): RegistryEntry<O> {
  return entry;
}

/**
 * POSIX-ish env-var identifier. Anything else is refused with a FIXED
 * message: a misconfiguration that pastes the key VALUE into `apiKeyEnv`
 * must never see that value echoed into errors or logs.
 */
const ENV_VAR_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Reads `apiKeyEnv` (or the adapter default) from the injected env by NAME. */
function resolveApiKey(
  env: CreateGeneratorDeps["env"],
  keyEnv: string,
): Result<string, ConfigError> {
  if (!ENV_VAR_NAME.test(keyEnv)) {
    return configError([
      "apiKeyEnv: must be an environment variable NAME (letters, digits, underscores) — never a key value",
    ]);
  }
  const key = env[keyEnv];
  if (typeof key !== "string" || key.length === 0) {
    return configError([`${keyEnv}: provider API key env var is not set`]);
  }
  return { ok: true, value: key };
}

const DEFAULT_ANTHROPIC_KEY_ENV = "ANTHROPIC_API_KEY";

const anthropicOptions = z
  .object({
    provider: z.literal(Providers.ANTHROPIC),
    /**
     * Model id; default Opus 4.8. Sonnet (`claude-sonnet-5`) is the
     * documented cost knob — see the config docs (PR 11).
     */
    model: z.string().min(1).optional(),
    /** NAME of the env var holding the key (BYOK-by-env-name, ADR 0013). */
    apiKeyEnv: z.string().min(1).optional(),
  })
  .strict();

export const GENERATOR_REGISTRY = {
  [Providers.ANTHROPIC]: defineEntry({
    options: anthropicOptions,
    create: async (options, deps) => {
      const key = resolveApiKey(
        deps.env,
        options.apiKeyEnv ?? DEFAULT_ANTHROPIC_KEY_ENV,
      );
      if (!key.ok) return key;
      return {
        ok: true,
        value: new AnthropicGenerator(
          new Anthropic({ apiKey: key.value }),
          deps.failureDir,
          options.model,
        ),
      };
    },
  }),
} as const;

/**
 * The instance-config `generator:` block schema, derived from the registry.
 * PR 9's YAML loader parses against this; `createGenerator` re-validates so
 * programmatic callers get the same errors.
 */
export const GeneratorConfigSchema = z.discriminatedUnion("provider", [
  GENERATOR_REGISTRY[Providers.ANTHROPIC].options,
]);
export type GeneratorConfig = z.infer<typeof GeneratorConfigSchema>;

// Compile-time sync guards: adding a registry entry without listing its
// options schema in the union above (or its case in the dispatch below)
// breaks the build instead of leaving the provider unconstructible.
type RegistryProviders = keyof typeof GENERATOR_REGISTRY;
type UnionProviders = GeneratorConfig["provider"];
type AssertUnionCoversRegistry = [RegistryProviders] extends [UnionProviders]
  ? true
  : never;
type AssertRegistryCoversUnion = [UnionProviders] extends [RegistryProviders]
  ? true
  : never;
const unionCoversRegistry: AssertUnionCoversRegistry = true;
const registryCoversUnion: AssertRegistryCoversUnion = true;
void unionCoversRegistry;
void registryCoversUnion;

/** Zero-config default: today's behavior exactly (decision 1). */
export const defaultGeneratorConfig: GeneratorConfig = {
  provider: Providers.ANTHROPIC,
};

/** Provider tokens with registry entries (harness tokens join in PRs 4-6). */
function registeredProviders(): string[] {
  return Object.keys(GENERATOR_REGISTRY);
}

/**
 * Provider tokens are short kebab-case words (no digits — key material like
 * `sk-ant-api03-…` is kebab-shaped but digit-bearing and long); anything
 * outside this grammar is echoed redacted.
 */
const PROVIDER_TOKEN = /^[a-z][a-z-]{0,19}$/;

function describeConfigIssues(error: z.ZodError, config: unknown): string[] {
  // An unknown provider gets a purpose-built message naming the vocabulary —
  // the raw discriminated-union error is cryptic. The rejected value is
  // echoed ONLY when it looks like a token (a pasted credential must never
  // reach errors or logs).
  if (
    typeof config === "object" &&
    config !== null &&
    "provider" in config &&
    !registeredProviders().includes(String(Reflect.get(config, "provider")))
  ) {
    const rejected = String(Reflect.get(config, "provider"));
    const shown = PROVIDER_TOKEN.test(rejected) ? `"${rejected}"` : "(redacted)";
    return [
      `provider: unknown provider ${shown} (valid: ${registeredProviders().join(", ")})`,
    ];
  }
  return error.issues.map((issue) => {
    const path = issue.path.join(".") || "config";
    // Strict-object rejections list the offending KEY NAMES — render them
    // through the same token gate so a credential pasted as a key never
    // reaches errors or logs (typos like "modle" still echo).
    if (issue.code === "unrecognized_keys") {
      const shown = issue.keys
        .map((key) => (CONFIG_KEY_TOKEN.test(key) ? `"${key}"` : "(redacted)"))
        .join(", ");
      return `${path}: unrecognized key(s): ${shown}`;
    }
    return `${path}: ${issue.message}`;
  });
}

/** Config keys are short camelCase identifiers; echo anything else redacted. */
const CONFIG_KEY_TOKEN = /^[A-Za-z][A-Za-z-]{0,19}$/;

/**
 * Validate a generator config and construct its adapter. Async because
 * harness entries run boot probes (`<cli> --version` + auth preflight) at
 * construction (PRs 4-6). Never throws for expected misconfiguration.
 */
export async function createGenerator(
  config: unknown,
  deps: CreateGeneratorDeps,
): Promise<Result<Generator, ConfigError>> {
  const parsed = GeneratorConfigSchema.safeParse(config);
  if (!parsed.success) {
    return configError(describeConfigIssues(parsed.error, config));
  }
  // Dispatch by discriminant — the switch keeps option-to-create type
  // correlation without casts; exhaustiveness is compiler-checked.
  switch (parsed.data.provider) {
    case Providers.ANTHROPIC:
      return GENERATOR_REGISTRY[Providers.ANTHROPIC].create(parsed.data, deps);
  }
}
