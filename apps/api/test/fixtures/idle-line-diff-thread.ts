// Runs one diff on a real line-diff thread, then leaves the thread idle: the
// process exits only if an idle thread holds no reference on it.
import { createLineDiffThread } from "../../src/routes/repos/pr/reads/logic/line-diff-thread";

const thread = createLineDiffThread();
const patch = await thread.runLineDiff(
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
