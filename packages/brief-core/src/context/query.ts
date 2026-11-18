import type { ContextSourcesConfig } from "generators";
import type { Mutable } from "types/utils";
import { removeHiddenCharacters } from "../generation/untrusted-text";
import { collectTicketReferences, resolvePrimaryTicket } from "./references";
import { findJiraSite } from "./trackers/jira";
import type { TicketReferenceInput } from "./trackers/types";
import type { ContextQuery } from "./types";
import { extractVisibleText } from "./visible-text";

/**
 * What a root hands over: the PR text, what it can resolve, and the instance
 * config's `contextSources:` block, which names the Jira site.
 */
interface ContextQueryInput extends Omit<TicketReferenceInput, "jiraSite"> {
  readonly contextSources: ContextSourcesConfig;
}

/**
 * Derive the provider query from PR metadata: the ticket references are
 * collected and the primary resolved here, once per generation, before any
 * provider runs. Every extractor reads the text the reviewer sees, so
 * markup GitHub hides can pick no ticket and no link.
 */
export function buildContextQuery(input: ContextQueryInput): ContextQuery {
  const visible: Mutable<TicketReferenceInput> = {
    title: removeHiddenCharacters(input.title),
    body: extractVisibleText(input.body),
    branch: removeHiddenCharacters(input.branch),
    repo: input.repo,
    trackers: input.trackers,
    readable: input.readable,
  };
  const jiraSite = findJiraSite(input.contextSources);
  if (jiraSite !== undefined) {
    visible.jiraSite = jiraSite;
  }
  const references = collectTicketReferences(visible);
  const primary = resolvePrimaryTicket(
    references,
    input.trackers.map((tracker) => tracker.kind),
  );

  const query: Mutable<ContextQuery> = {
    title: visible.title,
    body: visible.body,
    headRef: visible.branch,
    repo: input.repo,
    trackers: input.trackers,
    references,
  };
  if (jiraSite !== undefined) {
    query.jiraSite = jiraSite;
  }
  if (primary !== undefined) {
    query.primary = primary;
  }
  return query;
}
