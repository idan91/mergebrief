import { existsSync, readFileSync } from "node:fs";
import { z } from "zod/v4";
import { Providers, type Provider } from "generators";
import type { Result } from "types/utils";
import type { InvocationUsage } from "./report";

/**
 * Prices are USER-SUPPLIED config, never hardcoded: baked-in rates go stale
 * and silently mis-report. Absent file → tokens-only reporting. Keys are
 * `${provider}:${model}`, rates are $ per Mtok.
 */
const PriceRowSchema = z.object({
  inputPerMTok: z.number().nonnegative(),
  outputPerMTok: z.number().nonnegative(),
  /** Omitted → cache reads are NOT priced (shown as tokens only, never
   * guessed at some fraction of the input rate). */
  cacheReadPerMTok: z.number().nonnegative().optional(),
});
export type PriceRow = z.infer<typeof PriceRowSchema>;

const PricesSchema = z.record(z.string(), PriceRowSchema);
export type PriceTable = z.infer<typeof PricesSchema>;

export function loadPrices(path: string): Result<PriceTable | null, string> {
  if (!existsSync(path)) {
    return { ok: true, value: null };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    return {
      ok: false,
      error: `unreadable prices file at ${path}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
  const parsed = PricesSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: `malformed prices file at ${path}` };
  }
  return { ok: true, value: parsed.data };
}

const perTok = (tokens: number, perMTok: number): number =>
  (tokens * perMTok) / 1_000_000;

/**
 * Providers whose reported `inputTokens` EXCLUDE cache reads (the two are
 * disjoint and price additively). OpenAI-compatible providers instead
 * report cached tokens as a SUBSET of prompt_tokens; their cache reads
 * must be re-priced by subtraction, never added (adding would double-count).
 * Construction is checked against the generators' closed Provider vocabulary;
 * lookup takes the untyped provider half of a "provider:model" key.
 */
const INPUT_EXCLUDES_CACHE: ReadonlySet<string> = new Set<Provider>([
  Providers.ANTHROPIC,
  Providers.CLAUDE_CODE,
]);

/** `key` is the invocation's `provider:model`; pricing semantics follow
 * the provider family (see INPUT_EXCLUDES_CACHE). */
export function priceUsage(
  key: string,
  usage: InvocationUsage,
  row: PriceRow,
): number {
  const provider = key.split(":")[0] ?? "";
  const output = perTok(usage.outputTokens, row.outputPerMTok);
  const cacheRate = row.cacheReadPerMTok;

  if (INPUT_EXCLUDES_CACHE.has(provider)) {
    return (
      perTok(usage.inputTokens, row.inputPerMTok) +
      output +
      (cacheRate === undefined ? 0 : perTok(usage.cacheReadTokens, cacheRate))
    );
  }
  if (cacheRate === undefined) {
    // No cache rate: the whole prompt bills at the input rate; an honest
    // overcount, since cost must never be understated.
    return perTok(usage.inputTokens, row.inputPerMTok) + output;
  }
  // Guard a pathological wire report (cached > prompt) from going negative;
  // failing toward overcounting, consistent with never-understate.
  const uncached = Math.max(0, usage.inputTokens - usage.cacheReadTokens);
  return (
    perTok(uncached, row.inputPerMTok) +
    perTok(usage.cacheReadTokens, cacheRate) +
    output
  );
}
