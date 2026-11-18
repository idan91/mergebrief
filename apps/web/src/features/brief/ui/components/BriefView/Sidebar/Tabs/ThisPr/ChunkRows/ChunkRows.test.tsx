// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { briefFixture } from "@web/features/brief/test-utils";
import { buildBriefViewModel } from "../../../../../../../model/utils/view-model";
import {
  createReadingPositionStore,
  ReadingPositionProvider,
} from "../../../../reading/reading-position";
import { ChunkRows } from ".";

vi.mock("@web/features/review/session", () => ({
  useReviewSession: (
    select: (state: { reviewedChunks: ReadonlySet<string> }) => unknown,
  ) => select({ reviewedChunks: new Set(["viewed-chunk"]) }),
}));

const [firstChunk, secondChunk] = buildBriefViewModel(
  briefFixture,
).groups.flatMap((group) => group.chunks);
if (firstChunk === undefined || secondChunk === undefined) {
  throw new Error("fixture needs two chunks");
}
const chunks = [firstChunk, { ...secondChunk, id: "viewed-chunk" }];

function renderRows(jumpToChunk = vi.fn()) {
  const store = createReadingPositionStore();
  store.getState().actions.setActive(firstChunk?.id ?? "", null);
  render(
    <ReadingPositionProvider store={store}>
      <ChunkRows chunks={chunks} jumpToChunk={jumpToChunk} />
    </ReadingPositionProvider>,
  );
  return jumpToChunk;
}

describe("ChunkRows", () => {
  afterEach(cleanup);

  it("shows a bidi override in a file name instead of obeying it", () => {
    const store = createReadingPositionStore();
    const hostile = { ...firstChunk, file: "src/pay\u202Egnp.exe" };
    render(
      <ReadingPositionProvider store={store}>
        <ChunkRows chunks={[hostile]} jumpToChunk={vi.fn()} />
      </ReadingPositionProvider>,
    );

    const row = screen.getByRole("button");
    expect(row.textContent).not.toContain("\u202E");
    expect(row.textContent).toContain("U+202E");
  });

  it("tells same-named files apart by their folder", () => {
    const store = createReadingPositionStore();
    const header = { ...firstChunk, file: "apps/web/Header/index.tsx" };
    const footer = { ...secondChunk, file: "apps/web/Footer/index.tsx" };
    render(
      <ReadingPositionProvider store={store}>
        <ChunkRows chunks={[header, footer]} jumpToChunk={vi.fn()} />
      </ReadingPositionProvider>,
    );

    const [first, second] = screen.getAllByRole("button");
    expect(first?.textContent).toContain("…/Header/index.tsx");
    expect(second?.textContent).toContain("…/Footer/index.tsx");
  });

  it("marks the chunk being read", () => {
    renderRows();

    const [current, other] = screen.getAllByRole("button");
    expect(current?.getAttribute("aria-current")).toBe("true");
    expect(other?.getAttribute("aria-current")).toBeNull();
  });

  it("names a viewed chunk as viewed for a screen reader", () => {
    renderRows();

    const [unviewed, viewed] = screen.getAllByRole("button");
    expect(unviewed?.textContent).not.toContain("Viewed");
    expect(viewed?.textContent).toContain("Viewed");
  });

  it("jumps to the chunk a row names", () => {
    const jumpToChunk = renderRows();

    const [, viewed] = screen.getAllByRole("button");
    if (viewed === undefined) {
      throw new Error("expected a second row");
    }
    fireEvent.click(viewed);

    expect(jumpToChunk.mock.calls[0]?.[0]).toBe("viewed-chunk");
  });
});
