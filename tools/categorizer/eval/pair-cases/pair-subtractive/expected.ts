// BRIEF-143 revision-pair case — AUTHORED fixture (own-repo file shapes,
// difflib-generated diffs; PR locator is a placeholder). Origin: the
// BRIEF-143 PR 5 stack; generator script documented in that PR.
// Subtractive increment: rev2 reverts the health route entirely — the file leaves the PR. Spec pair 6 RIGHT: the emptied group dies.
import type { PairEvalProperty } from "../../pairs";
import { coverage, groupsOwning, untouchedGroupSurvives } from "../props";

const A = "packages/logging/src/redact.ts";
const B = "packages/api/src/routes/health.ts";

export const pairProperties: PairEvalProperty[] = [
  untouchedGroupSurvives(A),
  coverage([A]),
  {
    id: "emptied-group-dies",
    description:
      "no revised group owns the reverted file; the group count shrank",
    check: (pair) =>
      groupsOwning(pair.revised, B).length === 0 &&
      pair.revised.changeGroups.length < pair.base.changeGroups.length,
  },
];
