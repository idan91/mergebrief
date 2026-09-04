import { PrimaryTicketStatuses, type PrimaryTicket } from "../types";
import type { PrimaryTicketOutcome } from "./types";

/** The stored `intentCheck.primaryTicket`, from what the fan-out found. */
export function toPrimaryTicket(outcome: PrimaryTicketOutcome): PrimaryTicket {
  if (outcome.status === PrimaryTicketStatuses.READ) {
    const { snippet } = outcome;
    return {
      key: snippet.key,
      url: snippet.source,
      tracker: snippet.tracker,
      foundIn: snippet.foundIn,
      title: snippet.title,
      header: snippet.header,
      status: PrimaryTicketStatuses.READ,
      reason: "",
    };
  }
  const { reference } = outcome;
  return {
    key: reference.key,
    url: reference.url,
    tracker: reference.tracker,
    foundIn: reference.foundIn,
    title: "",
    header: "",
    status: PrimaryTicketStatuses.UNREAD,
    reason: outcome.reason,
  };
}
