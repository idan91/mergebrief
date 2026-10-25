// @vitest-environment jsdom
// The wait heading matrix: reason by damped notice while pending, phase while
// running. Expected lines are the catalog's literal copy.
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WaitReasons, type WaitReason } from "contract";
import { PrStates } from "types";
import { appI18n, I18nProvider } from "../../../../../i18n/I18nProvider";

import type { RerunNoteInput } from "../failed-head";
import { WaitCard, waitLabel } from ".";

const t = appI18n.t;

const PENDING_LINE = "Pending: the brief will start generating shortly.";
const DEBOUNCING_LINE =
  "Holding briefly in case more commits land. The brief starts generating shortly.";
const SLOT_LINE =
  "Other briefs are generating. This one starts when a slot frees up.";
const GENERATING_LINE = "Generating the brief…";
const DAMPED_NOTICE = "Pending: draft mode note.";
const OPEN_INSTALLED: RerunNoteInput = {
  prState: PrStates.OPEN,
  appInstalled: true,
  awaitsReadyForReview: false,
};
const STALLED_LINE =
  "Generation for this push stopped: its queued job used every attempt.";

interface PendingCase {
  readonly name: string;
  readonly waitReason: WaitReason | undefined;
  readonly pendingNotice: string | undefined;
  readonly expected: string;
}

const PENDING_CASES: readonly PendingCase[] = [
  {
    name: "no reason and no notice shows the generic pending line",
    waitReason: undefined,
    pendingNotice: undefined,
    expected: PENDING_LINE,
  },
  {
    name: "no reason on a damped draft shows the notice",
    waitReason: undefined,
    pendingNotice: DAMPED_NOTICE,
    expected: DAMPED_NOTICE,
  },
  {
    name: "debouncing shows the debouncing line",
    waitReason: WaitReasons.DEBOUNCING,
    pendingNotice: undefined,
    expected: DEBOUNCING_LINE,
  },
  {
    name: "debouncing on a damped draft keeps the notice",
    waitReason: WaitReasons.DEBOUNCING,
    pendingNotice: DAMPED_NOTICE,
    expected: DAMPED_NOTICE,
  },
  {
    name: "waiting for a slot shows the slot line",
    waitReason: WaitReasons.WAITING_FOR_SLOT,
    pendingNotice: undefined,
    expected: SLOT_LINE,
  },
  {
    name: "waiting for a slot wins over a damped notice",
    waitReason: WaitReasons.WAITING_FOR_SLOT,
    pendingNotice: DAMPED_NOTICE,
    expected: SLOT_LINE,
  },
  {
    name: "a stalled head wins over a damped notice",
    waitReason: WaitReasons.STALLED,
    pendingNotice: DAMPED_NOTICE,
    expected: STALLED_LINE,
  },
];

interface RunningCase {
  readonly name: string;
  readonly phase: string | undefined;
  readonly expected: string;
}

const RUNNING_CASES: readonly RunningCase[] = [
  { name: "no phase", phase: undefined, expected: GENERATING_LINE },
  {
    name: "fetching",
    phase: "fetching",
    expected: "Fetching the pull request…",
  },
  { name: "redacting", phase: "redacting", expected: "Redacting secrets…" },
  { name: "generating", phase: "generating", expected: GENERATING_LINE },
  { name: "writing", phase: "writing", expected: "Saving the brief…" },
  {
    name: "an unknown phase",
    phase: "reading-diff",
    expected: GENERATING_LINE,
  },
  {
    name: "an object prototype key as phase",
    phase: "constructor",
    expected: GENERATING_LINE,
  },
];

describe("waitLabel while pending", () => {
  it.each(PENDING_CASES)("$name", ({ waitReason, pendingNotice, expected }) => {
    const label = waitLabel(t, {
      status: "pending",
      phase: undefined,
      waitReason,
      pendingNotice,
    });

    expect(label).toBe(expected);
  });
});

describe("waitLabel while running", () => {
  it.each(RUNNING_CASES)("$name names its own line", ({ phase, expected }) => {
    const label = waitLabel(t, {
      status: "running",
      phase,
      waitReason: undefined,
      pendingNotice: undefined,
    });

    expect(label).toBe(expected);
  });

  it("ignores a damped notice and a stale wait reason", () => {
    const label = waitLabel(t, {
      status: "running",
      phase: undefined,
      waitReason: WaitReasons.WAITING_FOR_SLOT,
      pendingNotice: DAMPED_NOTICE,
    });

    expect(label).toBe(GENERATING_LINE);
  });
});

describe("WaitCard on a stalled head", () => {
  it("names no brief coming and shows no spinner", () => {
    render(
      <I18nProvider>
        <WaitCard
          phase={undefined}
          prNumber={7}
          repoId="42"
          span={undefined}
          rerun={OPEN_INSTALLED}
          status="pending"
          waitReason={WaitReasons.STALLED}
        />
      </I18nProvider>,
    );

    expect(screen.getByRole("heading").textContent).toBe(STALLED_LINE);
    expect(
      screen.getByText(/^No brief is on the way for this push\. A new push/),
    ).toBeTruthy();
    expect(screen.queryByTestId("empty-block-spinner")).toBeNull();
  });

  it("points a stalled url row at a paste", () => {
    const urlRow = { ...OPEN_INSTALLED, appInstalled: false };
    render(
      <I18nProvider>
        <WaitCard
          phase={undefined}
          prNumber={7}
          repoId="42"
          rerun={urlRow}
          span={undefined}
          status="pending"
          waitReason={WaitReasons.STALLED}
        />
      </I18nProvider>,
    );

    expect(
      screen.getByText(/Paste this pull request's URL on the home page/),
    ).toBeTruthy();
  });
});
