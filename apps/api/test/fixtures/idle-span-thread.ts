// Runs one diff on a real span thread, then leaves the thread idle: the
// process exits only if an idle thread holds no reference on it.
import { createSpanThread } from "../../src/routes/repos/pr/reads/logic/span-thread";

const thread = createSpanThread();
const patch = await thread.runner.runLineDiff(
  {
    contents: {
      prevPath: "a.ts",
      path: "a.ts",
      prevContent: "a\n",
      newContent: "b\n",
    },
    maxEditLength: 10,
  },
  new AbortController().signal,
);
process.stdout.write(patch === undefined ? "no patch" : "patch");
