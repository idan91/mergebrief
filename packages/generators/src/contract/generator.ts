import type { z } from "zod/v4";
import type { Effort, Generation } from "./provenance";


/** Progress sink — defaults to no-op so callers stay usable in tests. */
export type Logger = (message: string) => void;

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
   * strict parsing fails. Closed vocabularies are now enforced server-side via
   * the hand-built enum-preserving schema (`enumPreservingJsonSchema`), so an
   * out-of-vocabulary token can no longer be decoded in the first place. Salvage
   * stays as defense-in-depth for what enforcement doesn't cover — structural
   * failures, refusals, and any residual slip — dropping bad elements of
   * supplementary fields rather than killing a whole generation. Structural
   * failures and fields not named here still hard-fail (after one retry).
   */
  salvageFields?: readonly string[];
  /**
   * Cooperative cancellation (ADR 0006 #6): aborting stops the underlying
   * stream (and output-token billing) mid-call. The abort rejection
   * propagates to the caller UNTOUCHED — no salvage, no feedback retry, no
   * failure dump: an abort is not a generation failure.
   */
  signal?: AbortSignal;
  log?: Logger;
}

/**
 * The base contract all providers fit (ADR 0013): **structured generation** —
 * `(schema, system, user) → object valid against the schema`. Provider-specific
 * features (thinking, caching, …) live on each adapter, never in this signature.
 * A provider/model that can't meet this contract is not a valid adapter (the
 * structured-output floor is hard, not best-effort).
 */
export interface Generator {
  generate<S extends z.ZodType>(req: GenerateRequest<S>): Promise<z.infer<S>>;
  /** Provenance for an artifact this generator produced at the given effort. */
  provenance(effort: Effort): Generation;
}

