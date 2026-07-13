import { z } from "zod/v4";

/**
 * The port's cross-provider vocabulary (ADR 0013): the normalized effort knob
 * and the Generation provenance shape every artifact records. Domain schemas
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
 * Generation provenance — which provider/model/effort produced this artifact.
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
