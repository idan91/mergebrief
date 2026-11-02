// Real pair, nodejs/node #65881 (Version 26.9.0): ea09fd0c72 to 28bd0bab04,
// the second force push, 1248 hunks three-dot. Captured with capture-pair:
// the span holds two files. Private because 738 deps/ files carry licenses
// past the public cases' MIT rule. It runs only on a stored baseBrief,
// recorded once with `pnpm -C tools/categorizer eval --case
// pair-real-node-65881 --record-base-brief`, so no run pays for a base.
import type { PairEvalProperty } from "../../pairs";
import {
  SPAN_DELTA_PROPERTIES,
  SPAN_NARRATIVE_PROPERTIES,
} from "../../revision-props";
import {
  anchoredStamp,
  keepsCarriedGroups,
  reLooksOwnersOf,
} from "../../pair-cases/props";

export const requiresBaseBrief = true;

export const pairProperties: PairEvalProperty[] = [
  reLooksOwnersOf([
    "doc/changelogs/CHANGELOG_V26.md",
    "tools/nix/sharedLibDeps.nix",
  ]),
  keepsCarriedGroups(),
  anchoredStamp(true),
];

export const narrativeProperties = [...SPAN_NARRATIVE_PROPERTIES];
export const deltaProperties = [...SPAN_DELTA_PROPERTIES];
