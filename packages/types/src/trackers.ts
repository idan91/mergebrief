import type { ValueOf } from "./utils";

/** Which tracker a ticket lives in; the vocabulary the instance config and the brief both read. */
export const TicketTrackers = {
  GITHUB: "github",
  NOTION: "notion",
} as const;
export type TicketTracker = ValueOf<typeof TicketTrackers>;
