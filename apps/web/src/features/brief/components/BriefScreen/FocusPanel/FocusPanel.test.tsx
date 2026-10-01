// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { briefFixture } from "@web/features/brief/fixtures";
import { I18nProvider } from "../../../../../i18n/I18nProvider";
import { GroupViewKinds, buildBriefViewModel } from "../../../utils/viewModel";
import {
  createReadingPositionStore,
  ReadingPositionProvider,
} from "../readingPosition";
import { FocusPanel } from ".";

afterEach(cleanup);

const brief = {
  ...briefFixture,
  unattributed: [
    {
      file: "src/orphan.ts",
      addedRanges: [{ start: 1, end: 3 }],
      removedRanges: [{ start: 2, end: 2 }],
      diff: [{ kind: "add" as const, content: "leftover()", newLine: 1 }],
    },
  ],
};
const model = buildBriefViewModel(brief);

function findRemainder() {
  const group = model.groups.find(
    (candidate) => candidate.kind === GroupViewKinds.UNATTRIBUTED_REMAINDER,
  );
  const chunk = group?.chunks[0];
  if (!group || !chunk) {
    throw new Error("expected a remainder group and chunk");
  }
  return { group, chunk };
}

function renderPanel(chunkId: string, groupId: string) {
  const position = createReadingPositionStore();
  const jumpToChunk = vi.fn();
  position.getState().actions.setActive(chunkId, groupId);
  render(
    <I18nProvider>
      <ReadingPositionProvider store={position}>
        <FocusPanel jumpToChunk={jumpToChunk} model={model} />
      </ReadingPositionProvider>
    </I18nProvider>,
  );
  const panel = screen.getByRole("complementary", {
    name: "Focused change-group context",
  });
  return { panel, position, jumpToChunk };
}

function getFileFacts(panel: HTMLElement): HTMLElement {
  return within(panel).getByRole("region", { name: "This file" });
}

describe("FocusPanel", () => {
  it("shows the group and the active chunk's file facts", () => {
    const { panel } = renderPanel("chunk-a", "g1");

    expect(
      within(panel).getByRole("heading", { name: "Fix the cross-param leak" }),
    ).toBeTruthy();
    const facts = getFileFacts(panel);
    expect(facts.textContent).toContain("src/leak.ts");
    expect(facts.textContent).toContain("implementation");
    expect(facts.textContent).toContain("core");
    expect(facts.textContent).toContain("no-tests");
  });

  it("labels the category chips with their kind", () => {
    const { panel } = renderPanel("chunk-a", "g1");

    const dominant = panel.querySelector('[data-kind="dominant"]');
    expect(dominant?.textContent).toBe("Dominant: bugfix");
  });

  it("follows the active chunk within the group", () => {
    const { panel, position } = renderPanel("chunk-a", "g1");

    act(() => {
      position.getState().actions.setActive("chunk-b", "g1");
    });

    const facts = getFileFacts(panel);
    expect(facts.textContent).toContain("src/leak.test.ts");
    expect(facts.textContent).toContain(
      "No risk-surface attributes on this chunk.",
    );
    const current = within(panel)
      .getAllByRole("button")
      .find((button) => button.getAttribute("aria-current") === "true");
    expect(current?.textContent).toContain("leak.test.ts");
  });

  it("omits flags and risks for the remainder group", () => {
    const remainder = findRemainder();
    const { panel } = renderPanel(remainder.chunk.id, remainder.group.id);

    expect(panel.textContent).toContain(
      "The model did not attribute these lines.",
    );
    expect(panel.textContent).not.toContain("Active chunk risks");
    expect(panel.textContent).not.toMatch(/\d+ flags?/);
    expect(panel.textContent).not.toContain("Concern");
    expect(panel.querySelector('[data-kind="dominant"]')).toBeNull();
  });

  it("jumps to a chunk from the list", () => {
    const { panel, jumpToChunk } = renderPanel("chunk-a", "g1");

    fireEvent.click(within(panel).getByRole("button", { name: /leak\.test/ }));
    expect(jumpToChunk).toHaveBeenCalledWith("chunk-b");
  });

  it("moves focus to the tab on hide and to the heading on show", () => {
    const { panel } = renderPanel("chunk-a", "g1");

    fireEvent.click(
      within(panel).getByRole("button", { name: "Hide context (S)" }),
    );
    expect(panel.dataset["state"]).toBe("closed");
    const tab = screen.getByTestId("focus-panel-tab");
    expect(document.activeElement).toBe(tab);

    fireEvent.click(tab);
    expect(panel.dataset["state"]).toBe("open");
    expect(document.activeElement).toBe(
      within(panel).getByRole("heading", { name: "Fix the cross-param leak" }),
    );
  });
});
