import {
  collectTicketReferences,
  resolvePrimaryTicket,
  type TicketReferenceInput,
} from "./references";
import type { ContextQuery } from "./types";

/**
 * Derive the provider query from PR metadata: the ticket references are
 * collected and the primary resolved here, once per generation, before any
 * provider runs.
 */
export function buildContextQuery(input: TicketReferenceInput): ContextQuery {
  const primary = resolvePrimaryTicket(
    collectTicketReferences(input),
    input.tracker?.kind,
  );

  const query: ContextQuery = {
    title: input.title,
    body: input.body,
    headRef: input.branch,
    repo: input.repo,
    tracker: input.tracker,
  };
  if (primary !== undefined) return { ...query, primary };
  return query;
}
