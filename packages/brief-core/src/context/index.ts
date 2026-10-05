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
  CONTEXT_PROVIDER_TIMEOUT_MS,
  fetchContextSnippets,
  type ContextFetch,
  type FetchContextSnippetsOptions,
} from "./fan-out";
export { toPrimaryTicket } from "./primary";
export { createBuiltInContextProviders } from "./registry";
export { extractLinks, isPublicUrl, urlContextProvider } from "./providers/url";
export {
  createGitHubRead,
  createGhTransport,
  createInstallationTransport,
  GitHubTransports,
  readFailureForStatus,
  renderIssueHeader,
  type GhExec,
  type GitHubTransport,
  type InstallationBounds,
  type InstallationIssueApi,
  type IssueLocator,
  type IssueRecord,
} from "./trackers/github";
export { buildContextQuery } from "./query";
export {
  collectTicketReferences,
  resolvePrimaryTicket,
  type TicketReference,
  type TicketReferenceInput,
  type TicketReferenceRepo,
} from "./references";
export {
  createNotionRead,
  createNotionHttpTransport,
  NotionTransports,
  type NotionFetch,
  type NotionHttpTransportOptions,
  type NotionSession,
  type NotionTransport,
} from "./trackers/notion";
export {
  TRACKERS,
  getTracker,
  githubTracker,
  notionTracker,
  parseNotionPageId,
  checkConfiguredTrackerReads,
  listReadableTrackers,
  resolveTrackerReads,
  type PrimaryRead,
  type ReferenceHit,
  type SharedRootDeps,
  type Tracker,
  type TrackerReads,
  type TrackerRootDeps,
  type TrackerTransports,
} from "./trackers";
export {
  MAX_TRACKERS,
  refineTrackerSettings,
  ReferenceLocations,
  resolveEffectiveTrackers,
  resolveTrackerConfigs,
  TicketTrackers,
  TrackerConfigSchema,
  TrackerListSchema,
  type ReferenceLocation,
  type TicketTracker,
  type TrackerConfig,
  type TrackerSettings,
} from "./tracker";
