import { TicketTrackers, type TicketTracker } from "../tracker";
import { githubTracker } from "./github";
import { notionTracker } from "./notion";
import type { Tracker } from "./types";

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

export { githubTracker } from "./github";
export { notionTracker, parseNotionPageId } from "./notion";
export type { ReferenceHit, Tracker } from "./types";
