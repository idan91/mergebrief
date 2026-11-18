// Multi-call twin of pair-force-push-amend: the same pair with the revised
// Brief forced through the multi-call engine over the case's stored base
// Brief, scored by its Brief properties under its own baseline. Here that is a force push over an unmoved base: only the
// amended file is grouped and detailed again.
import type { PairEvalProperty } from "../../pairs";
import { pairProperties as baseProperties } from "../pair-force-push-amend/expected";

export const fixtureFrom = "pair-force-push-amend";
export const forceMultiCall = true;

export const pairProperties: PairEvalProperty[] = [...baseProperties];
