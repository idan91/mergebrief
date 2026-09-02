import type { Result } from "types";
import type { Log } from "../github/types";
import type {
  ContextProvider,
  ContextQuery,
  ContextReadFailure,
  ContextSnippet,
  ProviderSnippet,
} from "./types";

/** Above every provider's own budget, so a stuck socket cannot stall a brief. */
export const CONTEXT_PROVIDER_TIMEOUT_MS = 15_000;

export interface FetchContextSnippetsOptions {
  readonly timeoutMs?: number;
  /** How long an aborted provider may take to hand back what it completed. */
  readonly graceMs?: number;
}

/** Enough for an aborted socket to settle and the provider to return its partial list. */
const ABORT_GRACE_MS = 1_000;

const TIMED_OUT = Symbol("timed-out");

/**
 * Resolves `graceMs` after the signal aborts: the provider keeps the floor
 * for that long so a stuck link costs only itself, not the links already
 * read (fail-open per URL, as the chaser always was).
 */
function resolveAfterAbort(
  signal: AbortSignal,
  graceMs: number,
): Promise<typeof TIMED_OUT> {
  return new Promise((resolve) => {
    signal.addEventListener(
      "abort",
      () => setTimeout(() => resolve(TIMED_OUT), graceMs),
      { once: true },
    );
  });
}

/**
 * Run every provider against the same query in parallel and concatenate the
 * results in provider order, numbering them `ctx-1..N`. Fail-open per
 * provider: a failure, a throw, or a timeout is logged and contributes
 * nothing; a brief must still be producible from the diff alone. Fresh per
 * generation, no cache.
 */
export async function fetchContextSnippets(
  query: ContextQuery,
  providers: readonly ContextProvider[],
  log: Log = () => {},
  options: FetchContextSnippetsOptions = {},
): Promise<ContextSnippet[]> {
  const timeoutMs = options.timeoutMs ?? CONTEXT_PROVIDER_TIMEOUT_MS;
  const graceMs = options.graceMs ?? ABORT_GRACE_MS;

  const perProvider = await Promise.all(
    providers.map((provider) =>
      readProviderSnippets(provider, query, log, timeoutMs, graceMs),
    ),
  );

  return perProvider
    .flat()
    .map((snippet, index) => ({ ...snippet, id: `ctx-${index + 1}` }));
}

async function readProviderSnippets(
  provider: ContextProvider,
  query: ContextQuery,
  log: Log,
  timeoutMs: number,
  graceMs: number,
): Promise<ProviderSnippet[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const outcome:
      | Result<ProviderSnippet[], ContextReadFailure>
      | typeof TIMED_OUT = await Promise.race([
      provider.fetch(query, { log, signal: controller.signal }),
      resolveAfterAbort(controller.signal, graceMs),
    ]);
    if (outcome === TIMED_OUT) {
      log(
        `context: provider ${provider.providerId} timed out after ${timeoutMs} ms, skipping`,
      );
      return [];
    }
    if (!outcome.ok) {
      log(
        `context: provider ${provider.providerId} failed (${outcome.error.reason}: ${outcome.error.detail}), skipping`,
      );
      return [];
    }
    return outcome.value;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    log(`context: provider ${provider.providerId} threw (${reason}), skipping`);
    return [];
  } finally {
    clearTimeout(timer);
  }
}
