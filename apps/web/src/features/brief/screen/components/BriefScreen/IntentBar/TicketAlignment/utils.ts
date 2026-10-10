import type { PrimaryTicket } from "brief-core/types";

/**
 * The ticket link's visible text: the key; the title for a URL-only
 * reference; the URL itself when both are empty (an unread URL-only
 * reference), so the link never renders nameless.
 */
export function deriveTicketLinkText(ticket: PrimaryTicket): string {
  if (ticket.key !== "") {
    return ticket.key;
  }
  if (ticket.title !== "") {
    return ticket.title;
  }
  return ticket.url;
}
