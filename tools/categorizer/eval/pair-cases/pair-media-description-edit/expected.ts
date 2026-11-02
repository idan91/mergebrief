// Revision-pair case, an AUTHORED fixture: a scratch git repo with a
// placeholder PR locator, captured through capturePair over a local-git
// span source, beside a hand-written base Brief with one group per file
// whose Summary Media shows the description's timing diagram.
// Reworded force push, same tree; only the timing diagram is swapped. The
// span is unchanged but the fingerprint moved, so the carry is refused:
// one anchored brief call carries every group, then the Summary Media call
// picks from the edited description, never the removed diagram.
import type { PairEvalProperty } from "../../pairs";
import {
  anchoredStamp,
  keepsCarriedGroups,
  carriesEveryGroup,
  coverage,
  inputFingerprintMoved,
  revisedSummaryMediaGuards,
  summaryMediaPicked,
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
  inputFingerprintMoved(),
  summaryMediaPicked(),
  ...revisedSummaryMediaGuards(),
];
