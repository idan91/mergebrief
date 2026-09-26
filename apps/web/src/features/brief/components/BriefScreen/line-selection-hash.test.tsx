// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../../../i18n/I18nProvider";
import { renderInRouter } from "../../../../test/router";
import { briefFixture } from "@web/features/brief/fixtures";
import { BriefView } from "../BriefView";

afterEach(cleanup);

async function renderScreen(navigateHash: (hash: string) => void) {
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  await renderInRouter(
    <I18nProvider>
      <QueryClientProvider client={queryClient}>
        <BriefView
          artifacts={[]}
          brief={briefFixture}
          briefId="fixture-brief"
          navigateHash={navigateHash}
          searchParams={{ view: "full", compare: "off" }}
        />
      </QueryClientProvider>
    </I18nProvider>,
  );
}

function findNumberCell(line: string): HTMLElement {
  const cell = document.querySelector(
    `td[data-select-anchor][data-line-new="${line}"]`,
  );
  if (!(cell instanceof HTMLElement)) throw new Error("expected a number cell");
  return cell;
}

describe("line selection hash", () => {
  it("writes the selection to the hash and clears it on Escape", async () => {
    const navigateHash = vi.fn();
    await renderScreen(navigateHash);
    const cell = await waitFor(() => findNumberCell("10"));
    const row = cell.closest("tr");
    if (row === null) throw new Error("expected a row");

    fireEvent.mouseDown(cell);
    fireEvent.mouseUp(row);
    await waitFor(() =>
      expect(navigateHash).toHaveBeenLastCalledWith("#src/leak.ts:R10"),
    );

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(navigateHash).toHaveBeenLastCalledWith(""));
    expect(navigateHash).toHaveBeenCalledTimes(2);
  });

  it("the chunk glyph writes the chunk hash and stands the selection down", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const navigateHash = vi.fn();
    await renderScreen(navigateHash);
    const cell = await waitFor(() => findNumberCell("10"));
    const row = cell.closest("tr");
    if (row === null) throw new Error("expected a row");
    fireEvent.mouseDown(cell);
    fireEvent.mouseUp(row);
    await waitFor(() =>
      expect(navigateHash).toHaveBeenLastCalledWith("#src/leak.ts:R10"),
    );

    const [glyph] = screen.getAllByRole("button", {
      name: /copy link to this chunk/i,
    });
    if (glyph === undefined) throw new Error("expected a chunk glyph");
    fireEvent.click(glyph);

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(navigateHash).toHaveBeenLastCalledWith(
        expect.stringMatching(/^#chunk-/),
      ),
    );
    expect(document.querySelector("tr[data-selected]")).toBeNull();
    expect(navigateHash).toHaveBeenCalledTimes(2);
  });

  it("never clears a hash it did not write", async () => {
    const navigateHash = vi.fn();
    await renderScreen(navigateHash);
    await waitFor(() => findNumberCell("10"));

    fireEvent.keyDown(window, { key: "Escape" });
    expect(navigateHash).not.toHaveBeenCalled();
  });
});
