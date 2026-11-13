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

/** Every tracker joins its header pieces with this separator. */
const HEADER_SEPARATOR = " · ";

/**
 * The tracker header without the title and key the card's first line
 * already shows. Every header opens with the title; a Notion or Jira
 * header also closes with the key.
 */
export function deriveTicketFacts(ticket: PrimaryTicket): string {
  const withoutTitle = dropLeadingPiece(ticket.header, ticket.title);
  return dropTrailingPiece(withoutTitle, ticket.key);
}

function dropLeadingPiece(header: string, piece: string): string {
  if (piece === "") {
    return header;
  }
  if (header === piece) {
    return "";
  }
  const prefix = `${piece}${HEADER_SEPARATOR}`;
  return header.startsWith(prefix) ? header.slice(prefix.length) : header;
}

function dropTrailingPiece(header: string, piece: string): string {
  if (piece === "") {
    return header;
  }
  if (header === piece) {
    return "";
  }
  const suffix = `${HEADER_SEPARATOR}${piece}`;
  return header.endsWith(suffix) ? header.slice(0, -suffix.length) : header;
}
