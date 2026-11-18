// Revision-pair case: AUTHORED fixture (own-repo file shapes,
// difflib-generated diffs; PR locator is a placeholder).
// Intent transition: rev1 misses the asked-for health endpoint; rev2 delivers it. Spec pair 4 twin: statedButMissing flips on delivery.
import type { PairEvalProperty } from "../../pairs";
import { coverage } from "../props";

const A = "packages/logging/src/redact.ts";
const B = "packages/api/src/routes/health.ts";

export const pairProperties: PairEvalProperty[] = [
  coverage([A, B]),
  // Precondition: the base revision reported the health ask as missing.
  // Keyword-matched under the bounded keyword exception ("health" is a
  // planted marker in the authored title/body).
  {
    id: "base-reports-missing-health",
    description:
      "the base revision reports the undelivered health ask as statedButMissing",
    check: (pair) =>
      pair.base.intentCheck !== undefined &&
      pair.base.intentCheck.statedButMissing.some((item) =>
        /health/i.test(`${item.intent} ${item.quote}`),
      ),
  },
  // The transition: once delivered, the ask leaves statedButMissing.
  {
    id: "delivered-ask-leaves-missing",
    description:
      "the delivered health ask is no longer statedButMissing on the revision",
    check: (pair) =>
      pair.revised.intentCheck !== undefined &&
      !pair.revised.intentCheck.statedButMissing.some((item) =>
        /health/i.test(`${item.intent} ${item.quote}`),
      ),
  },
];
