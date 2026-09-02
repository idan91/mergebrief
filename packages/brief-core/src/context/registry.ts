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

/** What a composition root injects; roots stay the only `process.env` readers. */
export interface CreateContextProviderDeps {
  readonly env: Record<string, string | undefined>;
}

interface ContextRegistryEntry<Options extends z.ZodType> {
  readonly options: Options;
  readonly egress: EgressTier;
  create(
    options: z.infer<Options>,
    deps: CreateContextProviderDeps,
  ): Result<ContextProvider, ConfigError>;
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
 * The static compiled-in provider registry, the generator registry's shape:
 * a type token, a strict Zod options schema carrying the token as
 * discriminant, an egress tier, and a `create` returning `Result` so a
 * misconfigured instance refuses boot instead of limping into jobs.
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

/** The providers that need no configuration, in fan-out order. */
export function createBuiltInContextProviders(): ContextProvider[] {
  return [urlContextProvider];
}
