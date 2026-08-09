// BRIEF-143 revision-pair case — AUTHORED fixture (own-repo file shapes,
// difflib-generated diffs; PR locator is a placeholder). Origin: the
// BRIEF-143 PR 5 stack; generator script documented in that PR.
// Rebase noise: the base SHA moved — everything re-looks (nothing carried), but ids still descend. Spec §Rebase noise conservative path.
import type { PairEvalProperty } from "../../pairs";
import { anchoredStamp, coverage, idCarried } from "../props";

const A = "packages/logging/src/redact.ts";
const B = "packages/api/src/routes/health.ts";

export const pairProperties: PairEvalProperty[] = [
  coverage([A, B]),
  anchoredStamp(false),
  // Ids survive the rebase via descent even though nothing was carried.
  idCarried(A),
  idCarried(B),
];
