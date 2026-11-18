// Revision-pair case, an AUTHORED fixture: a scratch git repo with a
// placeholder PR locator, captured through capturePair over a local-git
// span source, so pair.json records the span the production read built,
// beside a hand-written base Brief with one group per file.
// Rebase with a conflict: main raised the connection cap on the line the PR
// rewrote, and the resolution kept both (env override, new default).
// config.ts changed and its owners re-look; the other files carry.
import type { PairEvalProperty } from "../../pairs";
import {
  SPAN_DELTA_PROPERTIES,
  SPAN_NARRATIVE_PROPERTIES,
} from "../../revision-props";
import {
  anchoredStamp,
  keepsCarriedGroups,
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
  reLooksOwnersOf(["packages/api/src/config.ts"]),
  keepsCarriedGroups(),
  coverage(FILES),
  anchoredStamp(true),
];

export const narrativeProperties = [...SPAN_NARRATIVE_PROPERTIES];
export const deltaProperties = [...SPAN_DELTA_PROPERTIES];
