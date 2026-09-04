/**
 * Folder barrel for the ContextSource boundary: the query, the snippet, the
 * provider port, the fan-out, and the registry of provider types.
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
export {
  BUILT_IN_CONTEXT_PROVIDER_TYPES,
  CONTEXT_REGISTRY,
  EgressTiers,
  createBuiltInContextProviders,
  type EgressTier,
} from "./registry";
export { extractLinks, isPublicUrl, urlContextProvider } from "./providers/url";
export {
  createGitHubRead,
  readFailureForStatus,
  renderIssueHeader,
  type IssueLocator,
  type IssueReader,
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
  TRACKERS,
  getTracker,
  githubTracker,
  notionTracker,
  parseNotionPageId,
  resolvePrimaryRead,
  type PrimaryRead,
  type ReferenceHit,
  type Tracker,
  type TrackerRootDeps,
} from "./trackers";
export {
  ReferenceLocations,
  TicketTrackers,
  TrackerConfigSchema,
  type ReferenceLocation,
  type TicketTracker,
  type TrackerConfig,
} from "./tracker";
