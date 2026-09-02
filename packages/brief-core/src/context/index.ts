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
  ContextReadReason,
  ContextSnippet,
  ProviderSnippet,
} from "./types";
export { ContextProviderTypes, ContextReadReasons } from "./types";
export {
  CONTEXT_PROVIDER_TIMEOUT_MS,
  fetchContextSnippets,
  type FetchContextSnippetsOptions,
} from "./fan-out";
export {
  BUILT_IN_CONTEXT_PROVIDER_TYPES,
  CONTEXT_REGISTRY,
  EgressTiers,
  createBuiltInContextProviders,
  type CreateContextProviderDeps,
  type EgressTier,
} from "./registry";
export { extractLinks, isPublicUrl, urlContextProvider } from "./providers/url";
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
  type ReferenceHit,
  type Tracker,
} from "./trackers";
export {
  ReferenceLocations,
  TicketTrackers,
  TrackerConfigSchema,
  type ReferenceLocation,
  type TicketTracker,
  type TrackerConfig,
} from "./tracker";
