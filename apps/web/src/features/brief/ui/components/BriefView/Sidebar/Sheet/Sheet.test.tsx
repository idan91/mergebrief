// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { briefFixture } from "@web/features/brief/test-utils";
import { ReviewSessionProvider } from "@web/features/review/session";
import type { RevisionTimelinePlan } from "../../../../../model/types";
import { buildBriefViewModel } from "../../../../../model/utils/view-model";
import {
  createReadingPositionStore,
  ReadingPositionProvider,
} from "../../reading/reading-position";
import { SidebarTabs, type SidebarTab } from "../types";
import { CHUNK_ROW_SELECTOR } from "../Tabs/ThisPr/ChunkRows/consts";
import { Sheet, type SheetProps } from ".";

const model = buildBriefViewModel(briefFixture);

afterEach(() => {
  cleanup();
  document.body.style.overflow = "";
});

function noop(): void {}

function renderSheet(overrides: Partial<SheetProps> = {}) {
  const props: SheetProps = {
    groups: model.groups,
    activeGroupId: null,
    tab: "this-pr",
    selectTab: noop,
    jumpToGroup: noop,
    afterRevision: noop,
    close: noop,
    ...overrides,
  };
  return render(<Sheet {...props} />);
}

describe("Sheet", () => {
  it("opens as a half-height modal dialog focused on the active tab", () => {
    renderSheet();
    const dialog = screen.getByRole("dialog", { name: "Sidebar" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("data-height")).toBe("half");
    expect(document.activeElement).toBe(
      screen.getByRole("tab", { name: "This PR" }),
    );
    expect(screen.getByRole("tabpanel")).toBeTruthy();
  });

  it("the handle toggles between half and full", () => {
    renderSheet();
    const handle = screen.getByRole("button", {
      name: "Expand the sheet to full height",
    });

    fireEvent.click(handle);
    expect(screen.getByRole("dialog").getAttribute("data-height")).toBe("full");
    expect(
      screen.getByRole("button", { name: "Shrink the sheet to half height" }),
    ).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "Shrink the sheet to half height" }),
    );
    expect(screen.getByRole("dialog").getAttribute("data-height")).toBe("half");
  });

  it("traps Tab inside the dialog", () => {
    renderSheet();
    const dialog = screen.getByRole("dialog");
    const buttons = dialog.querySelectorAll("button");
    const last = buttons[buttons.length - 1];
    if (!last) {
      throw new Error("no controls");
    }
    last.focus();

    fireEvent.keyDown(last, { key: "Tab" });

    expect(document.activeElement).toBe(buttons[0]);
  });
});

const currentChunk = model.groups[0]?.chunks[0];
if (currentChunk === undefined) {
  throw new Error("fixture has no chunk");
}
const currentChunkId = currentChunk.id;

const REVISIONS: RevisionTimelinePlan = {
  view: {
    rows: [
      {
        key: "a",
        ordinal: 1,
        shortSha: "aaaaaaa",
        current: true,
        newest: true,
      },
    ],
  },
  selectRevision: noop,
};

/** A sheet listing chunks with one being read; the returned function moves it to another tab. */
function renderChunkSheet(tab: SidebarTab) {
  const store = createReadingPositionStore();
  store.getState().actions.setActive(currentChunkId, null);
  const renderTree = (shownTab: SidebarTab) => (
    <ReviewSessionProvider briefId="fixture-brief" model={model}>
      <ReadingPositionProvider store={store}>
        <Sheet
          activeGroupId={null}
          afterRevision={noop}
          close={noop}
          groups={model.groups}
          jumpToChunk={noop}
          jumpToGroup={noop}
          revisions={REVISIONS}
          selectTab={noop}
          tab={shownTab}
        />
      </ReadingPositionProvider>
    </ReviewSessionProvider>
  );
  const { rerender } = render(renderTree(tab));
  return (nextTab: SidebarTab) => rerender(renderTree(nextTab));
}

function stubScrollIntoView() {
  return vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(noop);
}

function getCurrentChunkRow(): Element {
  const row = screen
    .getByTestId("sidebar-sheet")
    .querySelector(`${CHUNK_ROW_SELECTOR}[aria-current="true"]`);
  if (row === null) {
    throw new Error("no current chunk row");
  }
  return row;
}

describe("Sheet scroll to the chunk being read", () => {
  it("centres the current chunk when it opens on This PR", () => {
    const scrollIntoView = stubScrollIntoView();
    renderChunkSheet(SidebarTabs.THIS_PR);

    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.contexts[0]).toBe(getCurrentChunkRow());
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "center" });
  });

  it("centres the current chunk once This PR shows after Revisions", () => {
    const scrollIntoView = stubScrollIntoView();
    const showTab = renderChunkSheet(SidebarTabs.REVISIONS);
    expect(scrollIntoView).not.toHaveBeenCalled();

    showTab(SidebarTabs.THIS_PR);

    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.contexts[0]).toBe(getCurrentChunkRow());
  });

  it("centres it again each time This PR comes back", () => {
    const scrollIntoView = stubScrollIntoView();
    const showTab = renderChunkSheet(SidebarTabs.THIS_PR);

    showTab(SidebarTabs.REVISIONS);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);

    showTab(SidebarTabs.THIS_PR);
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
    expect(scrollIntoView.mock.contexts[1]).toBe(getCurrentChunkRow());
  });
});
