import type { z } from "zod/v4";
import type { Effort, Generation } from "./generation";

/** Progress sink — defaults to no-op so callers stay usable in tests. */
export type Logger = (message: string) => void;

/**
 * Provider-reported token counts for ONE underlying request. Numbers are
 * the provider's own accounting and their semantics differ:
 * Anthropic's `inputTokens` EXCLUDES cache reads; OpenAI-compatible
 * `inputTokens` (prompt_tokens) INCLUDES them. Consumers pricing these
 * must apply per-provider rates accordingly.
 */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  /** Prompt tokens served from provider cache; 0 when unreported. */
  cacheReadTokens: number;
  /**
   * Reasoning tokens inside `outputTokens`: ABSENT when the provider reports
   * none — a reported 0 (effort request not honored upstream) must stay
   * distinguishable from no report at all.
   */
  reasoningTokens?: number;
}

/** One structured-generation request — the portable contract every adapter honors. */
export interface GenerateRequest<S extends z.ZodType> {
  schema: S;
  system: string;
  user: string;
  effort: Effort;
  /** Short label for progress logs, e.g. "brief" / "delta". */
  label: string;
  /**
   * Array fields whose invalid elements may be dropped (warn-and-drop) when
   * strict parsing fails. Closed vocabularies are enforced server-side via
   * `enumPreservingJsonSchema`; salvage stays as defense-in-depth for what
   * enforcement doesn't cover. Structural failures and fields not named here
   * still hard-fail (after one retry).
   */
  salvageFields?: readonly string[];
  /**
   * Cooperative cancellation: aborting stops the underlying
   * stream (and output-token billing) mid-call. The abort rejection
   * propagates to the caller UNTOUCHED — no salvage, no feedback retry, no
   * failure dump: an abort is not a generation failure.
   */
  signal?: AbortSignal;
  log?: Logger;
  /**
   * Invoked once per underlying provider request that reports usage —
   * feedback/knob retries included, so a
   * caller totalling spend SUMS the calls. Best-effort: adapters without
   * per-call usage (the CLI adapters) never invoke it, and a request that
   * fails before usage is read reports nothing. Observability only — the
   * callback must not throw and never affects generation flow.
   */
  onUsage?: (usage: TokenUsage) => void;
}

/**
 * The base contract all providers fit: **structured generation** —
 * `(schema, system, user) → object valid against the schema`. Provider-specific
 * features (thinking, caching, …) live on each adapter, never in this signature.
 * A provider/model that can't meet this contract is not a valid adapter (the
 * structured-output floor is hard, not best-effort).
 */
export interface Generator {
  generate<S extends z.ZodType>(req: GenerateRequest<S>): Promise<z.infer<S>>;
  /** Origin stamp for an artifact this generator produced at the given effort. */
  origin(effort: Effort): Generation;
}
