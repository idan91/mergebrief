// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChangeGroupCategories } from "types";
import { briefFixture } from "@web/features/brief/fixtures";
import {
  ReviewSessionProvider,
  useReviewSessionActions,
  type ReviewSessionActions,
} from "@web/features/review/session";
import { I18nProvider } from "../../../../../i18n/I18nProvider";
import { GroupViewKinds } from "../../../utils/remainder";
import { buildBriefViewModel } from "../../../utils/viewModel";
import {
  ViewportBands,
  type ViewportBand,
} from "@web/hooks/useViewportBoundary";
import {
  createReadingPositionStore,
  ReadingPositionProvider,
  type ReadingPositionStore,
} from "../readingPosition";
import { useFocusPanel } from "../useFocusPanel";
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

interface PanelProvidersProps {
  position: ReadingPositionStore;
  children: ReactNode;
}

function PanelProviders({ position, children }: PanelProvidersProps) {
  return (
    <I18nProvider>
      <ReviewSessionProvider briefId="test-brief" model={model}>
        <ReadingPositionProvider store={position}>
          {children}
        </ReadingPositionProvider>
      </ReviewSessionProvider>
    </I18nProvider>
  );
}

interface SessionTapProps {
  capture: (actions: ReviewSessionActions) => void;
}

function SessionTap({ capture }: SessionTapProps) {
  capture(useReviewSessionActions());
  return null;
}

interface ControlledPanelProps {
  jumpToChunk: (chunkId: string) => void;
  sheet: boolean;
}

function ControlledPanel({ jumpToChunk, sheet }: ControlledPanelProps) {
  const [open, setOpen] = useState(!sheet);
  return (
    <FocusPanel
      jumpToChunk={jumpToChunk}
      model={model}
      open={open}
      setOpen={setOpen}
      sheet={sheet}
    />
  );
}

function renderSheet() {
  const position = createReadingPositionStore();
  const jumpToChunk = vi.fn();
  position.getState().actions.setActive("chunk-a", "g1");
  render(
    <PanelProviders position={position}>
      <ControlledPanel jumpToChunk={jumpToChunk} sheet />
    </PanelProviders>,
  );
  fireEvent.click(screen.getByTestId("focus-panel-tab"));
  const sheet = screen.getByRole("dialog", {
    name: "Focused change-group context",
  });
  return { sheet, jumpToChunk };
}

interface ToggledPanelProps {
  captureToggle: (toggle: () => void) => void;
}

function ToggledPanel({ captureToggle }: ToggledPanelProps) {
  const [open, setOpen] = useState(true);
  captureToggle(() => setOpen((current) => !current));
  return (
    <FocusPanel
      jumpToChunk={() => undefined}
      model={model}
      open={open}
      setOpen={setOpen}
      sheet={false}
    />
  );
}

interface BandPanelProps {
  band: ViewportBand;
  position: ReadingPositionStore;
}

function BandPanel({ band, position }: BandPanelProps) {
  const control = useFocusPanel({ position, focusMode: true, band });
  return (
    <FocusPanel
      jumpToChunk={() => undefined}
      model={model}
      open={control.open}
      setOpen={control.setOpen}
      sheet={control.sheet}
    />
  );
}

function renderPanel(chunkId: string, groupId: string) {
  const position = createReadingPositionStore();
  const jumpToChunk = vi.fn();
  position.getState().actions.setActive(chunkId, groupId);
  render(
    <PanelProviders position={position}>
      <ControlledPanel jumpToChunk={jumpToChunk} sheet={false} />
    </PanelProviders>,
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

  it("heads the panel with the group position and its core lines", () => {
    const { panel } = renderPanel("chunk-a", "g1");

    expect(panel.textContent).toMatch(/Group 1 of \d+/);
    expect(within(panel).getByRole("button", { name: /core$/ })).toBeTruthy();
    expect(panel.textContent).toContain("2 flags");
  });

  it("shows the reader's dominant category after a reclassify", () => {
    const position = createReadingPositionStore();
    position.getState().actions.setActive("chunk-a", "g1");
    const tap: { actions?: ReviewSessionActions } = {};
    render(
      <PanelProviders position={position}>
        <SessionTap
          capture={(actions) => {
            tap.actions = actions;
          }}
        />
        <ControlledPanel jumpToChunk={() => undefined} sheet={false} />
      </PanelProviders>,
    );
    const panel = screen.getByTestId("focus-panel");
    expect(panel.querySelector('[data-kind="uncertain"]')).not.toBeNull();

    act(() =>
      tap.actions?.reclassifyGroup("g1", ChangeGroupCategories.LOGIC_REFACTOR),
    );

    const dominant = panel.querySelector('[data-kind="dominant"]');
    expect(dominant?.textContent).toBe("Dominant: logic refactor");
    expect(panel.querySelector('[data-kind="uncertain"]')).toBeNull();
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
    const strip = within(panel).getByRole("toolbar", {
      name: "Chunks in this group",
    });
    const current = within(strip)
      .getAllByRole("button")
      .filter((mark) => mark.getAttribute("aria-current") === "true");
    expect(current.map((mark) => mark.getAttribute("aria-label"))).toEqual([
      "leak.test.ts line 1, chunk 2 of 2",
    ]);
  });

  it("gives the strip a fresh tab stop when the group changes", () => {
    const remainder = findRemainder();
    const { panel, position } = renderPanel("chunk-a", "g1");
    const marks = within(panel).getAllByRole("button", { name: /chunk \d/ });
    act(() => marks[1]?.focus());

    act(() =>
      position
        .getState()
        .actions.setActive(remainder.chunk.id, remainder.group.id),
    );

    const strip = within(panel).getByRole("toolbar");
    const stops = within(strip)
      .getAllByRole("button")
      .filter((mark) => mark.tabIndex === 0);
    expect(stops).toHaveLength(1);
  });

  it("names the reader's chunk in the strip's caption", () => {
    const { panel } = renderPanel("chunk-b", "g1");
    const strip = within(panel).getByRole("toolbar", {
      name: "Chunks in this group",
    });
    expect(strip.nextElementSibling?.textContent).toBe("leak.test.ts :12 of 2");
  });

  it("keeps per-chunk line counts out of the panel", () => {
    const { panel } = renderPanel("chunk-a", "g1");

    const facts = getFileFacts(panel);
    expect(facts.textContent).not.toContain("Lines");
    expect(
      [...facts.querySelectorAll("dt")].map((term) => term.textContent),
    ).toEqual(["Concern", "Role"]);
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

  it("jumps to a chunk from the strip", () => {
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

  it("opens as a modal sheet with focus on its heading when narrow", () => {
    const { sheet } = renderSheet();

    expect(sheet.getAttribute("aria-modal")).toBe("true");
    expect(document.activeElement).toBe(
      within(sheet).getByRole("heading", { name: "Fix the cross-param leak" }),
    );
  });

  it("wraps Tab from the strip's tab stop to the sheet's first control", () => {
    const { sheet } = renderSheet();
    const strip = within(sheet).getByRole("toolbar", {
      name: "Chunks in this group",
    });
    const stop = within(strip)
      .getAllByRole("button")
      .find((mark) => mark.tabIndex === 0);
    act(() => stop?.focus());

    fireEvent.keyDown(stop as HTMLElement, { key: "Tab" });

    expect(document.activeElement).toBe(
      within(sheet).getByRole("button", { name: /core$/ }),
    );
  });

  it("closes the sheet on Escape and returns focus to the tab", () => {
    const { sheet } = renderSheet();

    fireEvent.keyDown(sheet, { key: "Escape" });
    expect(sheet.dataset["state"]).toBe("closed");
    expect(document.activeElement).toBe(screen.getByTestId("focus-panel-tab"));
  });

  it("closes the sheet on S and returns focus to the tab", () => {
    const { sheet } = renderSheet();

    fireEvent.keyDown(sheet, { key: "s" });
    expect(sheet.dataset["state"]).toBe("closed");
    expect(document.activeElement).toBe(screen.getByTestId("focus-panel-tab"));
  });

  it("closes the sheet after a jump from its chunk strip", () => {
    const { sheet, jumpToChunk } = renderSheet();

    fireEvent.click(within(sheet).getByRole("button", { name: /leak\.test/ }));
    expect(jumpToChunk).toHaveBeenCalledWith("chunk-b");
    expect(sheet.dataset["state"]).toBe("closed");
  });
  it("sends focus to the tab when S hides it and back when S reopens it", () => {
    const toggler: { toggle?: () => void } = {};
    const position = createReadingPositionStore();
    position.getState().actions.setActive("chunk-a", "g1");
    render(
      <PanelProviders position={position}>
        <ToggledPanel
          captureToggle={(toggle) => {
            toggler.toggle = toggle;
          }}
        />
      </PanelProviders>,
    );
    const panel = screen.getByTestId("focus-panel");
    within(panel).getByRole("region", { name: "Change-group details" }).focus();

    act(() => toggler.toggle?.());
    const tab = screen.getByTestId("focus-panel-tab");
    expect(document.activeElement).toBe(tab);

    act(() => toggler.toggle?.());
    expect(document.activeElement).toBe(
      within(panel).getByRole("heading", { name: "Fix the cross-param leak" }),
    );
  });

  it("keeps focus on the tab when the viewport crosses the breakpoint", () => {
    const position = createReadingPositionStore();
    position.getState().actions.setActive("chunk-a", "g1");
    const panelAt = (band: ViewportBand) => (
      <PanelProviders position={position}>
        <BandPanel band={band} position={position} />
      </PanelProviders>
    );
    const { rerender } = render(panelAt(ViewportBands.DESKTOP));
    screen.getByRole("button", { name: "Hide context (S)" }).focus();

    rerender(panelAt(ViewportBands.NARROW));
    expect(document.activeElement).toBe(screen.getByTestId("focus-panel-tab"));
    expect(screen.getByTestId("focus-panel").getAttribute("role")).toBe(
      "dialog",
    );
  });

  it("leaves focus alone at a crossing when it was never in the panel", () => {
    const position = createReadingPositionStore();
    position.getState().actions.setActive("chunk-a", "g1");
    const panelAt = (band: ViewportBand) => (
      <PanelProviders position={position}>
        <BandPanel band={band} position={position} />
      </PanelProviders>
    );
    const { rerender } = render(panelAt(ViewportBands.DESKTOP));
    expect(document.activeElement).toBe(document.body);

    rerender(panelAt(ViewportBands.NARROW));
    expect(document.activeElement).toBe(document.body);
  });
});
