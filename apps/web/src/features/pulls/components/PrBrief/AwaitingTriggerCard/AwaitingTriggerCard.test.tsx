// @vitest-environment jsdom
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  type RenderResult,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type * as ApiFetchModule from "../../../../../data/apiFetch";

vi.mock("../../../../../data/apiFetch", async (importOriginal) => {
  const actual = await importOriginal<typeof ApiFetchModule>();
  return { ...actual, apiFetch: vi.fn() };
});

import { apiFetch } from "../../../../../data/apiFetch";
import { I18nProvider } from "../../../../../i18n/I18nProvider";
import { AwaitingTriggerCard, type AwaitingTriggerCardProps } from ".";
import { answerApiFetch, stubQueryClient } from "../../../test-utils";

const apiFetchMock = vi.mocked(apiFetch);
const GENERATE = /^generate brief$/i;
const META_KEY = ["pr-meta", "424242", 7];

const BASE_PROPS: AwaitingTriggerCardProps = {
  repoId: "424242",
  prNumber: 7,
  viewerCanPush: true,
  appInstalled: true,
  prState: "open",
  awaitsReadyForReview: false,
};

function makeCard(
  overrides: Partial<AwaitingTriggerCardProps>,
  client: QueryClient,
) {
  return (
    <QueryClientProvider client={client}>
      <I18nProvider>
        <AwaitingTriggerCard {...BASE_PROPS} {...overrides} />
      </I18nProvider>
    </QueryClientProvider>
  );
}

function renderCard(
  overrides: Partial<AwaitingTriggerCardProps> = {},
  client: QueryClient = stubQueryClient(),
) {
  return render(makeCard(overrides, client));
}

afterEach(() => {
  cleanup();
  apiFetchMock.mockReset();
});

describe("AwaitingTriggerCard", () => {
  it("says the brief is on demand and who can generate it", () => {
    renderCard();

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Brief available on demand",
      }),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "A collaborator with push access can generate this pull request's brief. After that, its pushes are briefed as usual.",
      ),
    ).toBeTruthy();
  });

  it("promises a skipped draft's pushes only once it is ready for review", () => {
    renderCard({ awaitsReadyForReview: true });

    expect(screen.getByRole("button", { name: GENERATE })).toBeTruthy();
    expect(
      screen.getByText(
        /after that, pushes are briefed once it is marked ready/,
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/its pushes are briefed as usual/)).toBeNull();
  });

  it("leads the card with the ghost mark", () => {
    renderCard();

    expect(screen.getByTestId("ghost-mark")).toBeTruthy();
  });

  it("offers Generate to a pusher", () => {
    renderCard();

    expect(screen.getByRole("button", { name: GENERATE })).toBeTruthy();
  });

  it("offers no Generate to a viewer without push access", () => {
    renderCard({ viewerCanPush: false });

    expect(screen.queryByRole("button", { name: GENERATE })).toBeNull();
    expect(
      screen.getByText(/A collaborator with push access can generate/),
    ).toBeTruthy();
  });

  it.each(["closed", "merged"] as const)(
    "on a %s PR offers no Generate and promises none",
    (prState) => {
      renderCard({ prState });

      expect(screen.queryByRole("button", { name: GENERATE })).toBeNull();
      expect(
        screen.getByText(
          "This pull request is no longer open, so its brief will not be generated.",
        ),
      ).toBeTruthy();
      expect(screen.queryByText(/A collaborator with push access/)).toBeNull();
      const heading = screen.getByRole("heading", { level: 1 });
      expect(heading.textContent).toBe("No brief generated");
    },
  );

  it("offers no Generate where the App is not installed", () => {
    renderCard({ appInstalled: false });

    expect(screen.queryByRole("button", { name: GENERATE })).toBeNull();
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
    button.focus();

    fireEvent.click(button);
    fireEvent.click(button);

    const busy = screen.getByRole("button", { name: /generating/i });
    expect(busy.getAttribute("aria-busy")).toBe("true");
    expect(busy.hasAttribute("disabled")).toBe(false);
    expect(document.activeElement).toBe(busy);
    expect(apiFetchMock).toHaveBeenCalledTimes(1);
    expect(apiFetchMock).toHaveBeenCalledWith(
      "/api/repos/424242/pulls/7/regenerate",
      { method: "POST" },
    );
    await act(async () => {
      settle(new Response(null, { status: 202 }));
    });
  });

  it("refreshes the meta read once the brief is queued", async () => {
    answerApiFetch(apiFetchMock, 202);
    const client = stubQueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    renderCard({}, client);

    fireEvent.click(screen.getByRole("button", { name: GENERATE }));

    await waitFor(() => {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: META_KEY });
    });
    expect(screen.getByRole("status").textContent).toBe("");
  });

  it("refreshes and says so when a run already holds the head", async () => {
    answerApiFetch(apiFetchMock, 409, "generation-running");
    const client = stubQueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    renderCard({}, client);

    fireEvent.click(screen.getByRole("button", { name: GENERATE }));

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toMatch(
        /already generating/,
      );
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: META_KEY });
  });

  it("keeps the outcome line when the refreshed meta withdraws the offer", async () => {
    answerApiFetch(apiFetchMock, 409, "generation-not-regenerable");
    const client = stubQueryClient();
    let view: RenderResult | undefined;
    const closedCard = makeCard({ prState: "closed" }, client);
    vi.spyOn(client, "invalidateQueries").mockImplementation(async () => {
      act(() => view?.rerender(closedCard));
    });
    view = renderCard({}, client);

    fireEvent.click(screen.getByRole("button", { name: GENERATE }));

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toBe(
        "This brief no longer waits for a click.",
      );
    });
    expect(screen.queryByRole("button", { name: GENERATE })).toBeNull();
  });

  it("hands focus to the main landmark when a poll withdraws the button", () => {
    render(<main id="main-content" tabIndex={-1} />);
    const client = stubQueryClient();
    const view = renderCard({}, client);
    screen.getByRole("button", { name: GENERATE }).focus();

    view.rerender(makeCard({ prState: "closed" }, client));

    expect(screen.queryByRole("button", { name: GENERATE })).toBeNull();
    expect(document.activeElement?.id).toBe("main-content");
  });

  it("announces a failure in its own words and keeps the button", async () => {
    answerApiFetch(apiFetchMock, 502, "github-unavailable");
    renderCard();

    fireEvent.click(screen.getByRole("button", { name: GENERATE }));

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toBe(
        "MergeBrief could not start the brief. Try again in a moment.",
      );
    });
    expect(screen.getByRole("button", { name: GENERATE })).toBeTruthy();
  });
});
