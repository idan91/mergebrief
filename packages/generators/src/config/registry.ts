import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod/v4";
import type { Result, ValueOf } from "types";
import { ClaudeCodeGenerator } from "../adapters/claudeCode";
import { CodexGenerator, CODEX_PROBE } from "../adapters/codex";
import { createOpenAiCore } from "../adapters/openai";
import { createOpenRouterCore } from "../adapters/openrouter";
import { configError, type ConfigError } from "../contract/errors";
import { Efforts } from "../contract/provenance";
import { AnthropicGenerator } from "../adapters/anthropic";
import type { Generator, Logger } from "../contract/generator";
import { probeHarnessCli } from "../harness/probe";

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

// ConfigError lives in ./errors (shared with the harness boot probe);
// re-exported here so config-focused consumers keep one import site.
export { configError, type ConfigError } from "../contract/errors";

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

/**
 * Normalized reasoning effort (BRIEF-75): the closed contract vocabulary
 * (`low | medium | high`), requested per generation. Optional on every
 * adapter — the DEFAULT (`medium`) lives at the consumption site in
 * brief-core, not here. Adapters that cannot honor it stay honest via
 * provenance (`effort: null`), never a config rejection.
 */
const effortOption = z.enum(Efforts).optional();

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
    effort: effortOption,
  })
  .strict();

/** Harness timer tunables (instance config, PR 9 loader parses these). */
const harnessTimeouts = z
  .object({
    hardMs: z.number().int().positive().optional(),
    inactivityMs: z.number().int().positive().optional(),
    killGraceMs: z.number().int().positive().optional(),
  })
  .strict();

const claudeCodeOptions = z
  .object({
    provider: z.literal(Providers.CLAUDE_CODE),
    /** Model id passed via --model; default Opus 4.8. */
    model: z.string().min(1).optional(),
    /** Binary path or name; default "claude" (PATH-resolved). */
    command: z.string().min(1).optional(),
    timeouts: harnessTimeouts.optional(),
    effort: effortOption,
  })
  .strict();

const DEFAULT_CLAUDE_COMMAND = "claude";

const codexOptions = z
  .object({
    provider: z.literal(Providers.CODEX),
    /** Model id for -m; absent → the CLI's configured default (provenance
     * stamps "codex-default"). */
    model: z.string().min(1).optional(),
    /** Binary path or name; default "codex" (PATH-resolved). */
    command: z.string().min(1).optional(),
    timeouts: harnessTimeouts.optional(),
    effort: effortOption,
  })
  .strict();

const DEFAULT_CODEX_COMMAND = "codex";

const DEFAULT_OPENAI_KEY_ENV = "OPENAI_API_KEY";

const openaiOptions = z
  .object({
    provider: z.literal(Providers.OPENAI),
    /** Model id — REQUIRED: there is no honest universal default here. */
    model: z.string().min(1),
    /** NAME of the env var holding the key (BYOK-by-env-name). */
    apiKeyEnv: z.string().min(1).optional(),
    /**
     * OpenAI-compatible server escape hatch. When set, the /models
     * preflight downgrades to warnings (self-hosted servers may not
     * implement it).
     */
    baseUrl: z.string().url().optional(),
    effort: effortOption,
  })
  .strict();

const DEFAULT_OPENROUTER_KEY_ENV = "OPENROUTER_API_KEY";

const openrouterOptions = z
  .object({
    provider: z.literal(Providers.OPENROUTER),
    /** Full OpenRouter slug (e.g. "anthropic/claude-opus-4.8") — REQUIRED. */
    model: z.string().min(1),
    apiKeyEnv: z.string().min(1).optional(),
    /**
     * OpenRouter provider-routing options (order, allow/deny, quantization…)
     * passed through under `provider`; `require_parameters: true` is forced
     * over whatever is set here.
     */
    providerRouting: z.record(z.string(), z.unknown()).optional(),
    /** Attribution headers. */
    referer: z.string().min(1).optional(),
    title: z.string().min(1).optional(),
    effort: effortOption,
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
  [Providers.CLAUDE_CODE]: defineEntry({
    options: claudeCodeOptions,
    create: async (options, deps) => {
      const command = options.command ?? DEFAULT_CLAUDE_COMMAND;
      // Boot probe (ADR 0030 #5): a misconfigured instance refuses boot
      // instead of failing inside jobs.
      const probe = await probeHarnessCli({
        command,
        versionArgv: ["--version"],
        authArgv: ["auth", "status"],
        authFailureHint:
          "run `claude /login` interactively on this machine (or set ANTHROPIC_API_KEY)",
        env: deps.env,
      });
      if (!probe.ok) return probe;
      return {
        ok: true,
        value: new ClaudeCodeGenerator({
          command,
          model: options.model,
          failureDir: deps.failureDir,
          timeouts: options.timeouts,
          env: deps.env,
          onModelMismatch: (requested, served) =>
            deps.log?.(
              `claude-code served-model mismatch: requested ${requested}, served ${served.join(", ")}`,
            ),
        }),
      };
    },
  }),
  [Providers.CODEX]: defineEntry({
    options: codexOptions,
    create: async (options, deps) => {
      const command = options.command ?? DEFAULT_CODEX_COMMAND;
      const probe = await probeHarnessCli({
        command,
        versionArgv: [...CODEX_PROBE.versionArgv],
        authArgv: [...CODEX_PROBE.authArgv],
        authFailureHint: CODEX_PROBE.authFailureHint,
        env: deps.env,
      });
      if (!probe.ok) return probe;
      return {
        ok: true,
        value: new CodexGenerator({
          command,
          model: options.model,
          failureDir: deps.failureDir,
          timeouts: options.timeouts,
          env: deps.env,
        }),
      };
    },
  }),
  [Providers.OPENAI]: defineEntry({
    options: openaiOptions,
    create: async (options, deps) => {
      const key = resolveApiKey(
        deps.env,
        options.apiKeyEnv ?? DEFAULT_OPENAI_KEY_ENV,
      );
      if (!key.ok) return key;
      return createOpenAiCore({
        apiKey: key.value,
        model: options.model,
        failureDir: deps.failureDir,
        baseUrl: options.baseUrl,
        provider: Providers.OPENAI,
        log: deps.log,
      });
    },
  }),
  [Providers.OPENROUTER]: defineEntry({
    options: openrouterOptions,
    create: async (options, deps) => {
      const key = resolveApiKey(
        deps.env,
        options.apiKeyEnv ?? DEFAULT_OPENROUTER_KEY_ENV,
      );
      if (!key.ok) return key;
      return createOpenRouterCore({
        apiKey: key.value,
        model: options.model,
        failureDir: deps.failureDir,
        providerRouting: options.providerRouting,
        referer: options.referer,
        title: options.title,
        // No hook here: createOpenRouterCore already logs mismatches via
        // deps.log; the hook is for UI surfacing (wired in PR 10).
        log: deps.log,
      });
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
  GENERATOR_REGISTRY[Providers.CLAUDE_CODE].options,
  GENERATOR_REGISTRY[Providers.CODEX].options,
  GENERATOR_REGISTRY[Providers.OPENAI].options,
  GENERATOR_REGISTRY[Providers.OPENROUTER].options,
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
 * Validate a config value against the registry-derived union WITHOUT
 * constructing (the YAML loader's early gate; `createGenerator` re-runs the
 * same validation so programmatic callers get identical errors).
 */
export function validateGeneratorConfig(
  config: unknown,
): Result<GeneratorConfig, ConfigError> {
  const parsed = GeneratorConfigSchema.safeParse(config);
  if (!parsed.success) {
    return configError(describeConfigIssues(parsed.error, config));
  }
  return { ok: true, value: parsed.data };
}

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
    case Providers.CLAUDE_CODE:
      return GENERATOR_REGISTRY[Providers.CLAUDE_CODE].create(parsed.data, deps);
    case Providers.CODEX:
      return GENERATOR_REGISTRY[Providers.CODEX].create(parsed.data, deps);
    case Providers.OPENAI:
      return GENERATOR_REGISTRY[Providers.OPENAI].create(parsed.data, deps);
    case Providers.OPENROUTER:
      return GENERATOR_REGISTRY[Providers.OPENROUTER].create(parsed.data, deps);
  }
}
