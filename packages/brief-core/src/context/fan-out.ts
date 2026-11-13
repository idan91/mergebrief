import type { Result } from "types/utils";
import type { Log } from "../github/types";
import { TicketUnreadReasons } from "../types";
import { resolvePrimaryTicket } from "./references";
import type { TrackerReads } from "./trackers";
import type { PrimaryRead, TicketReference } from "./trackers/types";
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
  /** The root's reads by tracker; a primary whose tracker has none is reported unread. */
  readonly reads?: TrackerReads | undefined;
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
 * primary ticket through the root's one tracker read. Fail-open per
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
    readPrimaryTicket(query, log, timeoutMs, graceMs, options),
  ]);

  const links = perProvider
    .flat()
    .map((snippet, index) => ({ ...snippet, id: `ctx-${index + 1}` }));
  if (primaryTicket === undefined) {
    return { links };
  }
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
  if (reference === undefined) {
    return supplied;
  }
  return { ...supplied, foundIn: reference.foundIn };
}

/** How many references are tried when the primary turns out not to be a ticket. */
const MAX_PRIMARY_CANDIDATES = 5;

async function readPrimaryTicket(
  query: ContextQuery,
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
  if (reference === undefined) {
    return undefined;
  }

  const reads = options.reads ?? {};
  if (reads[reference.tracker] === undefined) {
    return {
      status: "unread",
      reference,
      reason: TicketUnreadReasons.UNSUPPORTED,
      detail: `no ${reference.tracker} read on this deployment`,
    };
  }

  // Each candidate is read by its own tracker; references to a tracker this
  // root cannot read stay text. A reference that resolves to a pull request
  // is not a ticket: it is skipped and the next reference becomes the
  // primary by the rule that picked the first. A primary on one of the
  // repo's trackers ranks them all first; any other primary ranks its own
  // tracker first, as a repo listing none ranks GitHub. Every candidate
  // shares the one budget, so the phase never outlives a single read.
  let remainingReferences = query.references.filter(
    (candidate) => reads[candidate.tracker] !== undefined,
  );
  const ownTrackers = query.trackers.map((tracker) => tracker.kind);
  const rankedTrackers = ownTrackers.includes(reference.tracker)
    ? ownTrackers
    : [reference.tracker];
  const deadline = Date.now() + timeoutMs;
  for (let tried = 0; tried < MAX_PRIMARY_CANDIDATES; tried += 1) {
    const candidate = resolvePrimaryTicket(remainingReferences, rankedTrackers);
    const read = candidate === undefined ? undefined : reads[candidate.tracker];
    if (candidate === undefined || read === undefined) {
      return undefined;
    }
    remainingReferences = remainingReferences.filter((r) => r !== candidate);
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      return {
        status: "unread",
        reference: candidate,
        reason: TicketUnreadReasons.TIMEOUT,
        detail: `no answer within ${timeoutMs} ms`,
      };
    }
    const outcome = await readCandidate(
      candidate,
      read,
      log,
      remaining,
      graceMs,
    );
    const skipped =
      outcome.status === "unread" && outcome.resolvedToPullRequest === true;
    if (!skipped) {
      return outcome;
    }
    log(`context: ${candidate.url} is not a ticket, trying the next reference`);
  }
  return undefined;
}

async function readCandidate(
  reference: TicketReference,
  read: PrimaryRead,
  log: Log,
  timeoutMs: number,
  graceMs: number,
): Promise<PrimaryTicketOutcome & { resolvedToPullRequest?: true }> {
  const outcome = await runWithinBudget(
    (deps) => read.readPrimary(reference, deps),
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
    const unread: PrimaryTicketOutcome & { resolvedToPullRequest?: true } = {
      status: "unread",
      reference,
      reason: outcome.error.reason,
      detail: outcome.error.detail,
    };
    if (outcome.error.resolvedToPullRequest === true) {
      unread.resolvedToPullRequest = true;
    }
    return unread;
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
