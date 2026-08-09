import { z } from "zod/v4";
import type { ValueOf } from "types";

/**
 * The port's cross-provider vocabulary (ADR 0013): the normalized effort knob
 * and the Generation origin shape every artifact records. Domain schemas
 * (Brief, Delta, …) stay in their own packages — only what every adapter and
 * every artifact shares lives here.
 */

/**
 * Effort — the normalized, cross-provider reasoning-effort knob. Each adapter
 * maps it to its provider's own setting (Anthropic `output_config.effort`,
 * OpenAI `reasoning_effort`, …); a provider without the concept ignores it.
 */
export const Efforts = ["low", "medium", "high"] as const;

export type Effort = (typeof Efforts)[number];

/**
 * Generation origin — which provider/model/effort produced this artifact.
 * CLI-owned metadata (the model never produces it); surfaced on the Receipt and
 * as an understated header label so the analysis is never mistaken for a verdict
 * (ADR 0012/0013).
 */
export const GenerationSchema = z.object({
  provider: z
    .string()
    .describe("LLM provider that produced this artifact, e.g. 'anthropic'"),
  model: z.string().describe("model id, e.g. 'claude-opus-4-8'"),
  effort: z
    .enum(Efforts)
    .nullable()
    .describe(
      "normalized reasoning effort used; null when the provider has no effort concept",
    ),
});

export type Generation = z.infer<typeof GenerationSchema>;

/**
 * Anchor origin (BRIEF-143): how a brief relates to its predecessor.
 * `none` = no anchoring was performed (first generations, and every
 * generation until the stitch step lands); `anchored` = incremental
 * regeneration against the previous brief; `fresh-restart` = a deliberate
 * from-scratch run (the anchor chain restarts here), always with a reason.
 */
export const AnchorStates = {
  ANCHORED: "anchored",
  FRESH_RESTART: "fresh-restart",
  NONE: "none",
} as const;
export type AnchorState = ValueOf<typeof AnchorStates>;

/** Why an anchored-capable generation ran fresh instead. */
export const FreshRestartReasons = {
  /** `full-regeneration: on-model-swap` fired — stamped provider/model moved. */
  MODEL_SWAP: "model-swap",
} as const;
export type FreshRestartReason = ValueOf<typeof FreshRestartReasons>;

/**
 * The anchor stamp — CLI/worker-assigned like `Generation`, never
 * model-produced. Strict: `reason` exists exactly on `fresh-restart`.
 */
export const AnchorSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal(AnchorStates.ANCHORED) }).strict(),
  z
    .object({
      state: z.literal(AnchorStates.FRESH_RESTART),
      reason: z.enum([FreshRestartReasons.MODEL_SWAP]),
    })
    .strict(),
  z.object({ state: z.literal(AnchorStates.NONE) }).strict(),
]);
export type Anchor = z.infer<typeof AnchorSchema>;
