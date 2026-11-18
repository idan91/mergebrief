// Real pair, sveltejs/kit #11161 (SvelteKit 2.0, MIT, its LICENSE beside
// this file): e2fdf7cb75 to 9d6de50389, the branch merging master 24a16ce3.
// Captured with capture-pair: the merge base moved, so the span is built,
// and the PR diff is byte-identical at both heads. Every group carries with
// no model call and the narrative and delta write their no-change records.
import type { PairEvalProperty } from "../../pairs";
import {
  SPAN_DELTA_PROPERTIES,
  SPAN_NARRATIVE_PROPERTIES,
} from "../../revision-props";
import { anchoredStamp, keepsCarriedGroups, carriesEveryGroup } from "../props";

export const pairProperties: PairEvalProperty[] = [
  carriesEveryGroup(),
  keepsCarriedGroups(),
  anchoredStamp(true),
];

export const narrativeProperties = [...SPAN_NARRATIVE_PROPERTIES];
export const deltaProperties = [...SPAN_DELTA_PROPERTIES];
