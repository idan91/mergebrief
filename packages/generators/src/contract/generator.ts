import type { z } from "zod/v4";
import type { Effort, Generation } from "./generation";
import type { GeneratorWarningSink } from "./types";

export type Logger = (message: string) => void;

/**
 * Token counts for ONE provider request, in that provider's own accounting:
 * Anthropic's `inputTokens` EXCLUDES cache reads and writes, OpenAI-compatible
 * ones INCLUDE cache reads, cursor-agent's are unverified.
 */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  /** 0 when unreported. */
  cacheReadTokens: number;
  /** Absent when unreported. */
  cacheWriteTokens?: number;
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
  /** Masks values the caller holds secret in model output written to a failure dump. */
  redact?: (text: string) => string;
  /**
   * Runs on every attempt's output before validation, salvage, a warning or
   * the feedback retry; a throw ends the generation with that error.
   */
  screenAttempt?: (attempt: ScreenedAttempt) => void;
}

/** One attempt as the model returned it: the raw text and the value parsed from it, when any. */
export interface ScreenedAttempt {
  readonly raw: string;
  readonly parsed: unknown;
}

/** Schema-valid output or a throw; provider-specific features stay on each adapter. */
export interface Generator {
  generate<S extends z.ZodType>(req: GenerateRequest<S>): Promise<z.infer<S>>;
  origin(effort: Effort): Generation;
}
