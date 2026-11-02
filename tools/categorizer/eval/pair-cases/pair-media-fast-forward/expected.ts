// Revision-pair case, an AUTHORED fixture: a scratch git repo with a
// placeholder PR locator, captured through capturePair over a local-git
// span source, beside a hand-written base Brief with one group per file
// whose Summary Media shows one of the description's two mermaid diagrams.
// Fast-forward over a description holding Media: one commit jitters the
// backoff, so its group re-looks in an anchored call and the other groups
// carry; the Summary Media call then picks again from the stitched summary.
import type { PairEvalProperty } from "../../pairs";
import {
  anchoredStamp,
  keepsCarriedGroups,
  coverage,
  reLooksOwnersOf,
  revisedSummaryMediaGuards,
  summaryMediaPicked,
} from "../props";

const FILES = [
  "src/webhooks/backoff.ts",
  "src/webhooks/config.ts",
  "src/webhooks/deliver.ts",
];

export const pairProperties: PairEvalProperty[] = [
  reLooksOwnersOf(["src/webhooks/backoff.ts"]),
  keepsCarriedGroups(),
  coverage(FILES),
  anchoredStamp(true),
  summaryMediaPicked(),
  ...revisedSummaryMediaGuards(),
];
