// @vitest-environment jsdom
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type * as ApiFetchModule from "../../../../../data/apiFetch";

vi.mock("../../../../../data/apiFetch", async (importOriginal) => {
  const actual = await importOriginal<typeof ApiFetchModule>();
  return { ...actual, apiFetch: vi.fn() };
});

import { apiFetch } from "../../../../../data/apiFetch";
import { I18nProvider } from "../../../../../i18n/I18nProvider";
import {
  answerApiFetch,
  makeAnyGroup,
  stubQueryClient,
  UnmetFixtures,
} from "../../../test-utils";
import { HeldCard, type HeldCardProps } from ".";

const apiFetchMock = vi.mocked(apiFetch);
const GENERATE = /^generate now$/i;
const META_KEY = ["pr-meta", "424242", 7];

const BASE_PROPS: HeldCardProps = {
  repoId: "424242",
  prNumber: 7,
  unmetConditions: [
    UnmetFixtures.READY_FOR_REVIEW,
    UnmetFixtures.CI_RUNNING,
    makeAnyGroup(UnmetFixtures.BOT_NOT_APPROVED, UnmetFixtures.SIZE_OVER),
  ],
  unmetConditionsPartial: false,
  viewerCanPush: true,
  appInstalled: true,
  prState: "open",
};

function makeCard(overrides: Partial<HeldCardProps>, client: QueryClient) {
  return (
    <QueryClientProvider client={client}>
      <I18nProvider>
        <HeldCard {...BASE_PROPS} {...overrides} />
      </I18nProvider>
    </QueryClientProvider>
  );
}

function renderCard(
  overrides: Partial<HeldCardProps> = {},
  client: QueryClient = stubQueryClient(),
) {
  return render(makeCard(overrides, client));
}

function readGroup(title: string): HTMLElement {
  return screen.getByRole("list", { name: title });
}

afterEach(() => {
  cleanup();
  apiFetchMock.mockReset();
});

describe("HeldCard", () => {
  it("says this push has no brief yet in the page heading", () => {
    renderCard();

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "No brief for this push yet",
    );
  });

  it("splits the reasons into waits and changes under h2 titles", () => {
    renderCard();

    const titles = screen.getAllByRole("heading", { level: 2 });
    expect(titles.map((title) => title.textContent)).toEqual([
      "Waiting on",
      "Needs a change first",
    ]);
    expect(
      within(readGroup("Waiting on")).getByText(
        "Waiting for CI: build, e2e still running",
      ),
    ).toBeTruthy();
    expect(
      within(readGroup("Needs a change first")).getByText(
        "Needs this pull request marked ready for review",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "It won't generate by itself until the changes below are made.",
      ),
    ).toBeTruthy();
  });

  it("nests an any group's members under one line", () => {
    renderCard();

    const group = screen.getByTestId("held-any-group");
    expect(within(group).getByText("Needs one of these:")).toBeTruthy();
    expect(
      within(group).getByText("CodeRabbit finished without approving"),
    ).toBeTruthy();
    expect(
      within(group).getByText("1284 changed lines, over the 800 maximum"),
    ).toBeTruthy();
  });

  it("marks each line with its owner in words, seen and spoken", () => {
    renderCard({ unmetConditions: [UnmetFixtures.READY_FOR_REVIEW] });

    const line = screen.getByTestId("held-condition");
    expect(within(line).getByTestId("held-condition-owner").textContent).toBe(
      "Instance",
    );
    expect(
      within(line).getByText("this MergeBrief instance's setting"),
    ).toBeTruthy();
  });

  it("ends the list with a line for conditions the server could not read", () => {
    renderCard({ unmetConditionsPartial: true });

    const unreadable = screen.getByTestId("held-unreadable");
    expect(unreadable.textContent).toBe(
      "Conditions this server could not read",
    );
    const rows = screen.getByTestId("held-conditions").children;
    expect(rows[rows.length - 1]).toBe(unreadable);
  });

  it("says why it waits when no condition was readable", () => {
    renderCard({ unmetConditions: [], unmetConditionsPartial: true });

    expect(screen.getByTestId("held-unreadable").textContent).toBe(
      "Conditions this server could not read",
    );
  });

  it("shows no unreadable line for a whole list", () => {
    renderCard();

    expect(screen.queryByTestId("held-unreadable")).toBeNull();
  });

  it("says the head generates by itself when everything waits", () => {
    renderCard({ unmetConditions: [UnmetFixtures.CI_RUNNING] });

    expect(
      screen.getByText("It generates by itself once these finish."),
    ).toBeTruthy();
    expect(screen.queryByText("Needs a change first")).toBeNull();
  });

  it("promises nothing when the list was read in part", () => {
    renderCard({
      unmetConditions: [UnmetFixtures.CI_RUNNING],
      unmetConditionsPartial: true,
    });

    expect(
      screen.getByText("Its trigger conditions are not met yet."),
    ).toBeTruthy();
    expect(
      screen.queryByText("It generates by itself once these finish."),
    ).toBeNull();
  });

  it("offers Generate now to a pusher", () => {
    renderCard();

    expect(screen.getByRole("button", { name: GENERATE })).toBeTruthy();
  });

  it.each([
    ["a viewer without push access", { viewerCanPush: false }],
    ["a PR outside an installation", { appInstalled: false }],
  ] as const)("offers no Generate now to %s", (_who, overrides) => {
    renderCard(overrides);

    expect(screen.queryByRole("button", { name: GENERATE })).toBeNull();
    expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(2);
  });

  it.each(["closed", "merged"] as const)(
    "on a %s PR offers no Generate now and lists no reasons",
    (prState) => {
      renderCard({ prState });

      expect(screen.queryByRole("button", { name: GENERATE })).toBeNull();
      expect(screen.queryByTestId("held-conditions")).toBeNull();
      expect(
        screen.getByText(
          "This pull request is no longer open, so its brief will not be generated.",
        ),
      ).toBeTruthy();
    },
  );

  it("releases the held head and refreshes the meta read", async () => {
    answerApiFetch(apiFetchMock, 202);
    const client = stubQueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    renderCard({}, client);

    fireEvent.click(screen.getByRole("button", { name: GENERATE }));

    expect(apiFetchMock).toHaveBeenCalledWith(
      "/api/repos/424242/pulls/7/regenerate",
      { method: "POST" },
    );
    await waitFor(() => {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: META_KEY });
    });
  });

  it("says so when the head stopped being held before the click", async () => {
    answerApiFetch(apiFetchMock, 409, "generation-not-regenerable");
    renderCard();

    fireEvent.click(screen.getByRole("button", { name: GENERATE }));

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toBe(
        "This push is no longer held.",
      );
    });
  });

  it("holds the button busy and sends one request while pending", async () => {
    let settle: (response: Response) => void = () => undefined;
    apiFetchMock.mockReturnValue(
      new Promise<Response>((resolve) => {
        settle = resolve;
      }),
    );
    renderCard();
    const button = screen.getByRole("button", { name: GENERATE });

    fireEvent.click(button);
    fireEvent.click(button);

    const busy = screen.getByRole("button", { name: /generating/i });
    expect(busy.getAttribute("aria-busy")).toBe("true");
    expect(apiFetchMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      settle(new Response(null, { status: 202 }));
    });
  });
});
