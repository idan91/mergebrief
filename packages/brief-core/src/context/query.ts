import { collectTicketReferences, resolvePrimaryTicket } from "./references";
import type { TicketReferenceInput } from "./trackers/types";
import type { ContextQuery } from "./types";

/**
 * Derive the provider query from PR metadata: the ticket references are
 * collected and the primary resolved here, once per generation, before any
 * provider runs.
 */
export function buildContextQuery(input: TicketReferenceInput): ContextQuery {
  const references = collectTicketReferences(input);
  const primary = resolvePrimaryTicket(
    references,
    input.trackers.map((tracker) => tracker.kind),
  );

  const query: ContextQuery = {
    title: input.title,
    body: input.body,
    headRef: input.branch,
    repo: input.repo,
    trackers: input.trackers,
    references,
  };
  if (primary !== undefined) return { ...query, primary };
  return query;
}
