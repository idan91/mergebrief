// BRIEF-143 revision-pair case — AUTHORED fixture (own-repo file shapes,
// difflib-generated diffs; PR locator is a placeholder). Origin: the
// BRIEF-143 PR 5 stack; generator script documented in that PR.
// New material: rev2 adds a new version route file. Spec pair 1 RIGHT: the new file lands in exactly one group.
import type { PairEvalProperty } from "../../pairs";
import { coverage, groupsOwning, untouchedGroupSurvives } from "../props";

const A = "packages/logging/src/redact.ts";
const B = "packages/api/src/routes/health.ts";

const V = "packages/api/src/routes/version.ts";

export const pairProperties: PairEvalProperty[] = [
  untouchedGroupSurvives(A),
  coverage([A, B, V]),
  // Spec pair 1 RIGHT (hard): the new file surfaces in exactly one group.
  {
    id: "new-file-covered",
    description: "the newly added file lands in exactly one revised group",
    check: (pair) => groupsOwning(pair.revised, V).length === 1,
  },
];
