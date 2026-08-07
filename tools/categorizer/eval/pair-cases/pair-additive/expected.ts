// BRIEF-143 revision-pair case — AUTHORED fixture (own-repo file shapes,
// difflib-generated diffs; PR locator is a placeholder). Provenance: the
// BRIEF-143 PR 5 stack; generator script documented in that PR.
// Additive increment: b gains lines, meaning unchanged. Stability side of spec pairs 1-4.
import type { PairEvalProperty } from "../../pairs";
import {
  anchoredStamp,
  coverage,
  frozenAttrsNeverChange,
  groupsOwning,
  idCarried,
  survivorOrderStable,
  untouchedGroupSurvives,
} from "../props";

const A = "packages/logging/src/redact.ts";
const B = "packages/api/src/routes/health.ts";

export const pairProperties: PairEvalProperty[] = [
  untouchedGroupSurvives(A),
  survivorOrderStable(A),
  frozenAttrsNeverChange(A),
  coverage([A, B]),
  // Spec pair 2 LEFT: an additive-only re-look keeps id and category.
  idCarried(B),
  {
    id: "additive-keeps-category",
    description:
      "the re-looked group keeps its dominant category on an additive increment",
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
        baseGroup.dominantCategory === revisedGroup.dominantCategory
      );
    },
  },
  // Spec pair 3 LEFT: the summary lede survives an immaterial increment
  // (minimal-edit contract; byte-identical is legitimate). Model-judged:
  // rides the stable-pass/flaky discipline.
  {
    id: "summary-lede-stable",
    description:
      "the summary's first sentence is unchanged on an immaterial increment",
    check: (pair) =>
      (pair.base.summary.split(".")[0] ?? "") ===
      (pair.revised.summary.split(".")[0] ?? ""),
  },
  // Spec pair 4 LEFT: the unchanged ask keeps its verdict bucket.
  {
    id: "verdict-stable",
    description:
      "an unchanged, delivered ask stays accomplished with stable wording",
    check: (pair) => {
      const base = pair.base.intentCheck;
      const revised = pair.revised.intentCheck;
      if (base === undefined || revised === undefined) return false;
      return (
        base.specificity === revised.specificity &&
        revised.accomplished.length >= base.accomplished.length &&
        revised.statedButMissing.length === base.statedButMissing.length
      );
    },
  },
  anchoredStamp(true),
];
