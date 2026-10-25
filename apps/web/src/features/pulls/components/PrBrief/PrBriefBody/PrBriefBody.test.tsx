// @vitest-environment jsdom
// The wait heading feeds the one polite live region. A screen reader speaks on
// a DOM change, so the contract is: one text change per reason or phase
// change, and none for a poll that returns the same state.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { WaitReasons } from "contract";
import { afterEach, describe, expect, it } from "vitest";
import type { BriefAddressPort } from "@web/features/brief";
import { I18nProvider } from "../../../../../i18n/I18nProvider";
import { deriveBriefRouteState } from "../../../utils/briefRouteState";
import type { DbTimelineSelection } from "../../../utils/dbTimeline";
import type { GenerationSummary, PrSummary } from "../../../types";
import { PrBriefBody } from ".";

const SLOT_LINE =
  "Other briefs are generating. This one starts when a slot frees up.";
const DEBOUNCING_LINE =
  "Holding briefly in case more commits land. The brief starts generating shortly.";

function makeMeta(generation: Partial<GenerationSummary>): PrSummary {
  return {
    repoId: "424242",
    repoSlug: "octo/hello",
    prNumber: 7,
    title: "t",
    state: "open",
    headSha: "head-1",
    briefAvailable: false,
    draft: false,
    viewerIsAuthor: false,
    viewerCanResolve: false,
    viewerCanPush: false,
    appInstalled: true,
    behind: false,
    generation: {
      status: "pending",
      attempts: 0,
      updatedAt: "2026-07-06T12:00:00.000Z",
      ...generation,
    },
    updatedAt: "2026-07-06T12:00:00.000Z",
  };
}

function ignoreNavigation(): void {}

const IGNORED_ADDRESS: BriefAddressPort = {
  link: undefined,
  navigateLink: ignoreNavigation,
  setFocusParam: ignoreNavigation,
  clearDiffParam: ignoreNavigation,
  navigateSearch: ignoreNavigation,
};

const QUERY_CLIENT = new QueryClient();

const STORED_POINT = {
  headSha: "head-0",
  baseSha: "base-0",
  headIndex: 1,
  comparisons: {},
};

/** One stored revision behind a later push the link names. */
const TIMELINE: DbTimelineSelection = {
  points: [STORED_POINT],
  selected: STORED_POINT,
  selectedIndex: 0,
  degraded: false,
};

/** A fresh meta object per call, the way each poll hands the route a new one. */
function makeBody(
  generation: Partial<GenerationSummary>,
  timeline?: DbTimelineSelection,
) {
  return makeBodyFor(makeMeta(generation), timeline);
}

function makeBodyFor(meta: PrSummary, timeline?: DbTimelineSelection) {
  return (
    <QueryClientProvider client={QUERY_CLIENT}>
      <I18nProvider>
        <PrBriefBody
          meta={meta}
          address={IGNORED_ADDRESS}
          onConversationFilterChange={ignoreNavigation}
          prNumber={7}
          repoId="424242"
          searchParams={{}}
          state={deriveBriefRouteState(meta, undefined)}
          timeline={timeline}
        />
      </I18nProvider>
    </QueryClientProvider>
  );
}

/** The page's region leads the switch; a state card may carry its own. */
function getPageRegion(): HTMLElement {
  const [region] = screen.getAllByRole("status");
  if (region === undefined) {
    throw new Error("expected the page's live region");
  }
  return region;
}

function watchLiveRegion() {
  const region = getPageRegion();
  const changes: string[] = [];
  // One entry per mutation record: callbacks batch, so counting callbacks
  // would read two text changes as one.
  const observer = new MutationObserver((records) => {
    const texts = records.map(() => region.textContent);
    changes.push(...texts);
  });
  observer.observe(region, {
    characterData: true,
    childList: true,
    subtree: true,
  });
  return { region, changes, observer };
}

afterEach(cleanup);

describe("PrBriefBody wait announcements", () => {
  it("announces the wait reason in the polite live region", () => {
    render(makeBody({ waitReason: WaitReasons.DEBOUNCING }));

    const region = screen.getByRole("status");

    expect(region.getAttribute("aria-live")).toBe("polite");
    expect(region.textContent).toBe(DEBOUNCING_LINE);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      DEBOUNCING_LINE,
    );
  });

  it("announces once when the wait reason changes", async () => {
    const view = render(makeBody({ waitReason: WaitReasons.DEBOUNCING }));
    const { changes, observer } = watchLiveRegion();

    view.rerender(makeBody({ waitReason: WaitReasons.WAITING_FOR_SLOT }));
    view.rerender(makeBody({ waitReason: WaitReasons.WAITING_FOR_SLOT }));
    await Promise.resolve();
    observer.disconnect();

    expect(changes).toEqual([SLOT_LINE]);
  });

  it("announces once when the phase changes", async () => {
    const view = render(makeBody({ status: "running", phase: "fetching" }));
    const { changes, observer } = watchLiveRegion();

    view.rerender(makeBody({ status: "running", phase: "writing" }));
    view.rerender(makeBody({ status: "running", phase: "writing" }));
    await Promise.resolve();
    observer.disconnect();

    expect(changes).toEqual(["Saving the brief…"]);
  });
});

describe("PrBriefBody state cards under a timeline", () => {
  it("announces the state card, not the stored revision", () => {
    render(makeBody({ status: "failed" }, TIMELINE));

    expect(getPageRegion().textContent).toBe("Brief generation failed.");
  });

  it("announces the wait once a queued run swaps the failed card", async () => {
    const view = render(makeBody({ status: "failed" }, TIMELINE));
    const { changes, observer } = watchLiveRegion();

    view.rerender(makeBody({ waitReason: WaitReasons.DEBOUNCING }, TIMELINE));
    await Promise.resolve();
    observer.disconnect();

    expect(changes).toEqual([DEBOUNCING_LINE]);
  });
});

describe("PrBriefBody on a draft its instance does not generate", () => {
  it("tells a failed draft's reader to mark it ready for review", () => {
    const meta: PrSummary = {
      ...makeMeta({ status: "failed", errorCode: "provider-timeout" }),
      draft: true,
      draftPolicy: { generate: false },
    };
    render(makeBodyFor(meta));

    expect(screen.getByText(/marking this pull request ready/)).toBeTruthy();
    expect(screen.queryByText(/A new push re-queues/)).toBeNull();
  });
});

describe("PrBriefBody awaiting trigger", () => {
  it("renders the on-demand card and announces it politely", () => {
    render(makeBody({ status: "awaiting-trigger" }));

    expect(screen.getByTestId("brief-awaiting-trigger-card")).toBeTruthy();
    expect(getPageRegion().textContent).toBe("Brief available on demand.");
  });

  it("tells an awaiting draft's reader its pushes wait for ready", () => {
    const meta: PrSummary = {
      ...makeMeta({ status: "awaiting-trigger" }),
      draft: true,
      draftPolicy: { generate: false },
    };
    render(makeBodyFor(meta));

    expect(screen.getByText(/once it is marked ready for review/)).toBeTruthy();
    expect(screen.queryByText(/its pushes are briefed as usual/)).toBeNull();
  });

  it("announces the wait once a Generate click swaps the card", async () => {
    const view = render(makeBody({ status: "awaiting-trigger" }, TIMELINE));
    const { changes, observer } = watchLiveRegion();

    view.rerender(makeBody({ waitReason: WaitReasons.DEBOUNCING }, TIMELINE));
    await Promise.resolve();
    observer.disconnect();

    expect(changes).toEqual([DEBOUNCING_LINE]);
  });
});

describe("PrBriefBody awaiting trigger on a closed PR", () => {
  it.each(["closed", "merged"] as const)(
    "announces no brief for a %s PR's waiting head",
    (state) => {
      const meta: PrSummary = {
        ...makeMeta({ status: "awaiting-trigger" }),
        state,
      };
      render(makeBodyFor(meta));

      expect(getPageRegion().textContent).toBe(
        "No brief generated. This pull request is no longer open.",
      );
    },
  );
});
