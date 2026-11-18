// A span thread stand-in: answers each line diff with its path and how
// many requests it has received, throws on the path "crash", never answers
// the path "hang", answers the path "malformed" out of shape, and answers
// the path "probe" with the flags and env keys the thread started with.
import { parentPort } from "node:worker_threads";

interface EchoRequest {
  readonly id: number;
  readonly step: {
    readonly input: { readonly contents: { readonly path: string } };
  };
}

function isEchoRequest(message: unknown): message is EchoRequest {
  return typeof message === "object" && message !== null && "id" in message;
}

let received = 0;
parentPort?.on("message", (message: unknown) => {
  if (!isEchoRequest(message)) {
    throw new Error("not a span step request");
  }
  received += 1;
  const path = message.step.input.contents.path;
  if (path === "crash") {
    throw new Error("crash requested");
  }
  if (path === "hang") {
    return;
  }
  if (path === "malformed") {
    // oxlint-disable-next-line unicorn/require-post-message-target-origin
    parentPort?.postMessage({ id: message.id, kind: "unknown" });
    return;
  }
  const probe = {
    execArgv: process.execArgv,
    envKeys: Object.keys(process.env),
  };
  const patch =
    path === "probe" ? JSON.stringify(probe) : `${path}:${received}`;
  const answer = { id: message.id, kind: "patch", patch };
  // oxlint-disable-next-line unicorn/require-post-message-target-origin
  parentPort?.postMessage(answer);
});
