// BRIEF-143 revision-pair case — AUTHORED fixture (own-repo file shapes,
// difflib-generated diffs; PR locator is a placeholder). Origin: the
// BRIEF-143 PR 5 stack; generator script documented in that PR.
// Boundary restructure: rev2 unifies health+status around a shared probe — merge/split among re-looked groups only. Spec §Mechanism merge/split rule.
import type { PairEvalProperty } from "../../pairs";
import { coverage, groupsOwning, untouchedGroupSurvives } from "../props";

const A = "packages/logging/src/redact.ts";
const B = "packages/api/src/routes/health.ts";

const C = "packages/api/src/routes/status.ts";

export const pairProperties: PairEvalProperty[] = [
  untouchedGroupSurvives(A),
  coverage([A, B, C]),
  // Merge/split among re-looked groups: descent keeps ids from the previous
  // partition — no freshly minted ids for these files.
  {
    id: "restructure-ids-descend",
    description:
      "groups owning the restructured files reuse previous group ids",
    check: (pair) => {
      const previousIds = new Set(pair.base.changeGroups.map((g) => g.id));
      const owners = [
        ...groupsOwning(pair.revised, B),
        ...groupsOwning(pair.revised, C),
      ];
      return owners.length > 0 && owners.every((id) => previousIds.has(id));
    },
  },
];
