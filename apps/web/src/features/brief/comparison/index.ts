// Curated comparison entry: the View/Compare URL vocabulary other features and
// the routes resolve against. Internal brief files import the modules directly.
// Route `validateSearch` imports it and is never code-split, so this entry
// ships in the client entry chunk: keep its graph free of the Brief screen.
export {
  buildBriefSearchParams,
  compareUnavailableTitle,
  isCompareAvailable,
  lastReviewUnavailableReasonTitle,
  parseBriefAddressSearch,
  resolveBriefSearch,
  stripDefaultSearch,
  withCompare,
  withView,
  type BriefAddressSearch,
  type BriefSearch,
  type BriefSearchParams,
  type CompareOptionFlags,
  type ViewParam,
} from "./compareState";
export { CompareParams, type CompareParam } from "./types";
