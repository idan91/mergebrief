// @vitest-environment jsdom
// The wait heading feeds the one polite live region. A screen reader speaks on
// a DOM change, so the contract is: one text change per reason or phase
// change, and none for a poll that returns the same state.
import { render, screen } from "@testing-library/react";
import { WaitReasons } from "contract";
import { describe, expect, it } from "vitest";
import type { BriefAddressPort } from "@web/features/brief";
import { I18nProvider } from "../../../../../i18n/I18nProvider";
import { deriveBriefRouteState } from "../../../utils/briefRouteState";
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

/** A fresh meta object per call, the way each poll hands the route a new one. */
function makeBody(generation: Partial<GenerationSummary>) {
  const meta = makeMeta(generation);
  return (
    <I18nProvider>
      <PrBriefBody
        meta={meta}
        address={IGNORED_ADDRESS}
        onConversationFilterChange={ignoreNavigation}
        prNumber={7}
        repoId="424242"
        searchParams={{}}
        state={deriveBriefRouteState(meta, undefined)}
      />
    </I18nProvider>
  );
}

function watchLiveRegion() {
  const region = screen.getByRole("status");
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

  it("stays silent when a poll returns the same state", async () => {
    const view = render(makeBody({ waitReason: WaitReasons.DEBOUNCING }));
    const { changes, observer } = watchLiveRegion();

    view.rerender(makeBody({ waitReason: WaitReasons.DEBOUNCING }));
    view.rerender(makeBody({ waitReason: WaitReasons.DEBOUNCING }));
    await Promise.resolve();
    observer.disconnect();

    expect(changes).toEqual([]);
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
