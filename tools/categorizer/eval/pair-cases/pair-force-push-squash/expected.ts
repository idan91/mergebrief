// Revision-pair case, an AUTHORED fixture: a scratch git repo with a
// placeholder PR locator, captured through capturePair over a local-git
// span source, so pair.json records the span the production read built,
// beside a hand-written base Brief with one group per file.
// Squash: three commits force-pushed as one with the same tree. The span
// is unchanged, so every group carries with no model call and the
// narrative and delta write their no-change records.
import type { PairEvalProperty } from "../../pairs";
import {
  SPAN_DELTA_PROPERTIES,
  SPAN_NARRATIVE_PROPERTIES,
} from "../../revision-props";
import {
  anchoredStamp,
  keepsCarriedGroups,
  carriesEveryGroup,
  coverage,
} from "../props";

const FILES = [
  "packages/api/src/config.ts",
  "packages/api/src/rate-limit.ts",
  "packages/api/src/routes.ts",
  "packages/api/src/server.ts",
];

export const pairProperties: PairEvalProperty[] = [
  carriesEveryGroup(),
  keepsCarriedGroups(),
  coverage(FILES),
  anchoredStamp(true),
];

export const narrativeProperties = [...SPAN_NARRATIVE_PROPERTIES];
export const deltaProperties = [...SPAN_DELTA_PROPERTIES];
