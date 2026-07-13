/**
 * Public surface of the generators package (ADR 0013/0030): the `Generator`
 * port, its cross-provider vocabulary, the Anthropic adapter, and the shared
 * structured-output machinery (enum-preserving schema, salvage).
 */
export {
  AnthropicGenerator,
  type AnthropicStreamingClient,
  type Generator,
  type GenerateRequest,
  type Logger,
} from "./generator";
export { Efforts, GenerationSchema, type Effort, type Generation } from "./vocabulary";
export {
  createGenerator,
  defaultGeneratorConfig,
  GENERATOR_REGISTRY,
  GeneratorConfigSchema,
  Providers,
  type ConfigError,
  type CreateGeneratorDeps,
  type GeneratorConfig,
  type Provider,
} from "./registry";
export { GeneratorError, GeneratorErrorKind } from "./errors";
export {
  ClaudeCodeGenerator,
  type ClaudeCodeGeneratorOptions,
} from "./claudeCode";
export { CodexGenerator, type CodexGeneratorOptions } from "./codex";
export {
  classifyOpenAiError,
  OpenAiCompatibleCore,
  type OpenAiChatRequest,
  type OpenAiChatTransport,
  type OpenAiCompatibleCoreOptions,
  type OpenAiStreamChunk,
} from "./openaiCore";
export {
  createOpenAiCore,
  sdkTransport,
  type OpenAiAssemblyOptions,
} from "./openai";
export {
  DEFAULT_HARNESS_TIMEOUTS,
  harnessTimeoutError,
  probeHarnessCli,
  resolveHarnessTimeouts,
  runHarnessProcess,
  spawnFailureError,
  type HarnessTimeoutOverrides,
  type HarnessProbeArgs,
  type HarnessRunArgs,
  type HarnessRunResult,
  type HarnessTimeouts,
} from "./harness";
export {
  runWithSchemaFloor,
  schemaFeedbackMessage,
  type FloorAttempt,
  type FloorFeedback,
  type RunWithSchemaFloorArgs,
} from "./floor";
export { salvageDroppableEnums, type SalvageResult } from "./salvage";
export {
  enumPreservingJsonSchema,
  enumPreservingOutputFormat,
  parseStructuredText,
  toStrictJsonSchema,
  type ParseableOutputFormat,
} from "./outputFormat";
