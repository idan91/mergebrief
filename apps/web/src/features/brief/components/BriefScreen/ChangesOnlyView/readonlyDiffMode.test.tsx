// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TokenPlanProvider } from "@web/hooks/useTokenPlan";
import { ChunkTokenStatuses, TokenizeModes } from "@web/utils/diffTokens/types";
import type { Brief, BriefChunk } from "../../../types";
import { buildBriefViewModel } from "../../../utils/viewModel";
import { ChangesOnlyView } from "./ChangesOnlyView";

const { requestSnippetTokens } = vi.hoisted(() => ({
  requestSnippetTokens: vi.fn(),
}));

vi.mock("@web/utils/diffTokens/client", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();

  return {
    ...actual,
    canTokenizeChunks: () => true,
    requestSnippetTokens,
    warmDiffTokenWorker: () => undefined,
  };
});

const PR = {
  repo: "acme/widgets",
  number: 7,
  title: "t",
  url: "https://example.com/pr/7",
  sha: "head1234",
  description: "",
};

const DELTA_CHUNK: BriefChunk = {
  id: "chunk-a",
  changeGroupId: "g1",
  file: "src/a.ts",
  concern: "implementation",
  role: "core",
  loc: { added: 1, deleted: 1 },
  addedRanges: [],
  removedRanges: [],
  riskSurface: [],
  summary: "Delta chunk: adds the guard.",
  diff: [
    { kind: "del", content: "const label = 'ship", oldLine: 1 },
    { kind: "add", content: "const label = 'ship';", newLine: 1 },
  ],
} as BriefChunk;

const DELTA: Brief = {
  schemaVersion: 1,
  generatedAt: "2026-01-01T00:00:00.000Z",
  pr: PR,
  summary: "delta summary",
  changeGroups: [
    {
      id: "g1",
      title: "Guarded shared path",
      dominantCategory: "implementation",
      chunkIds: ["chunk-a"],
    },
  ],
  chunks: [DELTA_CHUNK],
} as unknown as Brief;

function renderLastReview(): void {
  render(
    <TokenPlanProvider
      briefKey="brief-1"
      chunkSizes={[{ file: "src/a.ts", rowCount: 2 }]}
    >
      <ChangesOnlyView
        brief={DELTA}
        compare="last-review"
        delta={DELTA}
        marks={null}
        model={buildBriefViewModel(DELTA)}
        narrative={null}
        skipReason={null}
      />
    </TokenPlanProvider>,
  );
}

beforeEach(() => {
  requestSnippetTokens.mockReset();
  requestSnippetTokens.mockReturnValue({
    promise: Promise.resolve({ status: ChunkTokenStatuses.PLAIN }),
    cancel: () => undefined,
  });
});

afterEach(cleanup);

describe("Changes Only diff tokenization", () => {
  it("reconstructs hunk sides for a delta chunk carrying del rows", () => {
    renderLastReview();

    expect(requestSnippetTokens).toHaveBeenCalledTimes(1);
    expect(requestSnippetTokens.mock.calls[0]?.[0]).toMatchObject({
      filePath: "src/a.ts",
      mode: TokenizeModes.HUNK,
    });
  });
});
