// Revision-pair case, an AUTHORED fixture: a scratch git repo with a
// placeholder PR locator, captured through capturePair over a local-git
// span source, so pair.json records the span the production read built,
// beside a hand-written base Brief with one group per file.
// Rebase onto main, which put two lines above routes.ts's PR runs and two
// beside server.ts's; the rebase also changed one PR line in server.ts.
// routes.ts carries two lines lower, server.ts re-looks, and the base lines
// sit only in the unfiltered span: a chunk on them replays base noise.
import type { PairEvalProperty } from "../../pairs";
import {
  SPAN_DELTA_PROPERTIES,
  SPAN_NARRATIVE_PROPERTIES,
} from "../../revision-props";
import {
  anchoredStamp,
  keepsCarriedGroups,
  shiftsCarriedRanges,
  coverage,
  reLooksOwnersOf,
} from "../props";

const FILES = [
  "packages/api/src/config.ts",
  "packages/api/src/rate-limit.ts",
  "packages/api/src/routes.ts",
  "packages/api/src/server.ts",
];

export const pairProperties: PairEvalProperty[] = [
  reLooksOwnersOf(["packages/api/src/server.ts"]),
  keepsCarriedGroups(),
  shiftsCarriedRanges("packages/api/src/routes.ts", 2),
  coverage(FILES),
  anchoredStamp(true),
];

export const narrativeProperties = [...SPAN_NARRATIVE_PROPERTIES];
export const deltaProperties = [...SPAN_DELTA_PROPERTIES];
