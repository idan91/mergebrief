// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
import type { GenerationFailureCode } from "types";

import type * as ApiFetchModule from "../../../../../data/apiFetch";

vi.mock("../../../../../data/apiFetch", async (importOriginal) => {
  const actual = await importOriginal<typeof ApiFetchModule>();
  return { ...actual, apiFetch: vi.fn() };
});

import { apiFetch } from "../../../../../data/apiFetch";
import { I18nProvider } from "../../../../../i18n/I18nProvider";
import { FailedCard, type FailedCardProps } from ".";
import { answerApiFetch } from "../../../test-utils";

const apiFetchMock = vi.mocked(apiFetch);
const REGENERATE = /regenerate brief/i;

const BASE_PROPS: FailedCardProps = {
  attempts: 0,
  errorCode: "provider-timeout",
  errorDetail: undefined,
  repoId: "424242",
  prNumber: 7,
  viewerCanPush: true,
  appInstalled: true,
  prState: "open",
  awaitsReadyForReview: false,
};

function stubQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

function makeCard(overrides: Partial<FailedCardProps>, client: QueryClient) {
  return (
    <QueryClientProvider client={client}>
      <I18nProvider>
        <FailedCard {...BASE_PROPS} {...overrides} />
      </I18nProvider>
    </QueryClientProvider>
  );
}

function renderCard(
  overrides: Partial<FailedCardProps> = {},
  client: QueryClient = stubQueryClient(),
) {
  return render(makeCard(overrides, client));
}

afterEach(() => {
  cleanup();
  apiFetchMock.mockReset();
});

describe("FailedCard", () => {
  it("counts the attempt in singular on a first failure", () => {
    renderCard({ errorCode: "unknown", errorDetail: "boom" });
    expect(screen.getByText(/1 attempt so far\./)).toBeTruthy();
  });

  it("pluralizes past the first attempt", () => {
    renderCard({ attempts: 2, errorCode: "unknown", errorDetail: "boom" });
    expect(screen.getByText(/3 attempts so far\./)).toBeTruthy();
  });

  it("renders a known code's catalog copy", () => {
    renderCard({ errorCode: "provider-rate-limit" });
    expect(screen.getByText(/rate limit was hit/)).toBeTruthy();
  });

  it("says a head that spent its attempts will not retry on its own", () => {
    renderCard({ errorCode: "attempts-exhausted", viewerCanPush: false });
    expect(
      screen.getByText(/using all its attempts for this push/),
    ).toBeTruthy();
    expect(screen.getByText(/will not try again on its own/)).toBeTruthy();
  });

  it("hides the attempt count for a head that spent its attempts", () => {
    renderCard({
      attempts: 2,
      errorCode: "attempts-exhausted",
      viewerCanPush: false,
    });
    expect(screen.queryByText(/attempts? so far/)).toBeNull();
    expect(
      screen.getByText(
        "A new push, a submitted review or a review request queues a new run.",
      ),
    ).toBeTruthy();
  });

  it("interpolates the sanitized detail for the codes that carry one", () => {
    renderCard({
      errorCode: "generation-config",
      errorDetail: "missing ANTHROPIC_API_KEY",
    });
    expect(screen.getByText(/missing ANTHROPIC_API_KEY/)).toBeTruthy();
  });

  it("offers Regenerate to a pusher on a transient failure", () => {
    renderCard();
    expect(screen.getByRole("button", { name: REGENERATE })).toBeTruthy();
    expect(screen.queryByText(/A new push re-queues generation/)).toBeNull();
  });

  it("tells a pusher what to fix first on a fix-first failure", () => {
    renderCard({ errorCode: "provider-auth" });
    expect(screen.getByText(/model provider credentials/)).toBeTruthy();
    expect(screen.getByRole("button", { name: REGENERATE })).toBeTruthy();
  });

  it.each<GenerationFailureCode>([
    "diff-too-large",
    "output-secret",
    "provider-refusal",
  ])("offers no Regenerate on the cannot-help %s", (errorCode) => {
    renderCard({ errorCode });
    expect(screen.queryByRole("button", { name: REGENERATE })).toBeNull();
    expect(screen.getByText(/A new push re-queues generation/)).toBeTruthy();
  });

  it("offers no Regenerate to a viewer without push access", () => {
    renderCard({ viewerCanPush: false });
    expect(screen.queryByRole("button", { name: REGENERATE })).toBeNull();
    expect(screen.getByText(/A new push re-queues generation/)).toBeTruthy();
  });

  it.each(["merged", "closed"] as const)(
    "on a %s PR offers no Regenerate and says none will generate",
    (prState) => {
      renderCard({ prState });
      expect(screen.queryByRole("button", { name: REGENERATE })).toBeNull();
      expect(
        screen.getByText(
          "1 attempt so far. This pull request is no longer open, so no brief will generate.",
        ),
      ).toBeTruthy();
    },
  );

  it.each(["open", "closed", "merged"] as const)(
    "tells a url row on a %s PR that a paste retries it",
    (prState) => {
      renderCard({ appInstalled: false, prState });
      expect(screen.queryByRole("button", { name: REGENERATE })).toBeNull();
      expect(
        screen.getByText(
          "1 attempt so far. Paste this pull request's URL on the home page to retry it.",
        ),
      ).toBeTruthy();
      expect(screen.queryByText(/A new push re-queues generation/)).toBeNull();
    },
  );

  it("names no App on a url row whose GitHub read was denied", () => {
    renderCard({ appInstalled: false, errorCode: "github-access" });
    expect(screen.queryByText(/MergeBrief App/)).toBeNull();
    expect(
      screen.getByText(/MergeBrief needs read access to this repository/),
    ).toBeTruthy();
  });

  it("holds the button busy and sends one request while pending", async () => {
    let settle: (response: Response) => void = () => undefined;
    apiFetchMock.mockReturnValue(
      new Promise<Response>((resolve) => {
        settle = resolve;
      }),
    );
    renderCard();
    const button = screen.getByRole("button", { name: REGENERATE });

    fireEvent.click(button);
    fireEvent.click(button);

    const busy = screen.getByRole("button", { name: /regenerating/i });
    expect(busy.getAttribute("aria-busy")).toBe("true");
    expect(busy.hasAttribute("disabled")).toBe(false);
    expect(apiFetchMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      settle(new Response(null, { status: 202 }));
    });
  });

  it("announces a failure and keeps the button for another try", async () => {
    answerApiFetch(apiFetchMock, 502, "github-unavailable");
    renderCard();

    fireEvent.click(screen.getByRole("button", { name: REGENERATE }));

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toMatch(
        /could not queue the rerun/,
      );
    });
    expect(screen.getByRole("button", { name: REGENERATE })).toBeTruthy();
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

    fireEvent.click(screen.getByRole("button", { name: REGENERATE }));

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toMatch(
        /can't be regenerated/,
      );
    });
    expect(screen.queryByRole("button", { name: REGENERATE })).toBeNull();
  });

  it("hands focus to the main landmark when a poll withdraws the button", () => {
    render(<main id="main-content" tabIndex={-1} />);
    const client = stubQueryClient();
    const view = renderCard({}, client);
    screen.getByRole("button", { name: REGENERATE }).focus();

    view.rerender(makeCard({ viewerCanPush: false }, client));

    expect(screen.queryByRole("button", { name: REGENERATE })).toBeNull();
    expect(document.activeElement?.id).toBe("main-content");
  });

  it("refreshes the meta read once the rerun is queued", async () => {
    answerApiFetch(apiFetchMock, 202);
    const client = stubQueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    renderCard({}, client);

    fireEvent.click(screen.getByRole("button", { name: REGENERATE }));

    await waitFor(() => {
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: ["pr-meta", "424242", 7],
      });
    });
    expect(screen.getByRole("status").textContent).toBe("");
  });
});
