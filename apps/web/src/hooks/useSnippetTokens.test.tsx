// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PENDING_CEILING_MS } from "@web/utils/diffTokens/consts";
import {
  ChunkTokenStatuses,
  DiffLineKinds,
  GrammarNames,
  TokenFailureReasons,
  TokenizeModes,
  type ChunkTokensResult,
  type DiffLine,
  type GrammarName,
} from "@web/utils/diffTokens/types";
import { useSnippetTokens, type SnippetTokensInput } from "./useSnippetTokens";

const { requestSnippetTokens, cancel } = vi.hoisted(() => ({
  requestSnippetTokens: vi.fn(),
  cancel: vi.fn(),
}));

vi.mock("@web/utils/diffTokens/client", () => ({
  canTokenizeChunks: () => true,
  requestSnippetTokens,
}));

const TS_ROWS: DiffLine[] = [
  { kind: DiffLineKinds.ADD, content: "const a = 1;" },
];
const ADMITTED: ReadonlySet<GrammarName> = new Set([GrammarNames.TYPESCRIPT]);

function StubSnippet(input: SnippetTokensInput) {
  const state = useSnippetTokens(input);

  return (
    <output data-testid="state">
      {state.status === ChunkTokenStatuses.READY
        ? `ready:${String(state.tokensByRow.size)}`
        : state.status}
    </output>
  );
}

function readState(): string {
  return screen.getByTestId("state").textContent ?? "";
}

function settleWith(result: ChunkTokensResult): void {
  requestSnippetTokens.mockReturnValue({
    promise: Promise.resolve(result),
    cancel,
  });
}

function makeReadyResult(): ChunkTokensResult {
  return {
    status: ChunkTokenStatuses.READY,
    tokensByRow: new Map([[0, [{ text: "const", classId: 4 }]]]),
  };
}

beforeEach(() => {
  requestSnippetTokens.mockReset();
  cancel.mockReset();
});

describe("useSnippetTokens pending ceiling", () => {
  function renderSnippet() {
    return render(
      <StubSnippet
        admitted={ADMITTED}
        briefKey="brief-a"
        filePath="src/a.ts"
        rows={TS_ROWS}
        snippetKey="snippet-1"
      />,
    );
  }

  function holdReply(): (result: ChunkTokensResult) => void {
    let settle: (result: ChunkTokensResult) => void = () => undefined;
    requestSnippetTokens.mockReturnValue({
      promise: new Promise<ChunkTokensResult>((resolve) => {
        settle = resolve;
      }),
      cancel,
    });

    return (result) => {
      settle(result);
    };
  }

  it("paints uncoloured once pending outruns the ceiling", async () => {
    vi.useFakeTimers();
    holdReply();
    renderSnippet();

    expect(readState()).toBe(ChunkTokenStatuses.PENDING);
    await act(async () => {
      vi.advanceTimersByTime(PENDING_CEILING_MS);
      await Promise.resolve();
    });

    expect(readState()).toBe(ChunkTokenStatuses.PLAIN);
    vi.useRealTimers();
  });

  it("recolours when the reply lands after the ceiling", async () => {
    vi.useFakeTimers();
    const settle = holdReply();
    renderSnippet();
    await act(async () => {
      vi.advanceTimersByTime(PENDING_CEILING_MS);
      await Promise.resolve();
    });

    await act(async () => {
      settle(makeReadyResult());
      await Promise.resolve();
    });

    expect(readState()).toBe("ready:1");
    vi.useRealTimers();
  });

  it("never paints uncoloured when the reply beats the ceiling", async () => {
    vi.useFakeTimers();
    const settle = holdReply();
    renderSnippet();

    await act(async () => {
      vi.advanceTimersByTime(PENDING_CEILING_MS - 1);
      settle(makeReadyResult());
      await Promise.resolve();
    });
    await act(async () => {
      vi.advanceTimersByTime(PENDING_CEILING_MS);
      await Promise.resolve();
    });

    expect(readState()).toBe("ready:1");
    vi.useRealTimers();
  });
});

describe("useSnippetTokens", () => {
  it("posts nothing and reads plain while it is disabled", () => {
    settleWith(makeReadyResult());
    render(
      <StubSnippet
        admitted={ADMITTED}
        briefKey="brief-a"
        enabled={false}
        filePath="src/a.ts"
        rows={TS_ROWS}
        snippetKey="snippet-1"
      />,
    );

    expect(readState()).toBe(ChunkTokenStatuses.PLAIN);
    expect(requestSnippetTokens).not.toHaveBeenCalled();
  });

  it("asks once the caller enables it", async () => {
    settleWith(makeReadyResult());
    const view = render(
      <StubSnippet
        admitted={ADMITTED}
        briefKey="brief-a"
        enabled={false}
        filePath="src/a.ts"
        rows={TS_ROWS}
        snippetKey="snippet-1"
      />,
    );

    view.rerender(
      <StubSnippet
        admitted={ADMITTED}
        briefKey="brief-a"
        enabled
        filePath="src/a.ts"
        rows={TS_ROWS}
        snippetKey="snippet-1"
      />,
    );

    await vi.waitFor(() => {
      expect(readState()).toBe("ready:1");
    });
    expect(requestSnippetTokens).toHaveBeenCalledTimes(1);
  });

  it("asks for standalone tokens unless a mode is named", () => {
    settleWith(makeReadyResult());
    render(
      <StubSnippet
        admitted={ADMITTED}
        briefKey="brief-a"
        filePath="src/a.ts"
        rows={TS_ROWS}
        snippetKey="snippet-1"
      />,
    );

    expect(requestSnippetTokens.mock.calls[0]?.[0]).toMatchObject({
      mode: TokenizeModes.STANDALONE,
    });
  });

  it("carries the hunk mode the caller named", () => {
    settleWith(makeReadyResult());
    render(
      <StubSnippet
        admitted={ADMITTED}
        briefKey="brief-a"
        filePath="src/a.ts"
        mode={TokenizeModes.HUNK}
        rows={TS_ROWS}
        snippetKey="snippet-1"
      />,
    );

    expect(requestSnippetTokens.mock.calls[0]?.[0]).toMatchObject({
      mode: TokenizeModes.HUNK,
    });
  });

  it("reads plain for a file with no grammar", () => {
    render(
      <StubSnippet
        admitted={ADMITTED}
        briefKey="brief-a"
        filePath="docs/logo.png"
        rows={TS_ROWS}
        snippetKey="snippet-1"
      />,
    );

    expect(readState()).toBe(ChunkTokenStatuses.PLAIN);
    expect(requestSnippetTokens).not.toHaveBeenCalled();
  });

  it("reads plain for a grammar the brief did not admit", () => {
    render(
      <StubSnippet
        admitted={new Set()}
        briefKey="brief-a"
        filePath="src/a.ts"
        rows={TS_ROWS}
        snippetKey="snippet-1"
      />,
    );

    expect(readState()).toBe(ChunkTokenStatuses.PLAIN);
  });

  it("holds pending until the reply lands", async () => {
    settleWith(makeReadyResult());
    render(
      <StubSnippet
        admitted={ADMITTED}
        briefKey="brief-a"
        filePath="src/a.ts"
        rows={TS_ROWS}
        snippetKey="snippet-1"
      />,
    );

    expect(readState()).toBe(ChunkTokenStatuses.PENDING);
    await vi.waitFor(() => {
      expect(readState()).toBe("ready:1");
    });
  });

  it("reads plain when the tokenizer refused the snippet", async () => {
    settleWith({
      status: ChunkTokenStatuses.FAILED,
      reason: TokenFailureReasons.TOKENIZE,
    });
    render(
      <StubSnippet
        admitted={ADMITTED}
        briefKey="brief-a"
        filePath="src/a.ts"
        rows={TS_ROWS}
        snippetKey="snippet-1"
      />,
    );

    await vi.waitFor(() => {
      expect(readState()).toBe(ChunkTokenStatuses.PLAIN);
    });
  });

  it("lets go of the worker when the snippet unmounts", () => {
    settleWith(makeReadyResult());
    const view = render(
      <StubSnippet
        admitted={ADMITTED}
        briefKey="brief-a"
        filePath="src/a.ts"
        rows={TS_ROWS}
        snippetKey="snippet-1"
      />,
    );

    view.unmount();

    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("never paints one snippet's tokens on the next", async () => {
    settleWith(makeReadyResult());
    const view = render(
      <StubSnippet
        admitted={ADMITTED}
        briefKey="brief-a"
        filePath="src/a.ts"
        rows={TS_ROWS}
        snippetKey="snippet-1"
      />,
    );
    await vi.waitFor(() => {
      expect(readState()).toBe("ready:1");
    });

    view.rerender(
      <StubSnippet
        admitted={ADMITTED}
        briefKey="brief-a"
        filePath="src/a.ts"
        rows={TS_ROWS}
        snippetKey="snippet-2"
      />,
    );

    expect(readState()).toBe(ChunkTokenStatuses.PENDING);
  });
});
