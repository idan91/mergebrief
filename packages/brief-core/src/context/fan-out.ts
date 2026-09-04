import type { Result } from "types";
import type { Log } from "../github/types";
import { TicketUnreadReasons } from "../types";
import type { TicketReference } from "./references";
import type {
  ContextProvider,
  ContextProviderDeps,
  ContextQuery,
  ContextReadFailure,
  ContextSnippet,
  PrimarySnippet,
  PrimaryTicketOutcome,
  ProviderSnippet,
} from "./types";

/** Above every provider's own budget, so a stuck socket cannot stall a brief. */
export const CONTEXT_PROVIDER_TIMEOUT_MS = 15_000;

export interface FetchContextSnippetsOptions {
  readonly timeoutMs?: number;
  /** How long an aborted provider may take to hand back what it completed. */
  readonly graceMs?: number;
  /**
   * A primary ticket supplied out of band (`--context <file>`, an eval
   * fixture): replaces the tracker read and is stamped as read.
   */
  readonly suppliedPrimary?: PrimarySnippet;
}

export interface ContextFetch {
  readonly links: ContextSnippet[];
  /** Absent when the PR references no ticket. */
  readonly primaryTicket?: PrimaryTicketOutcome;
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
 * results in provider order, numbering them `ctx-1..N`; alongside, read the
 * primary ticket through the provider that owns its tracker. Fail-open per
 * provider: a failure, a throw, or a timeout is logged and contributes
 * nothing; an unreadable primary is reported, never guessed. A brief must
 * still be producible from the diff alone. Fresh per generation, no cache.
 */
export async function fetchContextSnippets(
  query: ContextQuery,
  providers: readonly ContextProvider[],
  log: Log = () => {},
  options: FetchContextSnippetsOptions = {},
): Promise<ContextFetch> {
  const timeoutMs = options.timeoutMs ?? CONTEXT_PROVIDER_TIMEOUT_MS;
  const graceMs = options.graceMs ?? ABORT_GRACE_MS;

  const [perProvider, primaryTicket] = await Promise.all([
    Promise.all(
      providers.map((provider) =>
        readProviderSnippets(provider, query, log, timeoutMs, graceMs),
      ),
    ),
    readPrimaryTicket(query, providers, log, timeoutMs, graceMs, options),
  ]);

  const links = perProvider
    .flat()
    .map((snippet, index) => ({ ...snippet, id: `ctx-${index + 1}` }));
  if (primaryTicket === undefined) return { links };
  return { links, primaryTicket };
}

/**
 * A supplied primary carries the text and names its own tracker and key;
 * where the parser matched a reference, the location is the PR's fact.
 */
function attributeSupplied(
  supplied: PrimarySnippet,
  reference: TicketReference | undefined,
): PrimarySnippet {
  if (reference === undefined) return supplied;
  return { ...supplied, foundIn: reference.foundIn };
}

async function readPrimaryTicket(
  query: ContextQuery,
  providers: readonly ContextProvider[],
  log: Log,
  timeoutMs: number,
  graceMs: number,
  options: FetchContextSnippetsOptions,
): Promise<PrimaryTicketOutcome | undefined> {
  const reference = query.primary;
  if (options.suppliedPrimary !== undefined) {
    return {
      status: "read",
      snippet: attributeSupplied(options.suppliedPrimary, reference),
    };
  }
  if (reference === undefined) return undefined;

  const provider = providers.find((p) => p.tracker === reference.tracker);
  const readPrimary = provider?.readPrimary?.bind(provider);
  if (readPrimary === undefined) {
    return {
      status: "unread",
      reference,
      reason: TicketUnreadReasons.UNSUPPORTED,
      detail: `no provider reads ${reference.tracker} tickets here`,
    };
  }

  const outcome = await runWithinBudget(
    (deps) => readPrimary(reference, deps),
    log,
    timeoutMs,
    graceMs,
  );
  if (outcome === TIMED_OUT) {
    log(`context: primary ticket read timed out after ${timeoutMs} ms`);
    return {
      status: "unread",
      reference,
      reason: TicketUnreadReasons.TIMEOUT,
      detail: `no answer within ${timeoutMs} ms`,
    };
  }
  if (!outcome.ok) {
    log(
      `context: primary ticket unread (${outcome.error.reason}: ${outcome.error.detail})`,
    );
    return { status: "unread", reference, ...outcome.error };
  }
  return { status: "read", snippet: outcome.value };
}

/**
 * Run one provider call under its own abort signal and budget. A throw is a
 * provider bug; it is reported as a timeout-shaped failure rather than
 * failing the generation.
 */
async function runWithinBudget<T>(
  work: (deps: ContextProviderDeps) => Promise<Result<T, ContextReadFailure>>,
  log: Log,
  timeoutMs: number,
  graceMs: number,
): Promise<Result<T, ContextReadFailure> | typeof TIMED_OUT> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await Promise.race([
      work({ log, signal: controller.signal }),
      resolveAfterAbort(controller.signal, graceMs),
    ]);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      error: {
        reason: TicketUnreadReasons.TIMEOUT,
        detail: `threw: ${detail}`,
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

async function readProviderSnippets(
  provider: ContextProvider,
  query: ContextQuery,
  log: Log,
  timeoutMs: number,
  graceMs: number,
): Promise<ProviderSnippet[]> {
  const outcome = await runWithinBudget(
    (deps) => provider.fetch(query, deps),
    log,
    timeoutMs,
    graceMs,
  );
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
}
