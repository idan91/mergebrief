import { parentPort } from "node:worker_threads";
import { formatLineDiffPatch } from "brief-core/pr-span";
import { LineDiffRequestSchema } from "./schemas";
import { LineDiffAnswerKinds, type LineDiffAnswer } from "./types";

/** A request the parent did not shape is a programmer error: the throw ends the thread and the parent fails what it had pending. */
function answerLineDiff(message: unknown): LineDiffAnswer {
  const request = LineDiffRequestSchema.parse(message);
  const patch = formatLineDiffPatch(request.input);
  if (patch === undefined) {
    return { id: request.id, kind: LineDiffAnswerKinds.NO_PATCH };
  }
  return { id: request.id, kind: LineDiffAnswerKinds.PATCH, patch };
}

const port = parentPort;
if (port === null) {
  throw new Error("the line-diff worker runs only as a worker thread");
}
port.on("message", (message: unknown) => {
  port.postMessage(answerLineDiff(message));
});
