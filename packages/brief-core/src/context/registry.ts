import { z } from "zod/v4";
import type { Result, ValueOf } from "types";
import type { ConfigError } from "generators";
import { urlContextProvider } from "./providers/url";
import { ContextProviderTypes, type ContextProvider } from "./types";

/**
 * Which query tier a provider type may see. Every provider today is
 * metadata-only (title and body); the content tier is a per-instance opt-in
 * no provider has yet.
 */
export const EgressTiers = {
  METADATA: "metadata",
} as const;
export type EgressTier = ValueOf<typeof EgressTiers>;

interface ContextRegistryEntry<Options extends z.ZodType> {
  readonly options: Options;
  readonly egress: EgressTier;
  create(options: z.infer<Options>): Result<ContextProvider, ConfigError>;
}

/** Generic entry helper: ties each schema to its create without widening. */
function defineEntry<Options extends z.ZodType>(
  entry: ContextRegistryEntry<Options>,
): ContextRegistryEntry<Options> {
  return entry;
}

const urlOptions = z
  .object({
    type: z.literal(ContextProviderTypes.URL),
  })
  .strict();

/**
 * The static compiled-in registry of generic sources, the generator
 * registry's shape: a type token, a strict Zod options schema carrying the
 * token as discriminant, an egress tier, and a `create` returning `Result`.
 * Ticket trackers are not here; they live in `trackers/`.
 */
export const CONTEXT_REGISTRY = {
  [ContextProviderTypes.URL]: defineEntry({
    options: urlOptions,
    egress: EgressTiers.METADATA,
    create: () => ({ ok: true, value: urlContextProvider }),
  }),
} as const;

/** Provider types every composition root gets without a config entry. */
export const BUILT_IN_CONTEXT_PROVIDER_TYPES = [
  ContextProviderTypes.URL,
] as const;

/** The generic sources every root runs, in fan-out order: the URL chaser. */
export function createBuiltInContextProviders(): ContextProvider[] {
  return [urlContextProvider];
}
