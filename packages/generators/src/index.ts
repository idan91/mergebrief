/**
 * ENTRY POINT — the generators package's ONLY export (`package.json`
 * `exports["."]`). Everything importable from `"generators"` is re-exported
 * here, grouped by the folder it lives in. Map + glossary: `AGENTS.md`.
 *
 * The package: structured generation —
 * `(schema, system, user) → object valid against the schema` — behind one
 * `Generator` contract, with six interchangeable adapters.
 */

// --- contract/ — what an adapter IS -----------------------------------------
export {
  type Generator,
  type GenerateRequest,
  type Logger,
  type TokenUsage,
} from "./contract/generator";
export {
  AnchorSchema,
  AnchorStates,
  Efforts,
  FreshRestartReasons,
  GenerationSchema,
  type Anchor,
  type AnchorState,
  type Effort,
  type FreshRestartReason,
  type Generation,
} from "./contract/generation";
export { GeneratorError, GeneratorErrorKind } from "./contract/errors";

// --- config/ — how an instance CHOOSES an adapter ---------------------------
export {
  COMPOSE_WORKER_RUNTIME,
  createGenerator,
  defaultGeneratorConfig,
  FullRegenerations,
  GENERATOR_REGISTRY,
  GeneratorConfigSchema,
  Providers,
  RUNTIME_MARKER_VAR,
  validateGeneratorConfig,
  type ConfigError,
  type CreateGeneratorDeps,
  type FullRegeneration,
  type GeneratorConfig,
  type Provider,
} from "./config/registry";
export {
  loadGeneratorConfig,
  loadGeneratorConfigFile,
  type LoadedGeneratorConfig,
} from "./config/loader";
export {
  DEFAULT_DRAFT_POLICY,
  loadInstancePolicy,
  type LoadedInstancePolicy,
} from "./config/instancePolicy";
export {
  capForRepo,
  DEFAULT_SPEND_POLICY,
  validateSpendBlock,
  type SpendPolicy,
} from "./config/spendPolicy";

// --- adapters/ — the six implementations ------------------------------------
// (Constructed via createGenerator in normal use; exported for tests and
// direct composition.)
export {
  AnthropicGenerator,
  type AnthropicStreamingClient,
} from "./adapters/anthropic";
export {
  ClaudeCodeGenerator,
  type ClaudeCodeGeneratorOptions,
} from "./adapters/claudeCode";
export { CodexGenerator, type CodexGeneratorOptions } from "./adapters/codex";
export {
  CursorGenerator,
  type CursorGeneratorOptions,
} from "./adapters/cursor";
export {
  classifyOpenAiError,
  OpenAiCompatibleCore,
  type OpenAiChatRequest,
  type OpenAiChatTransport,
  type OpenAiCompatibleCoreOptions,
  type OpenAiStreamChunk,
} from "./adapters/openaiCore";
export {
  createOpenAiCore,
  sdkTransport,
  type OpenAiAssemblyOptions,
} from "./adapters/openai";
export {
  createOpenRouterCore,
  type OpenRouterAssemblyOptions,
} from "./adapters/openrouter";

// --- validation/ — what every adapter's OUTPUT passes through ---------------
export {
  runWithSchemaFloor,
  schemaFeedbackMessage,
  type FloorAttempt,
  type FloorFeedback,
  type RunWithSchemaFloorArgs,
} from "./validation/enforceSchema";
export {
  salvageDroppableEnums,
  type SalvageResult,
} from "./validation/enumRecovery";
export {
  enumPreservingJsonSchema,
  enumPreservingOutputFormat,
  parseStructuredText,
  toStrictJsonSchema,
  type ParseableOutputFormat,
} from "./validation/jsonSchema";

// --- harness/ — how the CLI adapters RUN local binaries ---------------------
export {
  DEFAULT_HARNESS_TIMEOUTS,
  resolveHarnessTimeouts,
  runHarnessProcess,
  spawnFailureError,
  type HarnessTimeoutOverrides,
  type HarnessRunArgs,
  type HarnessRunResult,
  type HarnessTimeouts,
} from "./harness/run";
export { harnessTimeoutError, redactSecrets } from "./harness/redact";
export { probeHarnessCli, type HarnessProbeArgs } from "./harness/probe";
