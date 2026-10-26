// Real revision pair; diffs are verbatim `git diff` output and the PR
// locator is a placeholder. The increment adds one new file and leaves the
// spec file untouched, so its group must freeze and carry.
import type { PairEvalProperty } from "../../pairs";
import {
  anchoredStamp,
  coverage,
  groupsOwning,
  untouchedGroupSurvives,
} from "../../pair-cases/props";

const SPEC = "docs/plans/brief-143-stability-spec.md";
const PLAN = "docs/plans/brief-143-stability-implementation.md";

export const pairProperties: PairEvalProperty[] = [
  untouchedGroupSurvives(SPEC),
  coverage([SPEC, PLAN]),
  {
    id: "new-doc-covered",
    description: "the newly added plan doc lands in exactly one revised group",
    check: (pair) => groupsOwning(pair.revised, PLAN).length === 1,
  },
  anchoredStamp(true),
];
