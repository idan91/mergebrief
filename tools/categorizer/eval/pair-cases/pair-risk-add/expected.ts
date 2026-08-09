// BRIEF-143 revision-pair case — AUTHORED fixture (own-repo file shapes,
// difflib-generated diffs; PR locator is a placeholder). Origin: the
// BRIEF-143 PR 5 stack; generator script documented in that PR.
// Risky increment: the token guard on the health route is REMOVED in rev2. Completeness side of spec pair 5.
import type { PairEvalProperty } from "../../pairs";
import {
  attrsOn,
  coverage,
  frozenAttrsNeverChange,
  untouchedGroupSurvives,
} from "../props";

const A = "packages/logging/src/redact.ts";
const B = "packages/api/src/routes/health.ts";

export const pairProperties: PairEvalProperty[] = [
  untouchedGroupSurvives(A),
  frozenAttrsNeverChange(A),
  coverage([A, B]),
  // Spec pair 5 RIGHT: the engineered risky increment fires the attribute.
  // Model-judged.
  {
    id: "risk-attr-fires",
    description:
      "removes-validation fires on the re-looked group after the guard removal",
    check: (pair) => attrsOn(pair.revised, B).has("removes-validation"),
  },
];
