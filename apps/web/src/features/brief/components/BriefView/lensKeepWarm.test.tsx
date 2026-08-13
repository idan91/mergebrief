// @vitest-environment jsdom
// The kept-warm lens panes: once the story tree has shown, switching view
// keeps its DOM mounted inside a `hidden` wrapper (the flip must not pay a
// remount), and a brief switch drops the warm pane entirely — a frozen tree
// must never hold another brief's ids against the re-derived stores.
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

const briefB: Brief = {
  ...briefFixture,
  pr: { ...briefFixture.pr, sha: "b".repeat(40) },
};

function renderView() {
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
  const utils = render(view("brief-a", briefFixture));
  return {
    switchTo: (id: string, value: Brief) => utils.rerender(view(id, value)),
  };
}

const storyChunk = () => document.getElementById("chunk-a");

describe("kept-warm lens panes", () => {
  it("keeps the story tree mounted but hidden while Concerns shows", () => {
    renderView();
    expect(storyChunk()).not.toBeNull();
    expect(storyChunk()?.closest("[hidden]")).toBeNull();

    fireEvent.click(screen.getByRole("radio", { name: "Concerns" }));
    // Still in the DOM — the flip back must not pay a remount…
    expect(storyChunk()).not.toBeNull();
    // …but display:none'd out of paint and the AT tree.
    expect(storyChunk()?.closest("[hidden]")).not.toBeNull();

    fireEvent.click(screen.getByRole("radio", { name: "Story" }));
    expect(storyChunk()?.closest("[hidden]")).toBeNull();
  });

  it("drops the warm pane on a brief switch", () => {
    const { switchTo } = renderView();
    fireEvent.click(screen.getByRole("radio", { name: "Concerns" }));
    expect(storyChunk()).not.toBeNull();

    switchTo("brief-b", briefB);
    // Latches reset: the hidden story tree is unmounted, not kept against
    // the re-derived stores. (The new brief arrives in Story view, so the
    // visible tree is the fresh one.)
    expect(storyChunk()?.closest("[hidden]")).toBeNull();
  });
});
