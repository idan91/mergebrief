// Curated utils entry: the route-state vocabulary the routes resolve against,
// and the PR-state reading the Inbox shares.
export {
  deriveBriefRouteState,
  resolveMetaPollMs,
  selectBriefRouteState,
  shouldPollMeta,
  type Span,
} from "./briefRouteState";
export {
  buildRevisionTimelineViewFromDb,
  formatRevisionKey,
  resolveDbTimeline,
  type DbTimelinePoint,
  type RevisionRequest,
} from "./dbTimeline";
export {
  prefetchSpanDiff,
  readDiffPreloadPath,
  type SpanDiffPrefetch,
} from "./diff-prefetch";
export { isNoLongerOpen } from "./pr-state";
