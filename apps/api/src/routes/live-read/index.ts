// The live read: before a url row is listed or opened, GitHub is asked for
// its facts, then the row is served from the updated store. The request
// waits up to a ceiling; past it the stored rows are served and the read
// finishes in the background. Nothing here queues a generation.
import {
  getLiveReadKey,
  LIVE_READ_PAGE_SIZE,
  type LiveReadPage,
  type PullRequestFacts,
} from "github";
import {
  createLiveReadStore,
  type LiveReadFacts,
  type LiveReadStore,
  type PullRequestRow,
  type PullRequestRowId,
  type ReviewerId,
} from "persistence";
import {
  LIVE_READ_MAX_CHUNKS,
  LIVE_READ_STALE_MS,
  LIVE_READ_WAIT_MS,
  LIVE_READ_WRITE_WIDTH,
} from "./consts";
import {
  isDue,
  planReadTargets,
  splitChunks,
  type ReadPlan,
  type ReadTarget,
} from "./logic/due";
import type { Mutable } from "types/utils";
import { runInBatches } from "../batches";
import { parseOwnerAndName } from "../repos/utils";
import { deriveLifecycle } from "./logic/lifecycle";
import type {
  LiveReadDeps,
  LiveReadOutcome,
  UrlRowRead,
  UrlRowTarget,
} from "./types";

const NOTHING_READ: LiveReadOutcome = {
  read: 0,
  unreachable: 0,
  deferred: false,
  timedOut: false,
  failed: false,
};

/**
 * Readers whose last read GitHub refused, and until when their next one
 * waits. A refusal stamps no row, so without this the next request would
 * ask again at once; the same window a good read earns applies. Keyed by
 * the credential refused, not the row owner: on brief open the reader may
 * be another user, whose token failing is no reason to freeze the owner.
 */
const cooldownUntil = new Map<string, number>();

function readerKey(deps: LiveReadDeps): string {
  return String(deps.readerId);
}

function isCoolingDown(deps: LiveReadDeps, now: Date): boolean {
  const until = cooldownUntil.get(readerKey(deps));
  return until !== undefined && until > now.getTime();
}

/** The rows a read wrote, each as its write returned it. */
type WrittenRows = ReadonlyMap<PullRequestRowId, PullRequestRow>;

interface FlightResult {
  readonly outcome: LiveReadOutcome;
  readonly written: WrittenRows;
}

const NOTHING_WRITTEN: WrittenRows = new Map();

/** Read every due url row of the owner, up to the chunk cap. */
export async function refreshUrlPullRequests(
  deps: LiveReadDeps,
  ownerUserId: ReviewerId,
): Promise<LiveReadOutcome> {
  const now = deps.now?.() ?? new Date();
  if (isCoolingDown(deps, now)) {
    return { ...NOTHING_READ, failed: true };
  }
  const store = createLiveReadStore(deps.handle, { ownerUserId });
  const cap = LIVE_READ_PAGE_SIZE * LIVE_READ_MAX_CHUNKS;
  const due = await store.listDue({
    now,
    staleMs: LIVE_READ_STALE_MS,
    limit: cap + 1,
  });
  const deferred = due.length > cap;

  const plan = planReadTargets(due.slice(0, cap));
  const result = await readWithinCeiling(
    deps,
    store,
    plan,
    now,
    deferred,
    String(ownerUserId),
  );
  return result.outcome;
}

/**
 * Read one url row of the owner, when it is due. The row is addressed by
 * the name the gate verified for its repository id, never the stored label,
 * which a rename plus name reuse can point elsewhere.
 */
export async function refreshUrlPullRequest(
  deps: LiveReadDeps,
  target: UrlRowTarget,
): Promise<UrlRowRead> {
  const { row, scope } = target;
  const now = deps.now?.() ?? new Date();
  if (isCoolingDown(deps, now)) {
    return { outcome: { ...NOTHING_READ, failed: true }, row };
  }
  if (!isDue(row, now, LIVE_READ_STALE_MS)) {
    return { outcome: NOTHING_READ, row };
  }
  const verified = parseOwnerAndName(target.repoFullName);
  if (verified === undefined) {
    return { outcome: NOTHING_READ, row };
  }

  const store = createLiveReadStore(deps.handle, scope);
  const plan = {
    targets: [{ row, ref: { ...verified, prNumber: row.prNumber } }],
    unaddressable: [],
  };
  const flightKey = `${scope.ownerUserId}:${row.id}`;
  const read = await readWithinCeiling(
    deps,
    store,
    plan,
    now,
    false,
    flightKey,
  );
  return { outcome: read.outcome, row: read.written.get(row.id) ?? row };
}

/**
 * Reads in flight per reader and owner or row. A read that outlives a
 * caller's ceiling keeps running; the same reader arriving meanwhile (the
 * meta poll, a second tab) joins it instead of asking GitHub again for rows
 * still marked due. Another reader runs its own token: one token's refusal
 * must not stand as the answer for a stronger one.
 */
const inFlight = new Map<string, Promise<FlightResult>>();

/** Test seam: forget in-flight reads and cooldowns between cases. */
export function resetLiveReadMemory(): void {
  inFlight.clear();
  cooldownUntil.clear();
}

/** The store, keeping the row each write returns in `written`. */
function keepWrittenRows(
  store: LiveReadStore,
  written: Map<PullRequestRowId, PullRequestRow>,
): LiveReadStore {
  async function keep(
    write: Promise<PullRequestRow | undefined>,
  ): Promise<PullRequestRow | undefined> {
    const row = await write;
    if (row !== undefined) {
      written.set(row.id, row);
    }
    return row;
  }
  return {
    ...store,
    record: (id, facts) => keep(store.record(id, facts)),
    stampAttempt: (id, readAt) => keep(store.stampAttempt(id, readAt)),
    markUnreachable: (id, readAt) => keep(store.markUnreachable(id, readAt)),
  };
}

function startRead(
  deps: LiveReadDeps,
  store: LiveReadStore,
  plan: ReadPlan,
  now: Date,
  deferred: boolean,
): Promise<FlightResult> {
  const written = new Map<PullRequestRowId, PullRequestRow>();
  // A throw inside the read is the same failure as a refusal: the stored
  // rows are served, and the foreground and background paths agree.
  return readPlan(deps, keepWrittenRows(store, written), plan, now)
    .then((outcome) => ({ outcome: { ...outcome, deferred }, written }))
    .catch((error: unknown) => {
      deps.log.warn("live read failed, serving stored rows", { err: error });
      const outcome = { ...NOTHING_READ, deferred, failed: true };
      return { outcome, written };
    });
}

async function readWithinCeiling(
  deps: LiveReadDeps,
  store: LiveReadStore,
  plan: ReadPlan,
  now: Date,
  deferred: boolean,
  key: string,
): Promise<FlightResult> {
  const rowCount = plan.targets.length + plan.unaddressable.length;
  if (rowCount === 0) {
    return { outcome: { ...NOTHING_READ, deferred }, written: NOTHING_WRITTEN };
  }

  const flightKey = `${readerKey(deps)}:${key}`;
  let work = inFlight.get(flightKey);
  if (work === undefined) {
    work = startRead(deps, store, plan, now, deferred);
    inFlight.set(flightKey, work);
    void work.finally(() => inFlight.delete(flightKey));
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const ceiling = new Promise<undefined>((resolve) => {
    timer = setTimeout(
      () => resolve(undefined),
      deps.waitMs ?? LIVE_READ_WAIT_MS,
    );
  });
  const first = await Promise.race([work, ceiling]);
  clearTimeout(timer);
  if (first !== undefined) {
    return first;
  }

  deps.log.warn("live read past its ceiling, serving stored rows", {
    rows: rowCount,
  });
  const outcome = { ...NOTHING_READ, deferred, timedOut: true };
  return { outcome, written: NOTHING_WRITTEN };
}

/** The chunks read side by side, so three pages fit under one ceiling. */
async function readPlan(
  deps: LiveReadDeps,
  store: LiveReadStore,
  plan: ReadPlan,
  now: Date,
): Promise<LiveReadOutcome> {
  // A row with no usable slug is unreachable in every sense: nothing can be
  // asked about it, and stamping it keeps it from leading every read.
  const marked = await runInBatches(
    plan.unaddressable,
    LIVE_READ_WRITE_WIDTH,
    (row) => store.markUnreachable(row.id, now),
  );
  const unreachable = marked.filter((row) => row !== undefined).length;
  const chunks = splitChunks(plan.targets, LIVE_READ_PAGE_SIZE);
  const outcomes = await Promise.all(
    chunks.map((chunk) => readChunk(deps, store, chunk, now)),
  );
  const total = outcomes.reduce(
    (sum, outcome) => ({
      ...sum,
      read: sum.read + outcome.read,
      unreachable: sum.unreachable + outcome.unreachable,
      failed: sum.failed || outcome.failed,
    }),
    { ...NOTHING_READ, unreachable },
  );
  if (total.failed) {
    cooldownUntil.set(readerKey(deps), now.getTime() + LIVE_READ_STALE_MS);
  }
  return total;
}

async function readChunk(
  deps: LiveReadDeps,
  store: LiveReadStore,
  chunk: readonly ReadTarget[],
  now: Date,
): Promise<LiveReadOutcome> {
  const page = await deps.github.readPullRequestFacts(
    chunk.map((target) => target.ref),
  );
  if (!page.ok) {
    deps.log.warn("live read refused by GitHub, serving stored rows", {
      code: page.error.code,
    });
    return { ...NOTHING_READ, failed: true };
  }

  const recorded = await recordPage(store, chunk, page.value, now);
  const retried = await retryUnderFallback(deps, store, recorded, now);
  const marked = await runInBatches(
    retried.missing,
    LIVE_READ_WRITE_WIDTH,
    (target) => store.markUnreachable(target.row.id, now),
  );
  const unreachable = marked.filter((row) => row !== undefined).length;
  const unanswered = retried.unanswered;
  await runInBatches(unanswered, LIVE_READ_WRITE_WIDTH, (target) =>
    store.stampAttempt(target.row.id, now),
  );
  if (unanswered.length > 0) {
    deps.log.warn("live read left rows unanswered until the next window", {
      rows: unanswered.length,
    });
  }
  return {
    ...NOTHING_READ,
    read: recorded.read + retried.read,
    unreachable,
  };
}

interface RecordedPage {
  /** Rows the store took the facts for. */
  readonly read: number;
  /** Targets GitHub showed nothing for. */
  readonly missing: readonly ReadTarget[];
  /** Targets GitHub withheld: stamped, never marked. */
  readonly unanswered: readonly ReadTarget[];
}

async function recordPage(
  store: LiveReadStore,
  targets: readonly ReadTarget[],
  page: LiveReadPage,
  now: Date,
): Promise<RecordedPage> {
  const missing: ReadTarget[] = [];
  const unanswered: ReadTarget[] = [];
  const answered: { target: ReadTarget; facts: PullRequestFacts }[] = [];
  for (const target of targets) {
    const facts = page.get(getLiveReadKey(target.ref));
    if (facts === undefined) {
      unanswered.push(target);
      continue;
    }
    // A name asked from the stored label may resolve to another repository
    // after a rename and reuse; the immutable id decides whether the facts
    // belong to this row.
    if (facts === null || facts.repoId !== target.row.repoId) {
      missing.push(target);
      continue;
    }
    answered.push({ target, facts });
  }
  const recorded = await runInBatches(
    answered,
    LIVE_READ_WRITE_WIDTH,
    ({ target, facts }) => store.record(target.row.id, shapeFacts(facts, now)),
  );
  const read = recorded.filter((row) => row !== undefined).length;
  return { read, missing, unanswered };
}

/**
 * The rows the viewer's token could not see or was refused, once more on the
 * operator PAT: a brief generated through the PAT would otherwise read as
 * unreachable forever. A rejected PAT leaves the viewer's answer standing,
 * and a row the viewer was refused is never marked on the PAT's word alone.
 */
async function retryUnderFallback(
  deps: LiveReadDeps,
  store: LiveReadStore,
  recorded: RecordedPage,
  now: Date,
): Promise<RecordedPage> {
  const targets = [...recorded.missing, ...recorded.unanswered];
  const standing = { ...recorded, read: 0 };
  if (targets.length === 0 || deps.operator === undefined) {
    return standing;
  }

  const page = await deps.operator.readPullRequestFacts(
    targets.map((target) => target.ref),
  );
  if (!page.ok) {
    deps.log.warn("live read fallback token rejected by GitHub", {
      code: page.error.code,
    });
    return standing;
  }

  const retried = await recordPage(store, targets, page.value, now);
  const missingForViewer = new Set(
    recorded.missing.map((target) => target.row.id),
  );
  const missing = retried.missing.filter((target) =>
    missingForViewer.has(target.row.id),
  );
  const refused = retried.missing.filter(
    (target) => !missingForViewer.has(target.row.id),
  );
  return {
    read: retried.read,
    missing,
    unanswered: [...retried.unanswered, ...refused],
  };
}

function shapeFacts(facts: PullRequestFacts, now: Date): LiveReadFacts {
  const shaped: Mutable<LiveReadFacts> = {
    readAt: now,
    headSha: facts.headSha,
    repoSlug: facts.repoFullName,
    title: facts.title,
    draft: facts.draft,
    githubUpdatedAt: facts.updatedAt,
    lifecycle: deriveLifecycle(facts, now),
  };
  if (facts.authorLogin !== null) {
    shaped.authorLogin = facts.authorLogin;
  }
  return shaped;
}
