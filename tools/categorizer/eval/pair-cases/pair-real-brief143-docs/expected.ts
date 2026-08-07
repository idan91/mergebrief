// BRIEF-143 revision-pair case — REAL fixture from this repo's history
// (interaction smoke test): base daed6dae (research doc on main), rev1
// db2fe83e (adds the locked spec), rev2 472b6d7a (adds the implementation
// plan). The increment adds one new file; the spec file is untouched, so
// its group must freeze and carry. PR locator is a placeholder (these were
// docs commits straight to main); diffs are verbatim `git diff` output.
import type { PairEvalProperty } from "../../pairs";
import {
  anchoredStamp,
  coverage,
  groupsOwning,
  untouchedGroupSurvives,
} from "../props";

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
