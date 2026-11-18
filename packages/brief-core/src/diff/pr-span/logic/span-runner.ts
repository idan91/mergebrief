import type { PrSpanRunner } from "../types";
import { buildPrSpan } from "./build-span";
import { buildFastForwardSpan } from "./fast-forward-span";
import { runLineDiffInProcess } from "./line-diff";
import { planBuiltSpan } from "./plan-span";

/** Every step on the calling thread: the worker's and the dev CLI's runner. */
export const IN_PROCESS_SPAN_RUNNER: PrSpanRunner = {
  planBuiltSpan: (input) => Promise.resolve(planBuiltSpan(input)),
  buildPrSpan: (input) => Promise.resolve(buildPrSpan(input)),
  buildFastForwardSpan: (input) => Promise.resolve(buildFastForwardSpan(input)),
  runLineDiff: runLineDiffInProcess,
};
