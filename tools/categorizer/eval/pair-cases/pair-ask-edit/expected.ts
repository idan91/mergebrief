// BRIEF-143 revision-pair case — AUTHORED fixture (own-repo file shapes,
// difflib-generated diffs; PR locator is a placeholder). Provenance: the
// BRIEF-143 PR 5 stack; generator script documented in that PR.
// Ask edit: rev2's title/body newly ask for a version endpoint the diff does not deliver. Spec pair 4 RIGHT: an edited ask gets a fresh verdict.
import type { PairEvalProperty } from "../../pairs";
import { coverage, untouchedGroupSurvives } from "../props";

const A = "packages/logging/src/redact.ts";
const B = "packages/api/src/routes/health.ts";

export const pairProperties: PairEvalProperty[] = [
  untouchedGroupSurvives(A),
  coverage([A, B]),
  // Spec pair 4 RIGHT: the edited ask is judged against the CURRENT corpus
  // — the undelivered version endpoint must surface as statedButMissing.
  // Keyword-matched per the BRIEF-54 bounded exception ("version" is a
  // planted marker in the authored rev2 title/body).
  {
    id: "edited-ask-fresh-verdict",
    description:
      "the newly asked-for version endpoint surfaces as statedButMissing",
    check: (pair) =>
      pair.revised.intentCheck !== undefined &&
      pair.revised.intentCheck.statedButMissing.some((item) =>
        /version/i.test(`${item.intent} ${item.quote}`),
      ),
  },
  {
    id: "base-had-no-missing-ask",
    description: "the base revision reported no missing ask (precondition)",
    check: (pair) =>
      pair.base.intentCheck !== undefined &&
      pair.base.intentCheck.statedButMissing.length === 0,
  },
];
