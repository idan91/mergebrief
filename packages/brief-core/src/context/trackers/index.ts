import type { Result } from "types";
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

const TRACKER_BY_KIND: Record<TicketTracker, Tracker> = {
  [TicketTrackers.GITHUB]: githubTracker,
  [TicketTrackers.NOTION]: notionTracker,
};

/** The tracker module behind a `tracker:` kind or a reference's `tracker`. */
export function getTracker(kind: TicketTracker): Tracker {
  return TRACKER_BY_KIND[kind];
}

/**
 * The one read a root runs: the repo's configured tracker, GitHub when the
 * repo names none. Refuses at boot when the root lacks what that tracker
 * needs.
 */
export function resolvePrimaryRead(
  tracker: TrackerConfig | undefined,
  root: TrackerRootDeps,
): Result<PrimaryRead, ConfigError> {
  return getTracker(tracker?.kind ?? TicketTrackers.GITHUB).createRead(root);
}

export { githubTracker } from "./github";
export { notionTracker, parseNotionPageId } from "./notion";
export type {
  PrimaryRead,
  ReferenceHit,
  Tracker,
  TrackerRootDeps,
} from "./types";
