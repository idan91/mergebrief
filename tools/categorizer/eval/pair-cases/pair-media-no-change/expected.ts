// Revision-pair case, an AUTHORED fixture: a scratch git repo with a
// placeholder PR locator, captured through capturePair over a local-git
// span source, beside a hand-written base Brief with one group per file
// whose Summary Media shows one of the description's two mermaid diagrams.
// Squash over a description holding Media: the span and the inputs are
// unchanged, so the brief carries with no model call and no Summary Media
// call, its Summary Media kept as stored.
import type { PairEvalProperty } from "../../pairs";
import {
  anchoredStamp,
  keepsCarriedGroups,
  carriesEveryGroup,
  coverage,
  summaryMediaCarried,
} from "../props";

const FILES = [
  "src/webhooks/backoff.ts",
  "src/webhooks/config.ts",
  "src/webhooks/deliver.ts",
];

export const pairProperties: PairEvalProperty[] = [
  carriesEveryGroup(),
  keepsCarriedGroups(),
  coverage(FILES),
  anchoredStamp(true),
  summaryMediaCarried(),
];
