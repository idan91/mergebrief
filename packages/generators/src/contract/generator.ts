import type { z } from "zod/v4";
import type { Effort, Generation } from "./generation";
import type { GeneratorWarningSink } from "./types";

export type Logger = (message: string) => void;

/**
 * Token counts for ONE provider request, in that provider's own accounting:
 * Anthropic's `inputTokens` EXCLUDES cache reads, OpenAI-compatible ones
 * INCLUDE them, cursor-agent's are unverified.
 */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  /** 0 when unreported. */
  cacheReadTokens: number;
  /** Absent when unreported: a reported 0 means the effort was not honored. */
  reasoningTokens?: number;
}

export interface GenerateRequest<S extends z.ZodType> {
  schema: S;
  system: string;
  user: string;
  effort: Effort;
  label: string;
  /** Array fields whose invalid elements may be dropped instead of failing. */
  salvageFields?: readonly string[];
  /** Aborting rejects untouched: no salvage, no feedback retry, no dump. */
  signal?: AbortSignal;
  log?: Logger;
  /**
   * Once per provider request that reports usage, retries included. The CLI
   * adapters without per-call usage never call it; it must not throw.
   */
  onUsage?: (usage: TokenUsage) => void;
  /** Once per degradation this generation survived; the `log` line still fires. */
  onWarning?: GeneratorWarningSink;
}

/** Schema-valid output or a throw; provider-specific features stay on each adapter. */
export interface Generator {
  generate<S extends z.ZodType>(req: GenerateRequest<S>): Promise<z.infer<S>>;
  origin(effort: Effort): Generation;
}
