// Multi-call twin of pair-additive: the same pair with both Briefs forced
// through the multi-call engine, scored by its Brief properties under its
// own baseline. Here that is the fast-forward control: frozen ids carry
// through an anchored multi-call run.
import type { PairEvalProperty } from "../../pairs";
import { pairProperties as baseProperties } from "../pair-additive/expected";

export const fixtureFrom = "pair-additive";
export const forceMultiCall = true;

export const pairProperties: PairEvalProperty[] = [...baseProperties];
