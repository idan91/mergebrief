import { z } from "zod/v4";
import { AnchorStates, FreshRestartReasons, type ValueOf } from "types";

/**
 * Effort; the normalized, cross-provider reasoning-effort knob. Each adapter
 * maps it to its provider's own setting (Anthropic `output_config.effort`,
 * OpenAI `reasoning_effort`, …); a provider without the concept ignores it.
 */
export const Efforts = {
  LOW: "low",
  MEDIUM: "medium",
  HIGH: "high",
} as const;

export type Effort = ValueOf<typeof Efforts>;

/**
 * Generation origin; which provider/model/effort produced this artifact.
 * CLI-owned metadata (the model never produces it); surfaced on the Receipt and
 * as an understated header label so the analysis is never mistaken for a verdict.
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
 * The anchor stamp; CLI/worker-assigned like `Generation`, never
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
