// BRIEF-143 revision-pair case: AUTHORED fixture (own-repo file shapes,
// difflib-generated diffs; PR locator is a placeholder). Origin: the
// BRIEF-143 PR 5 stack; generator script documented in that PR.
// Rebase noise: the base gained two lines above redact.ts's PR change and
// left the change as it was, so its group carries with its range moved down
// two; health.ts changed and re-looks.
import type { PairEvalProperty } from "../../pairs";
import {
  anchoredStamp,
  coverage,
  idCarried,
  untouchedGroupSurvives,
} from "../props";

const A = "packages/logging/src/redact.ts";
const B = "packages/api/src/routes/health.ts";

export const pairProperties: PairEvalProperty[] = [
  coverage([A, B]),
  anchoredStamp(true),
  untouchedGroupSurvives(A),
  idCarried(A),
  idCarried(B),
];
