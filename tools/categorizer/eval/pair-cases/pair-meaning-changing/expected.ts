// BRIEF-143 revision-pair case — AUTHORED fixture (own-repo file shapes,
// difflib-generated diffs; PR locator is a placeholder). Origin: the
// BRIEF-143 PR 5 stack; generator script documented in that PR.
// Meaning-changing increment: the health route becomes a DB probe. Completeness side of spec pair 2.
import type { PairEvalProperty } from "../../pairs";
import {
  coverage,
  groupsOwning,
  idCarried,
  untouchedGroupSurvives,
} from "../props";

const A = "packages/logging/src/redact.ts";
const B = "packages/api/src/routes/health.ts";

export const pairProperties: PairEvalProperty[] = [
  untouchedGroupSurvives(A),
  coverage([A, B]),
  idCarried(B),
  // Spec pair 2 RIGHT: a meaning-changing increment actually updates the
  // description. Model-judged.
  {
    id: "description-updates",
    description:
      "the re-looked group's summary changes when the behavior changed",
    check: (pair) => {
      const [before] = groupsOwning(pair.base, B);
      const [after] = groupsOwning(pair.revised, B);
      const baseGroup = pair.base.changeGroups.find((g) => g.id === before);
      const revisedGroup = pair.revised.changeGroups.find(
        (g) => g.id === after,
      );
      return (
        baseGroup !== undefined &&
        revisedGroup !== undefined &&
        baseGroup.summary !== revisedGroup.summary
      );
    },
  },
];
