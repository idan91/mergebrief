// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SearchMissKinds, type SearchMissReason } from "../../../types";
import { SearchMiss } from ".";

afterEach(cleanup);

interface Handlers {
  onShowAllMatches: () => void;
  onShowOtherView: () => void;
  onClearSearch: () => void;
}

function mountMiss(reason: SearchMissReason, archivedView = false): Handlers {
  const handlers: Handlers = {
    onShowAllMatches: vi.fn(),
    onShowOtherView: vi.fn(),
    onClearSearch: vi.fn(),
  };
  render(
    <SearchMiss
      archivedView={archivedView}
      reason={reason}
      searchText="anchor"
      onClearSearch={handlers.onClearSearch}
      onShowAllMatches={handlers.onShowAllMatches}
      onShowOtherView={handlers.onShowOtherView}
    />,
  );
  return handlers;
}

describe("SearchMiss", () => {
  it("counts the matches the filters hide and offers them all", () => {
    const reason = { kind: SearchMissKinds.HIDDEN_BY_FILTERS, count: 3 };
    const handlers = mountMiss(reason);

    expect(
      screen.getByRole("heading", {
        name: "No pull requests match in this view",
      }),
    ).toBeTruthy();
    expect(screen.getByText("3 more match with the filters off.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show all matches" }));
    expect(handlers.onShowAllMatches).toHaveBeenCalledTimes(1);
  });

  it("words one hidden match in the singular", () => {
    mountMiss({ kind: SearchMissKinds.HIDDEN_BY_FILTERS, count: 1 });

    expect(
      screen.getByText("1 more matches with the filters off."),
    ).toBeTruthy();
  });

  it("points at the archive when only archived rows match", () => {
    const reason = { kind: SearchMissKinds.IN_OTHER_VIEW, count: 2 };
    const handlers = mountMiss(reason);

    expect(screen.getByText("2 archived pull requests match.")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Show archived matches" }),
    );
    expect(handlers.onShowOtherView).toHaveBeenCalledTimes(1);
  });

  it("points back at the Inbox from the archived view", () => {
    const reason = { kind: SearchMissKinds.IN_OTHER_VIEW, count: 1 };
    const handlers = mountMiss(reason, true);

    expect(
      screen.getByText("1 pull request outside the archive matches."),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Show matches outside the archive" }),
    );
    expect(handlers.onShowOtherView).toHaveBeenCalledTimes(1);
  });

  it("names the text nothing matches and offers the way out", () => {
    const handlers = mountMiss({ kind: SearchMissKinds.NOWHERE });

    expect(
      screen.getByRole("heading", { name: "No pull requests match “anchor”" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(handlers.onClearSearch).toHaveBeenCalledTimes(1);
  });
});
