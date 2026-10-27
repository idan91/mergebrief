import { removeHiddenCharacters } from "../generation/untrusted-text";
import { collectTicketReferences, resolvePrimaryTicket } from "./references";
import type { TicketReferenceInput } from "./trackers/types";
import type { ContextQuery } from "./types";
import { extractVisibleText } from "./visible-text";

/**
 * Derive the provider query from PR metadata: the ticket references are
 * collected and the primary resolved here, once per generation, before any
 * provider runs. Every extractor reads the text the reviewer sees, so
 * markup GitHub hides can pick no ticket and no link.
 */
export function buildContextQuery(input: TicketReferenceInput): ContextQuery {
  const visible: TicketReferenceInput = {
    ...input,
    title: removeHiddenCharacters(input.title),
    body: extractVisibleText(input.body),
    branch: removeHiddenCharacters(input.branch),
  };
  const references = collectTicketReferences(visible);
  const primary = resolvePrimaryTicket(
    references,
    input.trackers.map((tracker) => tracker.kind),
  );

  const query: ContextQuery = {
    title: visible.title,
    body: visible.body,
    headRef: visible.branch,
    repo: input.repo,
    trackers: input.trackers,
    references,
  };
  if (primary !== undefined) {
    return { ...query, primary };
  }
  return query;
}
