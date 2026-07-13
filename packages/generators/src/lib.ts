/**
 * Public surface of the generators package (ADR 0013/0030): the `Generator`
 * port, its cross-provider vocabulary, the Anthropic adapter, and the shared
 * structured-output machinery (enum-preserving schema, salvage).
 */
export {
  AnthropicGenerator,
  type Generator,
  type GenerateRequest,
  type Logger,
} from "./generator";
export { Efforts, GenerationSchema, type Effort, type Generation } from "./vocabulary";
export { salvageDroppableEnums, type SalvageResult } from "./salvage";
export {
  enumPreservingOutputFormat,
  toStrictJsonSchema,
  type ParseableOutputFormat,
} from "./outputFormat";
