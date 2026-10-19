// The live read: before a row is listed or opened, GitHub is asked for its
// facts, then the row is served from the updated store. A url row has no
// other source; an installation row is read as a backstop for a webhook that
// never arrived. The request waits up to a ceiling; past it the stored rows
// are served and the read finishes in the background. Nothing here queues a
// generation.
import {
  getLiveReadKey,
  LIVE_READ_PAGE_SIZE,
  type LiveReadPage,
  type PullRequestFacts,
} from "github";
import {
  createLiveReadStore,
  type LiveReadBaseline,
  type LiveReadFacts,
  type LiveReadStore,
  type PullRequestRow,
  type PullRequestRowId,
  type RepoId,
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
  InboxReadSources,
  LiveReadDeps,
  LiveReadOutcome,
  PullRequestRead,
  PullRequestReadTarget,
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

/** The store each row of a read is written through: its own scope's. */
type RowStores = ReadonlyMap<PullRequestRowId, LiveReadStore>;

interface FlightResult {
  readonly outcome: LiveReadOutcome;
  readonly written: WrittenRows;
}

const NOTHING_WRITTEN: WrittenRows = new Map();

interface DueRow {
  readonly row: PullRequestRow;
  readonly store: LiveReadStore;
}

function isUrlRow(row: PullRequestRow): boolean {
  return row.installationId === null;
}

function getRowStore(stores: RowStores, row: PullRequestRow): LiveReadStore {
  const store = stores.get(row.id);
  if (store === undefined) {
    throw new Error(`live read row ${row.id} has no store`);
  }
  return store;
}

/** A url row has no other source, so it reads ahead of an installation row. */
function readSourceRank(row: PullRequestRow): number {
  if (isUrlRow(row)) {
    return 0;
  }
  return 1;
}

/** Url rows first, then never-read rows, then the oldest read, then the row id. */
function compareDue(left: DueRow, right: DueRow): number {
  const rankGap = readSourceRank(left.row) - readSourceRank(right.row);
  if (rankGap !== 0) {
    return rankGap;
  }
  const leftReadAt = left.row.githubReadAt?.getTime() ?? -Infinity;
  const rightReadAt = right.row.githubReadAt?.getTime() ?? -Infinity;
  if (leftReadAt < rightReadAt) {
    return -1;
  }
  if (leftReadAt > rightReadAt) {
    return 1;
  }
  if (left.row.id < right.row.id) {
    return -1;
  }
  return 1;
}

async function listStoreDue(
  store: LiveReadStore,
  now: Date,
  limit: number,
  repoIds?: readonly RepoId[],
): Promise<DueRow[]> {
  const rows = await store.listDue({
    now,
    staleMs: LIVE_READ_STALE_MS,
    limit,
    repoIds,
  });
  return rows.map((row) => ({ row, store }));
}

/**
 * Read the due rows of one Inbox load, up to the chunk cap across every
 * source: the reader's own url rows first, then each installation's rows in
 * the repositories the reader's token can see, stalest first. One cap for
 * the load, since the reader's GraphQL calls queue one at a time.
 */
export async function readInboxRowsLive(
  deps: LiveReadDeps,
  sources: InboxReadSources,
): Promise<LiveReadOutcome> {
  const now = deps.now?.() ?? new Date();
  if (isCoolingDown(deps, now)) {
    return { ...NOTHING_READ, failed: true };
  }
  const cap = LIVE_READ_PAGE_SIZE * LIVE_READ_MAX_CHUNKS;
  const { ownerUserId } = sources;
  const ownerStore = createLiveReadStore(deps.handle, { ownerUserId });
  const listings = [listStoreDue(ownerStore, now, cap + 1)];
  for (const [installationId, repoIds] of sources.reposByInstallation) {
    const store = createLiveReadStore(deps.handle, { installationId });
    listings.push(listStoreDue(store, now, cap + 1, repoIds));
  }
  const listed = await Promise.all(listings);

  const due = listed.flat().toSorted(compareDue);
  const chosen = due.slice(0, cap);
  const stores = new Map(chosen.map((entry) => [entry.row.id, entry.store]));
  const plan = planReadTargets(chosen.map((entry) => entry.row));
  const deferred = due.length > cap;
  const key = `inbox:${ownerUserId}`;
  const result = await readWithinCeiling(
    deps,
    stores,
    plan,
    now,
    deferred,
    key,
  );
  return result.outcome;
}

/**
 * Read one row, when it is due. The row is addressed by the name the gate
 * verified for its repository id, never the stored label, which a rename
 * plus name reuse can point elsewhere.
 */
export async function readPullRequestRowLive(
  deps: LiveReadDeps,
  target: PullRequestReadTarget,
): Promise<PullRequestRead> {
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

  const stores = new Map([[row.id, createLiveReadStore(deps.handle, scope)]]);
  const plan = {
    targets: [{ row, ref: { ...verified, prNumber: row.prNumber } }],
    unaddressable: [],
  };
  const flightKey = `row:${row.id}`;
  const read = await readWithinCeiling(
    deps,
    stores,
    plan,
    now,
    false,
    flightKey,
  );
  return { outcome: read.outcome, row: read.written.get(row.id) ?? row };
}

/**
 * Reads in flight per reader and Inbox load or row. A read that outlives a
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

/** The stores, keeping the row each write returns in `written`. */
function keepWrittenRows(
  stores: RowStores,
  written: Map<PullRequestRowId, PullRequestRow>,
): RowStores {
  async function keep(
    write: Promise<PullRequestRow | undefined>,
  ): Promise<PullRequestRow | undefined> {
    const row = await write;
    if (row !== undefined) {
      written.set(row.id, row);
    }
    return row;
  }
  const kept = new Map<LiveReadStore, LiveReadStore>();
  for (const store of new Set(stores.values())) {
    kept.set(store, {
      ...store,
      record: (id, facts, baseline) => keep(store.record(id, facts, baseline)),
      stampAttempt: (id, readAt) => keep(store.stampAttempt(id, readAt)),
      markUnreachable: (id, readAt) => keep(store.markUnreachable(id, readAt)),
    });
  }
  const keeping = new Map<PullRequestRowId, LiveReadStore>();
  for (const [rowId, store] of stores) {
    keeping.set(rowId, kept.get(store) ?? store);
  }
  return keeping;
}

function startRead(
  deps: LiveReadDeps,
  stores: RowStores,
  plan: ReadPlan,
  now: Date,
  deferred: boolean,
): Promise<FlightResult> {
  const written = new Map<PullRequestRowId, PullRequestRow>();
  // A throw inside the read is the same failure as a refusal: the stored
  // rows are served, and the foreground and background paths agree.
  return readPlan(deps, keepWrittenRows(stores, written), plan, now)
    .then((outcome) => ({ outcome: { ...outcome, deferred }, written }))
    .catch((error: unknown) => {
      deps.log.warn("live read failed, serving stored rows", { err: error });
      const outcome = { ...NOTHING_READ, deferred, failed: true };
      return { outcome, written };
    });
}

async function readWithinCeiling(
  deps: LiveReadDeps,
  stores: RowStores,
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
    work = startRead(deps, stores, plan, now, deferred);
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
  stores: RowStores,
  plan: ReadPlan,
  now: Date,
): Promise<LiveReadOutcome> {
  // A row with no usable slug: nothing can be asked about it, and stamping
  // it keeps it from leading every read.
  const unreachable = await settleMissingRows(stores, plan.unaddressable, now);
  const chunks = splitChunks(plan.targets, LIVE_READ_PAGE_SIZE);
  const outcomes = await Promise.all(
    chunks.map((chunk) => readChunk(deps, stores, chunk, now)),
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
  stores: RowStores,
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

  const recorded = await recordPage(stores, chunk, page.value, now);
  const retried = await retryUnderFallback(deps, stores, recorded, now);
  const unreachable = await settleMissingRows(
    stores,
    retried.missing.map((target) => target.row),
    now,
  );
  const unanswered = retried.unanswered;
  await runInBatches(unanswered, LIVE_READ_WRITE_WIDTH, (target) =>
    getRowStore(stores, target.row).stampAttempt(target.row.id, now),
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

/**
 * Rows GitHub showed nothing for. A url row is marked unreachable; an
 * installation row only waits the window, since a reader's token missing it
 * says nothing about the webhooks that keep it. Returns the count marked.
 */
async function settleMissingRows(
  stores: RowStores,
  rows: readonly PullRequestRow[],
  now: Date,
): Promise<number> {
  const settled = await runInBatches(
    rows,
    LIVE_READ_WRITE_WIDTH,
    async (row) => {
      const store = getRowStore(stores, row);
      if (!isUrlRow(row)) {
        await store.stampAttempt(row.id, now);
        return undefined;
      }
      return store.markUnreachable(row.id, now);
    },
  );
  const marked = settled.filter((row) => row !== undefined);
  return marked.length;
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
  stores: RowStores,
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
    ({ target, facts }) => {
      const store = getRowStore(stores, target.row);
      const shaped = shapeFacts(facts, now);
      return store.record(target.row.id, shaped, shapeBaseline(target.row));
    },
  );
  const read = recorded.filter((row) => row !== undefined).length;
  return { read, missing, unanswered };
}

function isUrlTarget(target: ReadTarget): boolean {
  return isUrlRow(target.row);
}

/**
 * The url rows the viewer's token could not see or was refused, once more on
 * the operator PAT: a brief generated through the PAT would otherwise read as
 * unreachable forever. A rejected PAT leaves the viewer's answer standing, a
 * row the viewer was refused is never marked on the PAT's word alone, and an
 * installation row never reaches the PAT.
 */
async function retryUnderFallback(
  deps: LiveReadDeps,
  stores: RowStores,
  recorded: RecordedPage,
  now: Date,
): Promise<RecordedPage> {
  const unseen = [...recorded.missing, ...recorded.unanswered];
  const targets = unseen.filter(isUrlTarget);
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

  const retried = await recordPage(stores, targets, page.value, now);
  const missingForViewer = new Set(
    recorded.missing.map((target) => target.row.id),
  );
  const missing = retried.missing.filter((target) =>
    missingForViewer.has(target.row.id),
  );
  const refused = retried.missing.filter(
    (target) => !missingForViewer.has(target.row.id),
  );
  const keptMissing = recorded.missing.filter((target) => !isUrlTarget(target));
  const keptUnanswered = recorded.unanswered.filter(
    (target) => !isUrlTarget(target),
  );
  return {
    read: retried.read,
    missing: [...keptMissing, ...missing],
    unanswered: [...keptUnanswered, ...retried.unanswered, ...refused],
  };
}

function shapeBaseline(row: PullRequestRow): LiveReadBaseline {
  return { rowVersion: row.rowVersion };
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
