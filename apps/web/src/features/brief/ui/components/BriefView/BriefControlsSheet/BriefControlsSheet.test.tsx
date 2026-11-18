// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Button } from "@web/components/Button";
import { DEFAULT_CONVERSATION_FILTER } from "@web/features/conversation/utils";
import { MOBILE_QUERY } from "@web/hooks/useMobileViewport";
import { resetMediaQueries, setMediaQueryMatches } from "@web/test/setup";
import type { Brief, ComparisonMarks } from "../../../../model/types";
import {
  buildBriefViewModel,
  type AttributeRail,
} from "../../../../model/utils/view-model";
import { REVISION_JUMP_ATTR } from "../../../../model/comparison/runs";
import {
  CompareParams,
  type BriefComparisonPlan,
} from "../../../../model/comparison/types";
import {
  briefFixture,
  makeComparisonState,
  mountBriefView,
} from "../../../../test-utils";
import { renderInRouter } from "../../../../../../test/router";
import { useRiskAttrCycle } from "../hooks/useRiskAttrCycle";
import { RiskAttrsDisclosure } from "../RiskAttrsDisclosure";
import { Header, type HeaderProps } from "../Header";
import { createBriefViewStore } from "../store";
import { BriefControlsSheet, type BriefControlsSheetProps } from ".";

const brief: Brief = {
  ...briefFixture,
  generation: { provider: "anthropic", model: "m-1", effort: "high" },
};

const STUB_PATHS = ["/briefs/$briefId"] as const;

type SheetToolbar = NonNullable<BriefControlsSheetProps["toolbar"]>;

function makeSheetToolbar(overrides: Partial<SheetToolbar> = {}): SheetToolbar {
  return {
    filter: undefined,
    rail: { entries: [], floorFired: false },
    jumpToGroup: vi.fn(),
    riskAttrCycle: { positions: new Map(), advance: vi.fn() },
    supportingCollapse: "none",
    toggleCollapseSupporting: vi.fn(),
    startReadThrough: vi.fn(),
    comparison: makeComparisonState(CompareParams.OFF, 0),
    revisionNav: { jumpNext: vi.fn(), jumpPrev: vi.fn() },
    ...overrides,
  };
}

async function renderSheet(overrides: Partial<BriefControlsSheetProps> = {}) {
  const props: BriefControlsSheetProps = {
    brief,
    briefId: "test-brief",
    model: buildBriefViewModel(brief),
    totals: { reviewed: 1, chunkTotal: 6, flagsResolved: 1, flagTotal: 3 },
    availability: { previousBrief: false, lastReview: false },
    compareState: { view: "full", compare: "off" },
    openSubmit: vi.fn(),
    draftCommentCount: 2,
    toggleShortcuts: vi.fn(),
    toolbar: makeSheetToolbar(),
    close: vi.fn(),
    ...overrides,
  };
  await renderInRouter(
    <BriefControlsSheet {...props} />,
    undefined,
    STUB_PATHS,
  );
  return props;
}

describe("BriefControlsSheet", () => {
  afterEach(cleanup);

  it("is a modal dialog holding the view, compare and stats", async () => {
    await renderSheet();
    const dialog = screen.getByRole("dialog", { name: "Brief controls" });

    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(
      within(dialog).getByRole("radio", { name: "Full brief" }),
    ).toBeTruthy();
    expect(within(dialog).getByText("Chunks").nextSibling?.textContent).toBe(
      "1/6",
    );
    expect(within(dialog).getByText("Flags").nextSibling?.textContent).toBe(
      "1/3",
    );
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("closes from Escape", async () => {
    const { close } = await renderSheet();

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

    expect(close).toHaveBeenCalledTimes(1);
  });

  it("submits from the sheet after closing it", async () => {
    const { close, openSubmit } = await renderSheet();

    fireEvent.click(screen.getByRole("button", { name: /^Submit/ }));

    expect(close).toHaveBeenCalledTimes(1);
    expect(openSubmit).toHaveBeenCalledTimes(1);
  });

  it("starts a read-through after closing and collapses in place", async () => {
    const { close, toolbar } = await renderSheet();

    fireEvent.click(screen.getByRole("button", { name: "Start read-through" }));
    expect(close).toHaveBeenCalledTimes(1);
    expect(toolbar?.startReadThrough).toHaveBeenCalledTimes(1);

    fireEvent.click(
      screen.getByRole("button", { name: "Collapse supporting" }),
    );
    expect(toolbar?.toggleCollapseSupporting).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("labels the conversation filter row by the threads it filters", async () => {
    await renderSheet({
      toolbar: makeSheetToolbar({
        filter: {
          filter: DEFAULT_CONVERSATION_FILTER,
          verdicts: [{ state: "APPROVED", humanCount: 1, botCount: 0 }],
          reviewers: [{ login: "alice", isBot: false }],
          hiddenInlineThreads: 0,
          onChange: vi.fn(),
        },
        startReadThrough: undefined,
      }),
    });
    const dialog = screen.getByRole("dialog", { name: "Brief controls" });

    expect(within(dialog).getByText("Filter threads")).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Filter" })).toBeTruthy();
  });

  it("offers no reading controls where the toolbar region is hidden", async () => {
    await renderSheet({ toolbar: undefined });

    expect(
      screen.queryByRole("button", { name: "Start read-through" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Collapse supporting" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Next change" })).toBeNull();
    expect(screen.getByRole("button", { name: /^Submit/ })).toBeTruthy();
  });

  it("offers Mark ready instead of Submit on the viewer's own draft", async () => {
    const order: string[] = [];
    const markReady = vi.fn(() => order.push("mark-ready"));
    await renderSheet({
      close: () => order.push("close"),
      ownDraft: { markReady, pending: false },
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Mark ready for review" }),
    );

    expect(order).toEqual(["close", "mark-ready"]);
    expect(screen.queryByRole("button", { name: /^Submit/ })).toBeNull();
  });
});

describe("BriefControlsSheet change stepper", () => {
  afterEach(cleanup);

  it("offers no change stepper with compare off", async () => {
    await renderSheet();

    expect(screen.queryByRole("button", { name: "Next change" })).toBeNull();
  });

  it("offers no change stepper when the comparison found none", async () => {
    await renderSheet({
      toolbar: makeSheetToolbar({
        comparison: makeComparisonState(CompareParams.LAST_REVIEW, 0),
      }),
    });

    expect(screen.queryByRole("button", { name: "Next change" })).toBeNull();
  });

  it.each([
    [1, "1 change"],
    [5, "5 changes"],
  ])("counts %i changed runs as %s in the sheet", async (runCount, label) => {
    await renderSheet({
      toolbar: makeSheetToolbar({
        comparison: makeComparisonState(CompareParams.LAST_REVIEW, runCount),
      }),
    });
    const stepper = within(screen.getByRole("dialog")).getByRole("group", {
      name: "Jump between changes since your last review",
    });

    expect(stepper.textContent).toBe(label);
  });

  it.each([
    ["Next change", "jump-next"],
    ["Previous change", "jump-prev"],
  ])("closes the sheet, then steps to the %s", async (name, step) => {
    const order: string[] = [];
    await renderSheet({
      close: () => order.push("close"),
      toolbar: makeSheetToolbar({
        comparison: makeComparisonState(CompareParams.PREVIOUS_BRIEF, 3),
        revisionNav: {
          jumpNext: () => {
            order.push("jump-next");
            return undefined;
          },
          jumpPrev: () => {
            order.push("jump-prev");
            return undefined;
          },
        },
      }),
    });

    fireEvent.click(screen.getByRole("button", { name }));

    expect(order).toEqual(["close", step]);
  });
});

describe("BriefControlsSheet shared toolbar rules", () => {
  afterEach(cleanup);

  it.each([
    ["none", "false"],
    ["some", "mixed"],
    ["all", "true"],
  ] as const)("presses collapse for %s as %s", async (collapse, pressed) => {
    await renderSheet({
      toolbar: makeSheetToolbar({ supportingCollapse: collapse }),
    });

    expect(
      screen
        .getByRole("button", { name: "Collapse supporting" })
        .getAttribute("aria-pressed"),
    ).toBe(pressed);
  });
});

const remainderBrief: Brief = {
  ...brief,
  unattributed: [
    {
      file: "src/orphan.ts",
      addedRanges: [{ start: 1, end: 4 }],
      removedRanges: [{ start: 2, end: 3 }],
    },
  ],
};

function readHeaderStat(label: string): string | null {
  const header = screen.getByRole("banner");
  return (
    within(header).getByText(label).querySelector("b")?.textContent ?? null
  );
}

function readSheetStat(label: string): string | null {
  const sheet = screen.getByRole("dialog");
  return within(sheet).getByText(label).nextSibling?.textContent ?? null;
}

describe("BriefControlsSheet stats match the header", () => {
  afterEach(cleanup);

  it.each([
    ["a reviewer", undefined],
    ["the author's own draft", { markReady: vi.fn(), pending: false }],
  ])("prints the header's figures for %s", async (_viewer, ownDraft) => {
    const model = buildBriefViewModel(remainderBrief);
    const totals = {
      reviewed: 1,
      chunkTotal: 6,
      flagsResolved: 1,
      flagTotal: 3,
    };
    const headerProps: HeaderProps = {
      brief: remainderBrief,
      briefId: "test-brief",
      model,
      totals,
      progress: 0,
      openSubmit: vi.fn(),
      draftCommentCount: 0,
      availability: { previousBrief: false, lastReview: false },
      compareState: { view: "full", compare: "off" },
      ownDraft,
      jumpToGroup: vi.fn(),
      jumpToGroupHeading: vi.fn(),
      toggleShortcuts: vi.fn(),
      focusMode: false,
      largeTitle: null,
    };
    await renderInRouter(
      <>
        <Header {...headerProps} />
        <BriefControlsSheet
          availability={headerProps.availability}
          brief={remainderBrief}
          briefId="test-brief"
          close={vi.fn()}
          compareState={headerProps.compareState}
          draftCommentCount={0}
          model={model}
          openSubmit={vi.fn()}
          ownDraft={ownDraft}
          toggleShortcuts={vi.fn()}
          totals={totals}
        />
      </>,
      undefined,
      STUB_PATHS,
    );
    const headerRemainder = screen.getByTestId("unattributed-disclosure");
    const sheetRemainder = readSheetStat("Unattributed");

    expect(readSheetStat("Chunks")).toBe(readHeaderStat("Chunks"));
    expect(readSheetStat("Flags")).toBe(readHeaderStat("Flags"));
    expect(headerRemainder.textContent).toContain("+4");
    expect(headerRemainder.textContent).toContain("−2");
    expect(sheetRemainder).toContain("+4");
    expect(sheetRemainder).toContain("−2");
  });
});

const twoGroupBrief: Brief = {
  ...briefFixture,
  changeGroups: [
    ...briefFixture.changeGroups,
    { ...briefFixture.changeGroups[0]!, id: "g2", title: "Second group" },
  ],
  chunks: [
    ...briefFixture.chunks,
    {
      ...briefFixture.chunks[0]!,
      id: "chunk-c",
      changeGroupId: "g2",
      file: "src/other.ts",
      riskSurface: ["no-tests"],
      riskNotes: [],
    },
  ],
};

const TWO_GROUP_RAIL: AttributeRail = {
  entries: [
    {
      attr: "no-tests",
      source: "built-in",
      floor: false,
      groupIds: ["g1", "g2"],
    },
  ],
  floorFired: false,
};

interface CycleHostProps {
  jumpToGroup: (groupId: string) => void;
}

/** A disclosure that unmounts on every jump, the way the sheet closes. */
function CycleHost({ jumpToGroup }: CycleHostProps) {
  const [viewStore] = useState(() =>
    createBriefViewStore({ openChunkIds: [], focusMode: false }),
  );
  const cycle = useRiskAttrCycle(viewStore, true);
  const [open, setOpen] = useState(true);
  if (!open) {
    return <Button onClick={() => setOpen(true)}>Reopen</Button>;
  }
  return (
    <RiskAttrsDisclosure
      cycle={cycle}
      jumpToGroup={(groupId) => {
        setOpen(false);
        jumpToGroup(groupId);
      }}
      rail={TWO_GROUP_RAIL}
      sheet
    />
  );
}

function tapNoTestsChip(): void {
  fireEvent.click(screen.getByRole("button", { name: /Risk attributes/ }));
  fireEvent.click(screen.getByRole("button", { name: /No tests/ }));
}

function openPhoneControls(): HTMLElement {
  fireEvent.click(
    within(screen.getByTestId("phone-bar")).getByRole("button", {
      name: "Brief controls",
    }),
  );
  const sheet = screen.getByRole("dialog", { name: "Brief controls" });
  fireEvent.click(
    within(sheet).getByRole("button", { name: /Risk attributes/ }),
  );
  return within(sheet).getByRole("button", { name: /No tests/ });
}

describe("BriefControlsSheet risk attribute chips", () => {
  afterEach(() => {
    cleanup();
    resetMediaQueries();
  });

  it("taps, reopens and taps again, landing on group 2", () => {
    const jumpToGroup = vi.fn();
    render(<CycleHost jumpToGroup={jumpToGroup} />);

    tapNoTestsChip();
    fireEvent.click(screen.getByRole("button", { name: "Reopen" }));
    tapNoTestsChip();

    expect(jumpToGroup.mock.calls.map(([id]) => id)).toEqual(["g1", "g2"]);
  });

  it("offers the next carrying group each time the sheet reopens", async () => {
    setMediaQueryMatches(MOBILE_QUERY, true);
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    await mountBriefView({ brief: twoGroupBrief });

    fireEvent.click(openPhoneControls());
    const second = openPhoneControls();
    expect(second.textContent).toContain("group 2 of 2");
    fireEvent.click(second);

    expect(openPhoneControls().textContent).toContain("group 1 of 2");
  });
});

const LAST_REVIEW_MARKS: ComparisonMarks = {
  baselineSha: "chk1234deadbeef00",
  headSha: briefFixture.pr.sha,
  baselineLabel: "checkpoint",
  baselineIndex: 1,
  files: [
    {
      file: "src/leak.ts",
      addedRanges: [{ start: 10, end: 10 }],
      removedRanges: [],
    },
  ],
};

const LAST_REVIEW_STEPPER = "Jump between changes since your last review";

const LAST_REVIEW_PLAN: BriefComparisonPlan = {
  lastReview: {
    marks: {
      queryKey: ["sheet-last-review-marks"],
      queryFn: () => Promise.resolve(LAST_REVIEW_MARKS),
    },
  },
};

describe("BriefControlsSheet change stepper on the screen", () => {
  afterEach(() => {
    cleanup();
    resetMediaQueries();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("counts what the toolbar counts and steps from the phone", async () => {
    setMediaQueryMatches(MOBILE_QUERY, true);
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    vi.stubGlobal("CSS", { escape: (value: string) => value });
    await mountBriefView({
      comparisonPlan: LAST_REVIEW_PLAN,
      searchParams: { view: "full", compare: "last-review" },
    });
    const toolbarCount = await within(
      screen.getByTestId("reading-toolbar"),
    ).findByRole("group", { name: LAST_REVIEW_STEPPER });
    fireEvent.click(
      within(screen.getByTestId("phone-bar")).getByRole("button", {
        name: "Brief controls",
      }),
    );
    const sheet = screen.getByRole("dialog", { name: "Brief controls" });
    const sheetCount = within(sheet).getByRole("group", {
      name: LAST_REVIEW_STEPPER,
    });

    expect(sheetCount.textContent).toBe("1 change");
    expect(sheetCount.textContent).toBe(toolbarCount.textContent);
    fireEvent.click(within(sheet).getByRole("button", { name: "Next change" }));
    expect(screen.queryByRole("dialog", { name: "Brief controls" })).toBeNull();
    await waitFor(() =>
      expect(document.activeElement?.hasAttribute(REVISION_JUMP_ATTR)).toBe(
        true,
      ),
    );
  });
});
