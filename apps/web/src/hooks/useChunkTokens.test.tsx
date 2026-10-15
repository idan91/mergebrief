// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useChunkTokens, type ChunkTokensInput } from "./useChunkTokens";
import {
  ChunkTokenStatuses,
  DiffLineKinds,
  GrammarNames,
  TokenFailureReasons,
  type ChunkTokensResult,
  type DiffLine,
  type GrammarName,
} from "@web/utils/diffTokens/types";

const { requestChunkTokens, cancel } = vi.hoisted(() => ({
  requestChunkTokens: vi.fn(),
  cancel: vi.fn(),
}));

vi.mock("@web/utils/diffTokens/client", () => ({
  canTokenizeChunks: () => true,
  requestChunkTokens,
}));

const TS_ROWS: DiffLine[] = [
  { kind: DiffLineKinds.HUNK, content: "@@ -1 +1 @@" },
  { kind: DiffLineKinds.ADD, content: "const a = 1;" },
];

const ADMITTED: ReadonlySet<GrammarName> = new Set([GrammarNames.TYPESCRIPT]);

function StubChunk(input: ChunkTokensInput) {
  const state = useChunkTokens(input);

  return (
    <output data-testid="state">
      {state.status === ChunkTokenStatuses.READY
        ? `ready:${state.tokensByRow.size}`
        : state.status}
    </output>
  );
}

function readState(): string {
  return screen.getByTestId("state").textContent ?? "";
}

function settleWith(result: ChunkTokensResult): void {
  requestChunkTokens.mockReturnValue({
    promise: Promise.resolve(result),
    cancel,
  });
}

function makeReadyResult(): ChunkTokensResult {
  return {
    status: ChunkTokenStatuses.READY,
    tokensByRow: new Map([[1, [{ text: "const", classId: 4 }]]]),
  };
}

beforeEach(() => {
  requestChunkTokens.mockReset();
  cancel.mockReset();
});

describe("useChunkTokens", () => {
  it("reads plain on the first render for a file with no grammar", () => {
    render(
      <StubChunk
        briefKey="brief-a"
        chunkId="chunk-1"
        filePath="docs/logo.png"
        rows={TS_ROWS}
        admitted={ADMITTED}
      />,
    );

    expect(readState()).toBe(ChunkTokenStatuses.PLAIN);
    expect(requestChunkTokens).not.toHaveBeenCalled();
  });

  it("reads plain for a grammar the budget did not admit", () => {
    render(
      <StubChunk
        briefKey="brief-a"
        chunkId="chunk-1"
        filePath="src/a.ts"
        rows={TS_ROWS}
        admitted={new Set()}
      />,
    );

    expect(readState()).toBe(ChunkTokenStatuses.PLAIN);
  });

  it("reads plain for a chunk over the row ceiling", () => {
    const rows: DiffLine[] = Array.from({ length: 1001 }, () => ({
      kind: DiffLineKinds.CTX,
      content: "x",
    }));

    render(
      <StubChunk
        briefKey="brief-a"
        chunkId="chunk-1"
        filePath="src/a.ts"
        rows={rows}
        admitted={ADMITTED}
      />,
    );

    expect(readState()).toBe(ChunkTokenStatuses.PLAIN);
  });

  it("waits on the worker before it reads ready", async () => {
    settleWith(makeReadyResult());
    render(
      <StubChunk
        briefKey="brief-a"
        chunkId="chunk-1"
        filePath="src/a.ts"
        rows={TS_ROWS}
        admitted={ADMITTED}
      />,
    );

    expect(readState()).toBe(ChunkTokenStatuses.PENDING);
    await vi.waitFor(() => {
      expect(readState()).toBe("ready:1");
    });
  });

  it("reads plain when the worker refuses the chunk", async () => {
    settleWith({
      status: ChunkTokenStatuses.FAILED,
      reason: TokenFailureReasons.TOKENIZE,
    });
    render(
      <StubChunk
        briefKey="brief-a"
        chunkId="chunk-1"
        filePath="src/a.ts"
        rows={TS_ROWS}
        admitted={ADMITTED}
      />,
    );

    await vi.waitFor(() => {
      expect(readState()).toBe(ChunkTokenStatuses.PLAIN);
    });
  });

  it("ignores a reply that lands after its chunk changed", async () => {
    let settleFirst: ((result: ChunkTokensResult) => void) | undefined;
    requestChunkTokens.mockImplementationOnce(() => ({
      promise: new Promise<ChunkTokensResult>((resolve) => {
        settleFirst = resolve;
      }),
      cancel,
    }));
    requestChunkTokens.mockReturnValue({
      promise: Promise.resolve({
        status: ChunkTokenStatuses.FAILED,
        reason: TokenFailureReasons.TOKENIZE,
      }),
      cancel,
    });

    const view = render(
      <StubChunk
        briefKey="brief-a"
        chunkId="chunk-1"
        filePath="src/a.ts"
        rows={TS_ROWS}
        admitted={ADMITTED}
      />,
    );
    view.rerender(
      <StubChunk
        briefKey="brief-a"
        chunkId="chunk-2"
        filePath="src/a.ts"
        rows={TS_ROWS}
        admitted={ADMITTED}
      />,
    );
    settleFirst?.(makeReadyResult());

    await vi.waitFor(() => {
      expect(readState()).toBe(ChunkTokenStatuses.PLAIN);
    });
  });

  it("lets go of the worker when its chunk leaves the window", () => {
    settleWith(makeReadyResult());
    const view = render(
      <StubChunk
        briefKey="brief-a"
        chunkId="chunk-1"
        filePath="src/a.ts"
        rows={TS_ROWS}
        admitted={ADMITTED}
      />,
    );
    view.unmount();

    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("never paints the outgoing chunk's tokens on the incoming one", async () => {
    settleWith(makeReadyResult());
    const view = render(
      <StubChunk
        briefKey="brief-a"
        chunkId="chunk-1"
        filePath="src/a.ts"
        rows={TS_ROWS}
        admitted={ADMITTED}
      />,
    );
    await vi.waitFor(() => {
      expect(readState()).toBe("ready:1");
    });

    view.rerender(
      <StubChunk
        briefKey="brief-a"
        chunkId="chunk-2"
        filePath="src/a.ts"
        rows={TS_ROWS}
        admitted={ADMITTED}
      />,
    );

    expect(readState()).toBe(ChunkTokenStatuses.PENDING);
  });

  it("holds one request across a caller that rebuilds its inputs", async () => {
    settleWith(makeReadyResult());
    const view = render(
      <StubChunk
        briefKey="brief-a"
        chunkId="chunk-1"
        filePath="src/a.ts"
        rows={TS_ROWS}
        admitted={ADMITTED}
      />,
    );
    await vi.waitFor(() => {
      expect(readState()).toBe("ready:1");
    });

    view.rerender(
      <StubChunk
        briefKey="brief-a"
        chunkId="chunk-1"
        filePath="src/a.ts"
        rows={[...TS_ROWS]}
        admitted={new Set([GrammarNames.TYPESCRIPT])}
      />,
    );

    expect(requestChunkTokens).toHaveBeenCalledTimes(1);
    expect(cancel).not.toHaveBeenCalled();
    expect(readState()).toBe("ready:1");
  });
});
