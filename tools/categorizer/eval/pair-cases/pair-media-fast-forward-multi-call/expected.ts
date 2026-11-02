// Multi-call twin of pair-media-fast-forward: the same pair with both
// Briefs forced through the multi-call engine, scored by its Brief
// properties under its own baseline. The grouping prompt carries the Media
// note beside the anchored section, and the Summary Media call runs after
// the multi-call stitch.
import type { PairEvalProperty } from "../../pairs";
import { pairProperties as baseProperties } from "../pair-media-fast-forward/expected";

export const fixtureFrom = "pair-media-fast-forward";
export const forceMultiCall = true;

export const pairProperties: PairEvalProperty[] = [...baseProperties];
