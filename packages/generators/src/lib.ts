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
