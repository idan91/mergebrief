import { describe, expect, it } from "vitest";
import { buildPrMetadata } from "../../src/task/generate/logic/pr-metadata";
import {
  captureLogger,
  HEAD_1,
  makePullRequestInfo,
  setUpHarness,
  trigger,
} from "./helpers";

setUpHarness();

describe("buildPrMetadata", () => {
  it("keeps a rename's old path out of the generation metadata", async () => {
    const { pr } = await trigger(HEAD_1);

    const meta = buildPrMetadata({
      prInfo: makePullRequestInfo(HEAD_1),
      files: [
        {
          path: "lib/refund.ts",
          previousPath: "src/payments/refund.ts",
          additions: 2,
          deletions: 1,
        },
        { path: "a.ts", additions: 8, deletions: 2 },
      ],
      prRow: pr,
      openPullRequests: { ok: true, value: [] },
      log: captureLogger().logger,
    });

    expect(meta.files).toStrictEqual([
      { path: "lib/refund.ts", additions: 2, deletions: 1 },
      { path: "a.ts", additions: 8, deletions: 2 },
    ]);
  });
});
