// Multi-call twin of pair-boundary-restructure: the same pair with both
// Briefs forced through the multi-call engine, scored by its Brief
// properties under its own baseline. Here that is a merge across re-looked
// groups: no re-looked group takes a frozen id by id alone.
import type { PairEvalProperty } from "../../pairs";
import { pairProperties as baseProperties } from "../pair-boundary-restructure/expected";

export const fixtureFrom = "pair-boundary-restructure";
export const forceMultiCall = true;

export const pairProperties: PairEvalProperty[] = [...baseProperties];
