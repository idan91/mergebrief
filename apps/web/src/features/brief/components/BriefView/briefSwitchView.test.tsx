// @vitest-environment jsdom
// The in-place brief switch at the screen level: with the subtree no longer
// keyed by brief id, screen-local overlay state and the reading session must
// reset explicitly when briefId swaps — an open submit surface or a Viewed
// mark surviving into the next brief is exactly the class of bug the old
// remount masked. Ids collide across briefs on purpose (positional c1..cN).
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { I18nProvider } from "../../../../i18n/I18nProvider";
import { BriefView } from "./BriefView";
import type { Brief } from "../../types";
import { briefFixture } from "../../utils/fixtures";

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
});

/** A second revision: same chunk/group/flag ids, different sha and content. */
const briefB: Brief = {
  ...briefFixture,
  pr: { ...briefFixture.pr, sha: "b".repeat(40) },
  summary: "A different revision's summary.",
};

function renderView(briefId: string, brief: Brief) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = (id: string, value: Brief) => (
    <I18nProvider>
      <QueryClientProvider client={queryClient}>
        <BriefView
          artifacts={[]}
          brief={value}
          briefId={id}
          searchParams={{}}
        />
      </QueryClientProvider>
    </I18nProvider>
  );
  const utils = render(view(briefId, brief));
  return {
    switchTo: (id: string, value: Brief) => utils.rerender(view(id, value)),
  };
}

describe("in-place brief switch through the screen", () => {
  it("clears Viewed marks — same chunk ids, different brief", () => {
    const { switchTo } = renderView("brief-a", briefFixture);
    const viewed = screen.getAllByRole("checkbox", { name: /^Viewed/ })[0];
    if (!viewed) throw new Error("no Viewed checkbox rendered");
    fireEvent.click(viewed);
    expect((viewed as HTMLInputElement).checked).toBe(true);

    switchTo("brief-b", briefB);
    const after = screen.getAllByRole("checkbox", { name: /^Viewed/ })[0];
    expect((after as HTMLInputElement).checked).toBe(false);
  });

  it("drops focus mode and the shortcuts overlay on a brief switch", () => {
    const { switchTo } = renderView("brief-a", briefFixture);
    fireEvent.keyDown(window, { key: "?" });
    const shortcuts = document.querySelector(
      '[aria-labelledby="shortcuts-modal-heading"]',
    );
    expect(shortcuts?.closest("[data-state]")).toMatchObject({
      dataset: { state: "open" },
    });

    switchTo("brief-b", briefB);
    expect(shortcuts?.closest("[data-state]")).toMatchObject({
      dataset: { state: "closed" },
    });
  });

  it("closes the submit surface when the brief changes under it", () => {
    const { switchTo } = renderView("brief-a", briefFixture);
    const modal = () =>
      document.querySelector('[aria-labelledby="submit-modal-heading"]');
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    expect(modal()?.closest("[data-state]")).toMatchObject({
      dataset: { state: "open" },
    });

    switchTo("brief-b", briefB);
    expect(modal()?.closest("[data-state]")).toMatchObject({
      dataset: { state: "closed" },
    });
  });
});
