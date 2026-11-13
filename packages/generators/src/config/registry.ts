import { z } from "zod/v4";
import type { Result, ValueOf } from "types";
import {
  ClaudeCodeGenerator,
  CLAUDE_CLI_ENV,
  CLAUDE_PROBE,
  CLAUDE_VERSION_POLICY,
  interpretClaudeAuthStatus,
} from "../adapters/claudeCode";
import {
  CodexGenerator,
  CODEX_CLI_ENV,
  CODEX_PROBE,
  CODEX_VERSION_POLICY,
  interpretCodexLoginStatus,
} from "../adapters/codex";
import {
  CursorGenerator,
  CURSOR_CLI_ENV,
  CURSOR_CWD_FILES,
  CURSOR_PROBE,
  CURSOR_VERSION_POLICY,
  interpretCursorAbout,
} from "../adapters/cursor";
import { createOpenAiCore } from "../adapters/openai";
import { createOpenRouterCore } from "../adapters/openrouter";
import { configError, type ConfigError } from "../contract/errors";
import { Efforts } from "../contract/generation";
import {
  AnthropicGenerator,
  createAnthropicClient,
} from "../adapters/anthropic";
import type { Generator, Logger } from "../contract/generator";
import { probeHarnessCli } from "../harness/probe";
import { checkCliVersion } from "../harness/version-floor";
import { COMPOSE_WORKER_RUNTIME, ENV_VAR_NAME } from "./consts";
import { RUNTIME_MARKER_VAR } from "./instancePolicy";

/** Provider vocabulary. */
export const Providers = {
  ANTHROPIC: "anthropic",
  CLAUDE_CODE: "claude-code",
  CODEX: "codex",
  CURSOR: "cursor",
  OPENAI: "openai",
  OPENROUTER: "openrouter",
} as const;
export type Provider = ValueOf<typeof Providers>;

/** What a startup wiring injects; roots stay the only process.env readers. */
export interface CreateGeneratorDeps {
  env: Record<string, string | undefined>;
  /** Where failed-generation raw outputs are dumped (ephemeral). */
  failureDir: string;
  log?: Logger;
}

interface RegistryEntry<O extends z.ZodType> {
  options: O;
  create(
    options: z.infer<O>,
    deps: CreateGeneratorDeps,
  ): Promise<Result<Generator, ConfigError>>;
}

/** Generic entry helper: ties each schema to its create without widening. */
function defineEntry<O extends z.ZodType>(
  entry: RegistryEntry<O>,
): RegistryEntry<O> {
  return entry;
}

/** Reads `apiKeyEnv` (or the adapter default) from the injected env by NAME. */
function resolveApiKey(
  env: CreateGeneratorDeps["env"],
  keyEnv: string,
): Result<string, ConfigError> {
  if (!ENV_VAR_NAME.test(keyEnv)) {
    return configError([
      "apiKeyEnv: must be an environment variable NAME (UPPERCASE letters, digits, underscores) — never a key value",
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
 * Normalized reasoning effort: the closed contract vocabulary
 * (`low | medium | high`), requested per generation. Optional on every
 * adapter; the DEFAULT (`medium`) lives at the consumption site in
 * brief-core, not here. Adapters that cannot honor it stay honest via
 * the origin stamp (`effort: null`), never a config rejection.
 */
const effortOption = z.enum(Efforts).optional();

/**
 * Cross-revision regeneration policy: whether a new revision's brief anchors
 * to the previous one. `never` (the DEFAULT, applied at the worker's
 * consumption site like effort's) = always anchored; `on-model-swap` = fresh
 * restart only when the previous brief's stamped provider/model differs from
 * the current config; `always` = kill-switch, every generation fresh (also
 * the eval baseline-compat mode).
 */
export const FullRegenerations = {
  ALWAYS: "always",
  ON_MODEL_SWAP: "on-model-swap",
  NEVER: "never",
} as const;
export type FullRegeneration = ValueOf<typeof FullRegenerations>;

const fullRegenerationOption = z.enum(FullRegenerations).optional();

/** Runs every brief through the multi-call path whatever the diff's size; off by default. */
const forceMultiCallOption = z.boolean().optional();

/** `false` skips the revision narrative against the previous brief; on by default. */
const revisionNarrativeOption = z.boolean().optional();

const HUGE_SPAN_RATIO_OUT_OF_RANGE = "must be a number above 0 and at most 1";

/**
 * The share of a pull request's changed lines at which an incremental span
 * falls back to the full brief; the DEFAULT is brief-core's
 * `DEFAULT_HUGE_SPAN_RATIO`.
 */
const hugeSpanRatioOption = z
  .number(HUGE_SPAN_RATIO_OUT_OF_RANGE)
  .gt(0, HUGE_SPAN_RATIO_OUT_OF_RANGE)
  .lte(1, HUGE_SPAN_RATIO_OUT_OF_RANGE)
  .optional();

/**
 * Detail calls a multi-call run keeps in flight at once; the DEFAULT (8) is
 * brief-core's `DEFAULT_DETAIL_CONCURRENCY`.
 */
const detailConcurrencyOption = z.number().int().min(1).optional();

const ANTHROPIC_BASE_URL_VERSION_ISSUE =
  "anthropic takes the gateway host root with no /v1 (the SDK appends /v1/messages)";

const VERSION_SEGMENT_SUFFIX = /\/v1\/?$/;

function endsWithVersionSegment(url: string): boolean {
  try {
    return VERSION_SEGMENT_SUFFIX.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

const anthropicOptions = z
  .object({
    provider: z.literal(Providers.ANTHROPIC),
    /**
     * Model id; default Opus 5.5. Sonnet (`claude-sonnet-5-5`) is the
     * cheaper option.
     */
    model: z.string().min(1).optional(),
    /** NAME of the env var holding the key (BYOK-by-env-name). */
    apiKeyEnv: z.string().min(1).optional(),
    /** Gateway host root without `/v1`; the canonical Anthropic host when absent. */
    baseUrl: z
      .string()
      .url()
      .refine((url) => !endsWithVersionSegment(url), {
        message: ANTHROPIC_BASE_URL_VERSION_ISSUE,
      })
      .optional(),
    effort: effortOption,
    fullRegeneration: fullRegenerationOption,
    forceMultiCall: forceMultiCallOption,
    revisionNarrative: revisionNarrativeOption,
    hugeSpanRatio: hugeSpanRatioOption,
    detailConcurrency: detailConcurrencyOption,
  })
  .strict();

/** Harness timer tunables. */
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
    /** Model id passed via --model; default Opus 5.5. */
    model: z.string().min(1).optional(),
    /** Binary path or name; default "claude" (PATH-resolved). */
    command: z.string().min(1).optional(),
    timeouts: harnessTimeouts.optional(),
    effort: effortOption,
    fullRegeneration: fullRegenerationOption,
    forceMultiCall: forceMultiCallOption,
    revisionNarrative: revisionNarrativeOption,
    hugeSpanRatio: hugeSpanRatioOption,
    detailConcurrency: detailConcurrencyOption,
  })
  .strict();

const DEFAULT_CLAUDE_COMMAND = "claude";

const codexOptions = z
  .object({
    provider: z.literal(Providers.CODEX),
    /** Model id for -m; absent → the CLI's configured default (the origin stamp
     * shows "codex-default"). */
    model: z.string().min(1).optional(),
    /** Binary path or name; default "codex" (PATH-resolved). */
    command: z.string().min(1).optional(),
    timeouts: harnessTimeouts.optional(),
    effort: effortOption,
    fullRegeneration: fullRegenerationOption,
    forceMultiCall: forceMultiCallOption,
    revisionNarrative: revisionNarrativeOption,
    hugeSpanRatio: hugeSpanRatioOption,
    detailConcurrency: detailConcurrencyOption,
  })
  .strict();

const DEFAULT_CODEX_COMMAND = "codex";

const cursorOptions = z
  .object({
    provider: z.literal(Providers.CURSOR),
    /** Model id VERBATIM from `cursor-agent --list-models`; effort rides
     * the id variant; bracketed ids refuse boot (the CLI rejects them). */
    model: z
      .string()
      .min(1)
      .refine((value) => !value.includes("["), {
        message:
          "bracket overrides are rejected by cursor-agent — pick an effort variant id from `cursor-agent --list-models` (e.g. gpt-5.2-high)",
      })
      .optional(),
    /** Binary path or name; default "cursor-agent" (PATH-resolved). */
    command: z.string().min(1).optional(),
    /**
     * Note: cursor's stream is pipe-silent until exit, so an unset
     * inactivityMs defaults to hardMs (wall-clock only), not the shared
     * 3-minute watchdog.
     */
    timeouts: harnessTimeouts.optional(),
    effort: effortOption,
    fullRegeneration: fullRegenerationOption,
    forceMultiCall: forceMultiCallOption,
    revisionNarrative: revisionNarrativeOption,
    hugeSpanRatio: hugeSpanRatioOption,
    detailConcurrency: detailConcurrencyOption,
  })
  .strict();

const DEFAULT_CURSOR_COMMAND = "cursor-agent";

const DEFAULT_OPENAI_KEY_ENV = "OPENAI_API_KEY";

const openaiOptions = z
  .object({
    provider: z.literal(Providers.OPENAI),
    /** Model id; REQUIRED: there is no honest universal default here. */
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
    fullRegeneration: fullRegenerationOption,
    forceMultiCall: forceMultiCallOption,
    revisionNarrative: revisionNarrativeOption,
    hugeSpanRatio: hugeSpanRatioOption,
    detailConcurrency: detailConcurrencyOption,
  })
  .strict();

const DEFAULT_OPENROUTER_KEY_ENV = "OPENROUTER_API_KEY";

const openrouterOptions = z
  .object({
    provider: z.literal(Providers.OPENROUTER),
    /** Full OpenRouter slug (e.g. "anthropic/claude-opus-4.8"); REQUIRED. */
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
    fullRegeneration: fullRegenerationOption,
    forceMultiCall: forceMultiCallOption,
    revisionNarrative: revisionNarrativeOption,
    hugeSpanRatio: hugeSpanRatioOption,
    detailConcurrency: detailConcurrencyOption,
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
      if (!key.ok) {
        return key;
      }
      return {
        ok: true,
        value: new AnthropicGenerator(
          createAnthropicClient({
            apiKey: key.value,
            baseUrl: options.baseUrl,
          }),
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
      // Boot probe: a misconfigured instance refuses boot instead of failing
      // inside jobs. The interpreters add the billing checks: version-floor
      // warning + subscription-route assertion (API-key route = ConfigError).
      const probeArgs: Parameters<typeof probeHarnessCli>[0] = {
        command,
        versionArgv: [...CLAUDE_PROBE.versionArgv],
        authArgv: [...CLAUDE_PROBE.authArgv],
        authFailureHint: CLAUDE_PROBE.authFailureHint,
        env: deps.env,
        cliEnv: CLAUDE_CLI_ENV,
        interpretVersionOutput: (stdout) =>
          checkCliVersion(stdout, CLAUDE_VERSION_POLICY),
        interpretAuthOutput: interpretClaudeAuthStatus,
      };
      if (deps.log) {
        probeArgs.log = deps.log;
      }
      const probe = await probeHarnessCli(probeArgs);
      if (!probe.ok) {
        return probe;
      }
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
      const probeArgs: Parameters<typeof probeHarnessCli>[0] = {
        command,
        versionArgv: [...CODEX_PROBE.versionArgv],
        authArgv: [...CODEX_PROBE.authArgv],
        authFailureHint: CODEX_PROBE.authFailureHint,
        env: deps.env,
        cliEnv: CODEX_CLI_ENV,
        interpretVersionOutput: (stdout) =>
          checkCliVersion(stdout, CODEX_VERSION_POLICY),
        interpretAuthOutput: interpretCodexLoginStatus,
      };
      if (deps.log) {
        probeArgs.log = deps.log;
      }
      const probe = await probeHarnessCli(probeArgs);
      if (!probe.ok) {
        return probe;
      }
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
  [Providers.CURSOR]: defineEntry({
    options: cursorOptions,
    create: async (options, deps) => {
      const command = options.command ?? DEFAULT_CURSOR_COMMAND;
      // The interpreters carry the whole auth verdict: `about` exits 0 even
      // logged out, so the generic nonzero-exit check alone would pass an
      // unauthenticated CLI into jobs.
      const probeArgs: Parameters<typeof probeHarnessCli>[0] = {
        command,
        versionArgv: [...CURSOR_PROBE.versionArgv],
        authArgv: [...CURSOR_PROBE.authArgv],
        authFailureHint: CURSOR_PROBE.authFailureHint,
        env: deps.env,
        cliEnv: CURSOR_CLI_ENV,
        cwdFiles: CURSOR_CWD_FILES,
        interpretVersionOutput: (stdout) =>
          checkCliVersion(stdout, CURSOR_VERSION_POLICY),
        interpretAuthOutput: interpretCursorAbout,
      };
      if (deps.log) {
        probeArgs.log = deps.log;
      }
      const probe = await probeHarnessCli(probeArgs);
      if (!probe.ok) {
        return probe;
      }
      return {
        ok: true,
        value: new CursorGenerator({
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
      if (!key.ok) {
        return key;
      }
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
      if (!key.ok) {
        return key;
      }
      return createOpenRouterCore({
        apiKey: key.value,
        model: options.model,
        failureDir: deps.failureDir,
        providerRouting: options.providerRouting,
        referer: options.referer,
        title: options.title,
        // No hook here: createOpenRouterCore already logs mismatches via
        // deps.log; the hook is for UI surfacing.
        log: deps.log,
      });
    },
  }),
} as const;

/**
 * The instance-config `generator:` block schema, derived from the registry.
 * The YAML loader parses against this; `createGenerator` re-validates so
 * programmatic callers get the same errors.
 */
export const GeneratorConfigSchema = z.discriminatedUnion("provider", [
  GENERATOR_REGISTRY[Providers.ANTHROPIC].options,
  GENERATOR_REGISTRY[Providers.CLAUDE_CODE].options,
  GENERATOR_REGISTRY[Providers.CODEX].options,
  GENERATOR_REGISTRY[Providers.CURSOR].options,
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

/** Zero-config default. */
export const defaultGeneratorConfig: GeneratorConfig = {
  provider: Providers.ANTHROPIC,
};

const HARNESS_PROVIDERS: ReadonlySet<Provider> = new Set([
  Providers.CLAUDE_CODE,
  Providers.CODEX,
  Providers.CURSOR,
]);

/** Provider tokens with registry entries. */
function registeredProviders(): string[] {
  return Object.keys(GENERATOR_REGISTRY);
}

/**
 * Provider tokens are short kebab-case words (no digits; key material like
 * `sk-ant-api03-…` is kebab-shaped but digit-bearing and long); anything
 * outside this grammar is echoed redacted.
 */
const PROVIDER_TOKEN = /^[a-z][a-z-]{0,19}$/;

function describeConfigIssues(error: z.ZodError, config: unknown): string[] {
  // An unknown provider gets a purpose-built message naming the vocabulary;
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
    const shown = PROVIDER_TOKEN.test(rejected)
      ? `"${rejected}"`
      : "(redacted)";
    return [
      `provider: unknown provider ${shown} (valid: ${registeredProviders().join(", ")})`,
    ];
  }
  return error.issues.map((issue) => {
    const path = issue.path.join(".") || "config";
    // Strict-object rejections list the offending KEY NAMES; render them
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
 * construction. Never throws for expected misconfiguration.
 */
export async function createGenerator(
  config: unknown,
  deps: CreateGeneratorDeps,
): Promise<Result<Generator, ConfigError>> {
  const parsed = GeneratorConfigSchema.safeParse(config);
  if (!parsed.success) {
    return configError(describeConfigIssues(parsed.error, config));
  }
  // Harness CLIs are never installed in the compose worker image. Refuse with
  // the operator's actual options BEFORE the probe hunts for a binary that
  // cannot exist there.
  if (
    HARNESS_PROVIDERS.has(parsed.data.provider) &&
    deps.env[RUNTIME_MARKER_VAR] === COMPOSE_WORKER_RUNTIME
  ) {
    return configError([
      `provider: harness CLIs (${[...HARNESS_PROVIDERS].join(", ")}) are not available in the compose worker — use an API provider, or point the worker at its own MERGEBRIEF_CONFIG (see docs/self-host/generators.md)`,
    ]);
  }
  // Dispatch by discriminant; the switch keeps option-to-create type
  // correlation without casts; exhaustiveness is compiler-checked.
  switch (parsed.data.provider) {
    case Providers.ANTHROPIC:
      return GENERATOR_REGISTRY[Providers.ANTHROPIC].create(parsed.data, deps);
    case Providers.CLAUDE_CODE:
      return GENERATOR_REGISTRY[Providers.CLAUDE_CODE].create(
        parsed.data,
        deps,
      );
    case Providers.CODEX:
      return GENERATOR_REGISTRY[Providers.CODEX].create(parsed.data, deps);
    case Providers.CURSOR:
      return GENERATOR_REGISTRY[Providers.CURSOR].create(parsed.data, deps);
    case Providers.OPENAI:
      return GENERATOR_REGISTRY[Providers.OPENAI].create(parsed.data, deps);
    case Providers.OPENROUTER:
      return GENERATOR_REGISTRY[Providers.OPENROUTER].create(parsed.data, deps);
  }
}
