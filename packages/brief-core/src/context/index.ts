/**
 * Folder barrel for the ContextSource boundary: the query, the snippet, the
 * provider port, the fan-out, and the built-in providers.
 */
export type {
  ContextProvider,
  ContextProviderDeps,
  ContextProviderType,
  ContextQuery,
  ContextReadFailure,
  ContextSnippet,
  PrimarySnippet,
  PrimaryTicketOutcome,
  ProviderSnippet,
} from "./types";
export { ContextProviderTypes, MAX_SNIPPET_CHARS } from "./types";
export {
  fetchContextSnippets,
  type ContextFetch,
  type FetchContextSnippetsOptions,
} from "./fan-out";
export { toPrimaryTicket } from "./primary";
export { createBuiltInContextProviders } from "./registry";
export {
  createGitHubRead,
  GitHubTransports,
  readFailureForStatus,
  type GitHubTransport,
  type InstallationIssueApi,
  type IssueLocator,
  type IssueRecord,
} from "./trackers/github";
export { buildContextQuery } from "./query";
export { collectTicketReferences, resolvePrimaryTicket } from "./references";
export type { TicketReference, TicketReferenceInput } from "./trackers/types";
export {
  createNotionRead,
  NotionTransports,
  type NotionTransport,
} from "./trackers/notion";
export {
  checkConfiguredTrackerReads,
  listReadableTrackers,
  resolveTrackerReads,
  type PrimaryRead,
  type SharedRootDeps,
  type TrackerReads,
  type TrackerRootDeps,
} from "./trackers";
