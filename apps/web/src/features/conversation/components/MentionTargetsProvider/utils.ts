import { MentionBounds, type MentionTargetsResponse } from "contract";

/** Long enough for one commit's bodies to register together, short enough to read as instant. */
export const MENTION_LOOKUP_WAIT_MS = 16;

/**
 * Distinct targets one repo's page asks about at most. Each lookup spends the
 * viewer's own GitHub budget, so text any participant writes asks about at
 * most this many, one call at a time; mentions beyond it stay plain text.
 */
export const MAX_LOOKED_UP_TARGETS = 200;

const NO_TARGETS: ReadonlySet<string> = new Set();

/** The lowercased targets GitHub shows the viewer in one repo. */
export interface ShownMentionTargets {
  readonly repoId: string;
  readonly targets: ReadonlySet<string>;
}

export interface MentionTargetBatcher {
  /** Queues a target for the next lookup; one asked before is a no-op. */
  readonly request: (target: string) => void;
}

export interface MentionTargetBatcherOptions {
  readonly resolve: (
    targets: readonly string[],
  ) => Promise<MentionTargetsResponse>;
  /** Called with the lowercased targets one lookup found; never for a failed one. */
  readonly onFound: (found: ReadonlySet<string>) => void;
  /** A failed lookup's targets stay plain text; this only reports it. */
  readonly onFailed: (error: unknown) => void;
}

/** The targets in lookups of at most the api's per-call bound. */
export function chunkMentionTargets(
  targets: readonly string[],
): readonly (readonly string[])[] {
  const chunks: string[][] = [];
  for (
    let start = 0;
    start < targets.length;
    start += MentionBounds.TARGETS_PER_CALL
  ) {
    chunks.push(targets.slice(start, start + MentionBounds.TARGETS_PER_CALL));
  }
  return chunks;
}

export function readFoundTargets(
  found: MentionTargetsResponse,
): ReadonlySet<string> {
  const targets = [...found.users, ...found.teams];
  const foundTargets = new Set(targets.map((target) => target.toLowerCase()));
  return foundTargets;
}

/** The repo's shown targets with `found` added; a target from another repo starts the set over. */
export function addShownTargets(
  previous: ShownMentionTargets,
  repoId: string,
  found: ReadonlySet<string>,
): ShownMentionTargets {
  const base = previous.repoId === repoId ? previous.targets : NO_TARGETS;
  const unchanged = found.size === 0 && base === previous.targets;
  if (unchanged) {
    return previous;
  }

  const targets = new Set([...base, ...found]);
  return { repoId, targets };
}

export function createShownMentionTargets(repoId: string): ShownMentionTargets {
  return { repoId, targets: NO_TARGETS };
}

/**
 * Collects targets for a short wait, then asks about each distinct one once,
 * case folded. A failed lookup leaves its targets asked: they stay plain
 * text for the page's life rather than retrying on every render.
 */
export function createMentionTargetBatcher(
  options: MentionTargetBatcherOptions,
): MentionTargetBatcher {
  const asked = new Set<string>();
  let queued: string[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lookups: Promise<void> = Promise.resolve();

  async function lookUp(chunk: readonly string[]) {
    try {
      const found = await options.resolve(chunk);
      options.onFound(readFoundTargets(found));
    } catch (error) {
      options.onFailed(error);
    }
  }

  function flush() {
    timer = undefined;
    const batch = queued;
    queued = [];
    // One lookup in flight at a time, so a page never queues the viewer's
    // other GitHub reads behind its own.
    for (const chunk of chunkMentionTargets(batch)) {
      lookups = lookups.then(() => lookUp(chunk));
    }
  }

  function request(target: string) {
    const key = target.toLowerCase();
    const capped = asked.size >= MAX_LOOKED_UP_TARGETS;
    const skipped = asked.has(key) || capped;
    if (skipped) {
      return;
    }

    asked.add(key);
    queued.push(key);
    timer ??= setTimeout(flush, MENTION_LOOKUP_WAIT_MS);
  }

  return { request };
}
