// @vitest-environment jsdom
import {
  QueryClient,
  QueryClientProvider,
  focusManager,
} from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { appI18n } from "../../../../i18n/I18nProvider";
import { InstancePanel } from ".";

const fetchMock = vi.fn<typeof fetch>();
const SPEND_POLL_MS = 60_000;

const DAY = {
  dayStartedAt: "2026-10-19T00:00:00.000Z",
  resetsAt: "2026-10-20T00:00:00.000Z",
};

function answerSpend(body: object): void {
  fetchMock.mockImplementation(() => Promise.resolve(Response.json(body)));
}

function answerFailure(): Promise<Response> {
  return Promise.resolve(
    Response.json({ code: "internal-error" }, { status: 500 }),
  );
}

function mountPanel(active: boolean) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function makeTree(shown: boolean) {
    return (
      <I18nextProvider i18n={appI18n}>
        <QueryClientProvider client={queryClient}>
          <InstancePanel active={shown} />
        </QueryClientProvider>
      </I18nextProvider>
    );
  }
  const view = render(makeTree(active));
  return {
    show: () => {
      view.rerender(makeTree(true));
    },
    hide: () => {
      view.rerender(makeTree(false));
    },
  };
}

function stubFrameNow(): void {
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((frame) => {
    frame(0);
    return 0;
  });
}

function answerRefusal(): void {
  const refusal = { error: "operator only", code: "operator-only" };
  fetchMock.mockImplementation(() =>
    Promise.resolve(Response.json(refusal, { status: 403 })),
  );
}

function renderPanel(): void {
  mountPanel(true);
}

async function findSentence(): Promise<string> {
  const heading = await screen.findByRole("heading", { name: "Daily runs" });
  const sentence = heading.nextElementSibling?.textContent ?? "";
  return sentence;
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.restoreAllMocks();
  focusManager.setFocused(undefined);
  vi.useRealTimers();
  cleanup();
  fetchMock.mockReset();
});

describe("InstancePanel", () => {
  it("says today's runs against the cap and when it resets", async () => {
    answerSpend({ startedRuns: 37, cap: 50, ...DAY });
    renderPanel();

    const sentence = await findSentence();

    expect(sentence).toContain(
      "This instance has started 37 of its 50 runs today.",
    );
    expect(sentence).toContain("The count resets at");
    expect(
      screen.getByRole("img", { name: "37 of 50 runs started today" }),
    ).toBeTruthy();
  });

  it("offers the config that changes the cap", async () => {
    answerSpend({ startedRuns: 37, cap: 50, ...DAY });
    renderPanel();

    await screen.findByRole("heading", { name: "Change the cap" });

    expect(screen.getByText(/maxGenerationsPerDay: 50/)).toBeTruthy();
    expect(screen.getByText("mergebrief.config.yaml")).toBeTruthy();
  });

  it("warns that pushes are skipped once the cap is used", async () => {
    answerSpend({ startedRuns: 50, cap: 50, ...DAY });
    renderPanel();

    const sentence = await findSentence();

    expect(sentence).toContain(
      "This instance has used all 50 of its runs today.",
    );
    expect(screen.getByText(/New pushes are skipped/)).toBeTruthy();
  });

  it("names the push or paste that briefs a skipped PR, never a Regenerate", async () => {
    answerSpend({ startedRuns: 50, cap: 50, ...DAY });
    renderPanel();

    await findSentence();
    const note = screen.getByText(/New pushes are skipped/).textContent ?? "";

    expect(note).toContain("is briefed as usual on its next push");
    expect(note).toContain("when its URL is pasted again");
    expect(note).not.toMatch(/regenerate/i);
  });

  it("keeps the warning away while runs are left", async () => {
    answerSpend({ startedRuns: 46, cap: 50, ...DAY });
    renderPanel();

    await findSentence();

    expect(screen.queryByText(/New pushes are skipped/)).toBeNull();
  });

  it("counts an uncapped Instance's runs and offers to add a cap", async () => {
    answerSpend({ startedRuns: 1, ...DAY });
    renderPanel();

    const sentence = await findSentence();

    expect(sentence).toBe(
      "This instance has started 1 run today and has no daily cap.",
    );
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByRole("heading", { name: "Add a cap" })).toBeTruthy();
  });

  it("holds the panel's shape while the read is in flight", () => {
    fetchMock.mockImplementation(() => new Promise(() => {}));
    renderPanel();

    expect(
      screen.getByRole("status", { name: "Loading today's runs" }),
    ).toBeTruthy();
  });

  it("hands focus to the heading once a retry brings the count", async () => {
    stubFrameNow();
    fetchMock.mockImplementationOnce(() => answerFailure());
    renderPanel();

    await screen.findByRole("heading", {
      name: "Today's runs could not be read",
    });
    answerSpend({ startedRuns: 3, cap: 50, ...DAY });
    const button = screen.getByRole("button", { name: "Try again" });
    button.focus();
    fireEvent.click(button);

    const heading = await screen.findByRole("heading", { name: "Daily runs" });
    await waitFor(() => {
      expect(document.activeElement).toBe(heading);
    });
  });

  it("keeps the retry and says so again when it fails again", async () => {
    fetchMock.mockImplementation(() => answerFailure());
    renderPanel();

    await screen.findByRole("heading", {
      name: "Today's runs could not be read",
    });
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toContain(
        "The server did not answer",
      );
    });
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("keeps focus on the retry while a background poll is in flight", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fetchMock.mockImplementationOnce(() => answerFailure());
    renderPanel();
    await screen.findByRole("heading", {
      name: "Today's runs could not be read",
    });
    const button = screen.getByRole("button", { name: "Try again" });
    button.focus();
    fetchMock.mockImplementation(() => new Promise(() => {}));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(SPEND_POLL_MS);
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(document.activeElement).toBe(button);
  });

  it("hands focus to the heading when a poll replaces a focused retry", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fetchMock.mockImplementationOnce(() => answerFailure());
    renderPanel();
    await screen.findByRole("heading", {
      name: "Today's runs could not be read",
    });
    screen.getByRole("button", { name: "Try again" }).focus();
    answerSpend({ startedRuns: 3, cap: 50, ...DAY });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(SPEND_POLL_MS);
    });

    const heading = screen.getByRole("heading", { name: "Daily runs" });
    expect(document.activeElement).toBe(heading);
  });

  it("leaves focus alone when a poll replaces an unfocused failure", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fetchMock.mockImplementationOnce(() => answerFailure());
    renderPanel();
    await screen.findByRole("heading", {
      name: "Today's runs could not be read",
    });
    answerSpend({ startedRuns: 3, cap: 50, ...DAY });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(SPEND_POLL_MS);
    });

    expect(screen.getByRole("heading", { name: "Daily runs" })).toBeTruthy();
    expect(document.activeElement).toBe(document.body);
  });

  it("keeps the last count on screen when a background poll fails", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    answerSpend({ startedRuns: 3, cap: 50, ...DAY });
    renderPanel();
    await findSentence();
    fetchMock.mockImplementation(() => answerFailure());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(SPEND_POLL_MS);
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("heading", { name: "Daily runs" })).toBeTruthy();
    expect(
      screen.getByText(/The latest refresh failed. This count was read at/),
    ).toBeTruthy();
    expect(
      screen.queryByRole("heading", { name: "Today's runs could not be read" }),
    ).toBeNull();
  });

  it("reads nothing while its tab is hidden and reads once it shows", async () => {
    answerSpend({ startedRuns: 3, cap: 50, ...DAY });
    const panel = mountPanel(false);

    expect(fetchMock).not.toHaveBeenCalled();
    panel.show();

    await findSentence();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("settles an operator-only refusal with no retry and no polling", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    answerRefusal();
    renderPanel();

    await screen.findByRole("heading", {
      name: "Today's runs are for operators",
    });
    await act(async () => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
      await vi.advanceTimersByTimeAsync(SPEND_POLL_MS);
    });

    expect(
      screen.getByText(/Only an operator of this instance can read/),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("replaces a held count with the refusal once a poll is refused", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    answerSpend({ startedRuns: 3, cap: 50, ...DAY });
    renderPanel();
    await findSentence();
    answerRefusal();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(SPEND_POLL_MS);
    });

    expect(
      screen.getByRole("heading", { name: "Today's runs are for operators" }),
    ).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Daily runs" })).toBeNull();
  });

  it("hands focus to the refusal heading when a retry is refused", async () => {
    stubFrameNow();
    fetchMock.mockImplementationOnce(() => answerFailure());
    renderPanel();
    await screen.findByRole("heading", {
      name: "Today's runs could not be read",
    });
    answerRefusal();
    const button = screen.getByRole("button", { name: "Try again" });
    button.focus();

    fireEvent.click(button);

    const heading = await screen.findByRole("heading", {
      name: "Today's runs are for operators",
    });
    await waitFor(() => {
      expect(document.activeElement).toBe(heading);
    });
  });

  it("asks nothing again when a refused panel's tab shows again", async () => {
    answerRefusal();
    const panel = mountPanel(true);
    await screen.findByRole("heading", {
      name: "Today's runs are for operators",
    });

    panel.hide();
    panel.show();

    expect(
      screen.getByRole("heading", { name: "Today's runs are for operators" }),
    ).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("states both numbers when the count is past a lowered cap", async () => {
    answerSpend({ startedRuns: 53, cap: 50, ...DAY });
    renderPanel();

    const sentence = await findSentence();

    expect(sentence).toContain(
      "This instance has started 53 runs today, past its cap of 50.",
    );
    expect(screen.getByText(/New pushes are skipped/)).toBeTruthy();
  });
});
