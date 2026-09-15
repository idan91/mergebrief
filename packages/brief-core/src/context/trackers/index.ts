import type { Result } from "types/utils";
import type { ConfigError } from "generators";
import {
  TicketTrackers,
  type TicketTracker,
  type TrackerConfig,
} from "../tracker";
import { githubTracker } from "./github";
import { notionTracker } from "./notion";
import type { PrimaryRead, Tracker, TrackerRootDeps } from "./types";

/** Every tracker the parser scans for, in scan order. Adding one is a module plus a line here. */
export const TRACKERS: readonly Tracker[] = [githubTracker, notionTracker];

const TRACKER_BY_KIND: { readonly [Kind in TicketTracker]: Tracker<Kind> } = {
  [TicketTrackers.GITHUB]: githubTracker,
  [TicketTrackers.NOTION]: notionTracker,
};

/** The tracker module behind a `tracker:` kind or a reference's `tracker`. */
export function getTracker<Kind extends TicketTracker>(
  kind: Kind,
): Tracker<Kind> {
  return TRACKER_BY_KIND[kind];
}

/** One tracker's read for one root: its own slot handed over, the same way for every kind. */
function createTrackerRead(
  kind: TicketTracker,
  root: TrackerRootDeps,
): Result<PrimaryRead, ConfigError> {
  return getTracker(kind).createRead(root, root.transports[kind]);
}

/**
 * Boot-time check for a root: every tracker the instance config lists must
 * be able to build its read here, so an unset token refuses boot like a
 * missing generator key instead of surfacing job by job.
 */
export function checkConfiguredTrackerReads(
  root: TrackerRootDeps,
): Result<void, ConfigError> {
  for (const entry of root.contextSources) {
    const read = createTrackerRead(entry.type, root);
    if (!read.ok) return read;
  }
  return { ok: true, value: undefined };
}

/** The reads a root runs, one per tracker it can read; a primary dispatches to its own tracker's. */
export type TrackerReads = {
  readonly [Kind in TicketTracker]?: PrimaryRead | undefined;
};

/** The trackers a reads map can read, in registry order; what the parser treats as tickets. */
export function listReadableTrackers(reads: TrackerReads): TicketTracker[] {
  return TRACKERS.map((tracker) => tracker.kind).filter(
    (kind) => reads[kind] !== undefined,
  );
}

/**
 * One read per slot the root binds; a tracker the root does not bind is
 * never a read, so its references stay text. A bound slot that cannot
 * build (a Notion slot with no token on this deployment) refuses when it is
 * the repo's tracker, GitHub when the repo names none, and is otherwise
 * simply not a read.
 */
export function resolveTrackerReads(
  trackers: readonly TrackerConfig[],
  root: TrackerRootDeps,
): Result<TrackerReads, ConfigError> {
  const configured = new Set<TicketTracker>(
    trackers.map((tracker) => tracker.kind),
  );
  if (configured.size === 0) configured.add(TicketTrackers.GITHUB);
  const reads: { [Kind in TicketTracker]?: PrimaryRead | undefined } = {};

  for (const { kind } of TRACKERS) {
    if (root.transports[kind] === undefined) continue;
    const read = createTrackerRead(kind, root);
    if (read.ok) {
      reads[kind] = read.value;
    } else if (configured.has(kind)) {
      return read;
    }
  }
  return { ok: true, value: reads };
}

export { githubTracker } from "./github";
export { notionTracker, parseNotionPageId } from "./notion";
export type {
  PrimaryRead,
  ReferenceHit,
  SharedRootDeps,
  Tracker,
  TrackerRootDeps,
  TrackerTransports,
} from "./types";
