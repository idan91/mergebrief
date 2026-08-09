// BRIEF-143 revision-pair case — AUTHORED fixture (own-repo file shapes,
// difflib-generated diffs; PR locator is a placeholder). Origin: the
// BRIEF-143 PR 5 stack; generator script documented in that PR.
// Fixed risky code: rev1 removed the token guard (attr fires); rev2 restores it (stale attr must drop). Completeness side of spec pair 5, drop direction.
import type { PairEvalProperty } from "../../pairs";
import { attrsOn, coverage, untouchedGroupSurvives } from "../props";

const A = "packages/logging/src/redact.ts";
const B = "packages/api/src/routes/health.ts";

export const pairProperties: PairEvalProperty[] = [
  untouchedGroupSurvives(A),
  coverage([A, B]),
  // Precondition half: the BASE brief fired on the guard removal — without
  // this the drop half would pass vacuously.
  {
    id: "risk-attr-fired-on-base",
    description:
      "removes-validation fired on the base revision (guard removed)",
    check: (pair) => attrsOn(pair.base, B).has("removes-validation"),
  },
  // Spec pair 5 RIGHT (drop direction): the restored guard drops the attr.
  {
    id: "stale-risk-attr-drops",
    description: "removes-validation is gone once the guard is restored",
    check: (pair) => !attrsOn(pair.revised, B).has("removes-validation"),
  },
];
