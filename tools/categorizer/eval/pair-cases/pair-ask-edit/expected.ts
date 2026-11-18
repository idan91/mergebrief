// Revision-pair case, an AUTHORED fixture: own-repo file shapes,
// difflib-generated diffs, a placeholder PR locator.
// Ask edit: rev2's title/body newly ask for a version endpoint the diff does not deliver. Spec pair 4 RIGHT: an edited ask gets a fresh verdict.
import type { PairEvalProperty } from "../../pairs";
import {
  SPAN_DELTA_PROPERTIES,
  SPAN_NARRATIVE_PROPERTIES,
} from "../../revision-props";
import { coverage, untouchedGroupSurvives } from "../props";

const A = "packages/logging/src/redact.ts";
const B = "packages/api/src/routes/health.ts";

export const pairProperties: PairEvalProperty[] = [
  untouchedGroupSurvives(A),
  coverage([A, B]),
  // Spec pair 4 RIGHT: the edited ask is judged against the CURRENT source
  // so the undelivered version endpoint must surface as statedButMissing.
  // Keyword-matched under the bounded keyword exception: "version" is a
  // planted marker in the authored rev2 title and body.
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
  // The precondition the sibling actually needs: the version ask is NEW in
  // rev2, so the base must not already carry it. The base reporting OTHER
  // missing asks is irrelevant and was never what "fresh verdict" meant.
  {
    id: "base-lacks-the-edited-ask",
    description: "the base revision did not already report the version ask",
    check: (pair) =>
      pair.base.intentCheck !== undefined &&
      !pair.base.intentCheck.statedButMissing.some((item) =>
        /version/i.test(`${item.intent} ${item.quote}`),
      ),
  },
];

export const narrativeProperties = [...SPAN_NARRATIVE_PROPERTIES];
export const deltaProperties = [...SPAN_DELTA_PROPERTIES];

// Comments 201 and 202 ask for what the push added; 203 it leaves open.
export const deltaReadsReviewComments = true;
