import { TicketTrackers } from "types/trackers";
import type { Tracker } from "../types";
import { createNotionRead } from "./read";
import { canonicalizeNotionUrl, collectNotionReferences } from "./references";

/** The Notion tracker: syntax from `references.ts`, the port and its implementation from `transport.ts`, the read from `read.ts`. */
export const notionTracker: Tracker<typeof TicketTrackers.NOTION> = {
  kind: TicketTrackers.NOTION,
  collectReferences: collectNotionReferences,
  canonicalizeUrl: canonicalizeNotionUrl,
  createRead: createNotionRead,
};

export { createNotionRead } from "./read";
export {
  NotionTransports,
  type NotionHttpTransportOptions,
  type NotionTransport,
} from "./transport";
