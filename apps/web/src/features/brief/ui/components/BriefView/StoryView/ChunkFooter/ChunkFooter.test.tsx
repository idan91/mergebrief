// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Button } from "@web/components/Button";
import { briefFixture } from "@web/features/brief/test-utils";
import {
  ReviewSessionProvider,
  useReviewSessionActions,
} from "@web/features/review/session";
import type { GroupView } from "../../../../../model/utils/viewModel";
import { I18nProvider } from "../../../../../../../i18n/I18nProvider";
import { buildBriefViewModel } from "../../../../../model/utils/viewModel";
import {
  createReadingPositionStore,
  ReadingPositionProvider,
} from "../../readingPosition";
import { ChunkFooter } from ".";

afterEach(cleanup);

const model = buildBriefViewModel(briefFixture);
const twoGroups = buildTwoGroups(model.groups);

function buildTwoGroups(groups: GroupView[]): GroupView[] {
  const [first] = groups;
  const chunk = first?.chunks[0];
  if (!first || !chunk) {
    throw new Error("fixture has no groups");
  }
  return [first, { ...first, id: "g2", chunks: [{ ...chunk, id: "chunk-c" }] }];
}

interface SeedViewedProps {
  chunkId: string;
}

function SeedViewed({ chunkId }: SeedViewedProps) {
  const actions = useReviewSessionActions();
  return <Button onClick={() => actions.reviewChunk(chunkId)}>seed</Button>;
}

interface FooterOptions {
  marksDisabled?: boolean;
  groups?: GroupView[];
}

function renderFooter(activeChunkId: string, options: FooterOptions = {}) {
  const position = createReadingPositionStore();
  position.getState().actions.setActive(activeChunkId, "g1");
  const wiring = { jumpToChunk: vi.fn(), toggleViewed: vi.fn() };
  render(
    <QueryClientProvider client={new QueryClient()}>
      <I18nProvider>
        <ReviewSessionProvider briefId="test-brief" model={model}>
          <ReadingPositionProvider store={position}>
            <SeedViewed chunkId={activeChunkId} />
            <ChunkFooter
              groups={options.groups ?? model.groups}
              marksDisabled={options.marksDisabled ?? false}
              wiring={wiring}
            />
          </ReadingPositionProvider>
        </ReviewSessionProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );
  return wiring;
}

describe("ChunkFooter", () => {
  it("steps to the next chunk and names its shortcut", () => {
    const wiring = renderFooter("chunk-a");

    const next = screen.getByRole("button", { name: "Next chunk" });
    expect(next.getAttribute("aria-keyshortcuts")).toBe("J");
    fireEvent.click(next);
    expect(wiring.jumpToChunk).toHaveBeenCalledWith("chunk-b");
  });

  it("disables previous on the first chunk and next on the last", () => {
    renderFooter("chunk-a");
    const previous = screen.getByRole("button", { name: "Previous chunk" });
    expect(previous.getAttribute("aria-disabled")).toBe("true");
    cleanup();

    const wiring = renderFooter("chunk-b");
    const next = screen.getByRole("button", { name: "Next chunk" });
    expect(next.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(next);
    expect(wiring.jumpToChunk).not.toHaveBeenCalled();
  });

  it("marks the active chunk viewed", () => {
    const wiring = renderFooter("chunk-a");

    fireEvent.click(screen.getByRole("button", { name: "Mark viewed" }));
    expect(wiring.toggleViewed).toHaveBeenCalledWith("chunk-a");
  });

  it("disables mark viewed while writes are off", () => {
    renderFooter("chunk-a", { marksDisabled: true });

    const viewed = screen.getByRole("button", { name: "Mark viewed" });
    expect(viewed.getAttribute("aria-disabled")).toBe("true");
  });

  it("offers mark unviewed on a chunk already viewed", () => {
    renderFooter("chunk-a");

    fireEvent.click(screen.getByRole("button", { name: "seed" }));
    expect(screen.getByRole("button", { name: "Mark unviewed" })).toBeTruthy();
  });

  it("names the group when a step crosses into it", () => {
    renderFooter("chunk-b", { groups: twoGroups });
    expect(screen.getByRole("button", { name: "Next group" })).toBeTruthy();
    cleanup();

    renderFooter("chunk-c", { groups: twoGroups });
    expect(screen.getByRole("button", { name: "Previous group" })).toBeTruthy();
  });
});
