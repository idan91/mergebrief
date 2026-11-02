import { parentPort } from "node:worker_threads";
import {
  buildFastForwardSpan,
  buildPrSpan,
  formatLineDiffPatch,
  planBuiltSpan,
} from "brief-core/pr-span";
import { SpanStepRequestSchema } from "./schemas";
import {
  SpanStepAnswerKinds,
  SpanStepKinds,
  type SpanStep,
  type SpanStepAnswer,
} from "./types";

function runSpanStep(id: number, step: SpanStep): SpanStepAnswer {
  if (step.kind === SpanStepKinds.PLAN_BUILT_SPAN) {
    return {
      id,
      kind: SpanStepAnswerKinds.PLAN,
      plan: planBuiltSpan(step.input),
    };
  }
  if (step.kind === SpanStepKinds.BUILD_PR_SPAN) {
    return {
      id,
      kind: SpanStepAnswerKinds.SPAN,
      span: buildPrSpan(step.input),
    };
  }
  if (step.kind === SpanStepKinds.BUILD_FAST_FORWARD_SPAN) {
    const span = buildFastForwardSpan(step.input);
    return { id, kind: SpanStepAnswerKinds.SPAN, span };
  }
  const patch = formatLineDiffPatch(step.input);
  if (patch === undefined) {
    return { id, kind: SpanStepAnswerKinds.NO_PATCH };
  }
  return { id, kind: SpanStepAnswerKinds.PATCH, patch };
}

/** A request the parent did not shape is a programmer error: the throw ends the thread and the parent fails what it had pending. */
function answerSpanStep(message: unknown): SpanStepAnswer {
  const request = SpanStepRequestSchema.parse(message);
  return runSpanStep(request.id, request.step);
}

const port = parentPort;
if (port === null) {
  throw new Error("the span step runs only as a worker thread");
}
port.on("message", (message: unknown) => {
  port.postMessage(answerSpanStep(message));
});
