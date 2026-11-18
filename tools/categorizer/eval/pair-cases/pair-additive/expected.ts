// Revision-pair case, an AUTHORED fixture: own-repo file shapes,
// difflib-generated diffs, and a placeholder PR locator.
// Additive increment: b gains lines, meaning unchanged. Stability side of spec pairs 1-4.
import type { PairEvalProperty } from "../../pairs";
import {
  SPAN_DELTA_PROPERTIES,
  SPAN_NARRATIVE_PROPERTIES,
} from "../../revision-props";
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

function getLedeWords(summary: string): string[] {
  const lede = summary.split(".")[0] ?? "";
  const words = lede.toLowerCase().match(/[a-z0-9]+/g);
  return words ?? [];
}

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
  // under the minimal-edit contract. Inserting the new detail is a minimal
  // edit; rewording or dropping a fact is not. Model-judged.
  {
    id: "summary-lede-minimal-edit",
    description:
      "the revised lede keeps every word of the base lede: the increment may add a detail, never reword it",
    check: (pair) => {
      const revisedWords = new Set(getLedeWords(pair.revised.summary));
      const keepsEveryBaseWord = getLedeWords(pair.base.summary).every((word) =>
        revisedWords.has(word),
      );
      return keepsEveryBaseWord;
    },
  },
  // Spec pair 4 LEFT: the unchanged ask keeps its verdict bucket.
  {
    id: "verdict-stable",
    description:
      "an unchanged, delivered ask stays accomplished with stable wording",
    check: (pair) => {
      const base = pair.base.intentCheck;
      const revised = pair.revised.intentCheck;
      if (base === undefined || revised === undefined) {
        return false;
      }
      return (
        base.specificity === revised.specificity &&
        revised.accomplished.length >= base.accomplished.length &&
        revised.statedButMissing.length === base.statedButMissing.length
      );
    },
  },
  anchoredStamp(true),
];

export const narrativeProperties = [...SPAN_NARRATIVE_PROPERTIES];
export const deltaProperties = [...SPAN_DELTA_PROPERTIES];
