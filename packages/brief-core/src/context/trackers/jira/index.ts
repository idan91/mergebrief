import { TicketTrackers } from "types/trackers";
import type { Tracker } from "../types";
import { createJiraRead } from "./read";
import { canonicalizeJiraUrl, collectJiraReferences } from "./references";

/** The Jira tracker: syntax from `references.ts`, the port and its implementation from `transport/`, the read from `read/`. */
export const jiraTracker: Tracker<typeof TicketTrackers.JIRA> = {
  kind: TicketTrackers.JIRA,
  collectReferences: collectJiraReferences,
  canonicalizeUrl: canonicalizeJiraUrl,
  createRead: createJiraRead,
};

export { createJiraRead } from "./read";
export { findJiraSite } from "./references";
export { JiraTransports } from "./transport";
