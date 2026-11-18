// Revision-pair case, an AUTHORED fixture: pair-risk-add with health.ts
// added by the PR instead of modified, so neither revision's PR diff deletes
// a line there. The token guard revision 1 added and revision 2 removed shows
// only through the Anchor, and the chunk that lost it removes no lines.
import type { PairEvalProperty } from "../../pairs";
import {
  attrsOn,
  coverage,
  frozenAttrsNeverChange,
  untouchedGroupSurvives,
} from "../props";

const REDACT_FILE = "packages/logging/src/redact.ts";
const HEALTH_ROUTE = "packages/api/src/routes/health.ts";

export const pairProperties: PairEvalProperty[] = [
  untouchedGroupSurvives(REDACT_FILE),
  frozenAttrsNeverChange(REDACT_FILE),
  coverage([REDACT_FILE, HEALTH_ROUTE]),
  // The attribute survives final validation on a chunk with no removed
  // lines. Model-judged.
  {
    id: "risk-attr-fires",
    description:
      "removes-validation fires on the new route after the guard removal, though its chunk removes no lines",
    check: (pair) =>
      attrsOn(pair.revised, HEALTH_ROUTE).has("removes-validation"),
  },
];
