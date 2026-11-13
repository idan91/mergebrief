/**
 * Folder barrel for the ContextSource boundary: the query, the snippet, the
 * provider port, the fan-out, and the built-in providers.
 */
export type {
  ContextProvider,
  ContextQuery,
  ContextReadFailure,
  ContextSnippet,
  PrimarySnippet,
  PrimaryTicketOutcome,
} from "./types";
export { ContextProviderTypes } from "./types";
export {
  fetchContextSnippets,
  type ContextFetch,
  type FetchContextSnippetsOptions,
} from "./fan-out";
export { toPrimaryTicket } from "./primary";
export { createBuiltInContextProviders } from "./registry";
export { GitHubTransports, type InstallationIssueApi } from "./trackers/github";
export { buildContextQuery } from "./query";
export { NotionTransports } from "./trackers/notion";
export { JiraTransports } from "./trackers/jira";
export {
  checkConfiguredTrackerReads,
  listReadableTrackers,
  resolveTrackerReads,
  type SharedRootDeps,
  type TrackerReads,
  type TrackerRootDeps,
} from "./trackers";
