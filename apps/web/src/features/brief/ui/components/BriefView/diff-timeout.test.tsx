// @vitest-environment jsdom
import { act, fireEvent, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, ApiErrorCodes } from "@web/data/apiFetch";
import {
  FixtureBriefView,
  mountBriefHost,
  mountBriefView,
} from "@web/features/brief/test-utils";
import type { DiffQueryState } from "../DiffTimeoutNotice/types";
import { useDiffRetryLanding } from "../DiffTimeoutNotice/useDiffRetryLanding";

const TIMEOUT = new ApiError(ApiErrorCodes.DIFF_FETCH_TIMEOUT, 504, "/diff");
const UNAVAILABLE = new ApiError(
  ApiErrorCodes.GITHUB_UNAVAILABLE,
  502,
  "/diff",
);

function findMainContent(): HTMLElement | null {
  return document.getElementById("main-content");
}

let settleRead: ((next: Partial<DiffQueryState>) => void) | undefined;

/** The brief page's diff read, driven by hand into the real landing hook. */
function LandingStage() {
  const [query, setQuery] = useState<DiffQueryState>({
    data: undefined,
    error: TIMEOUT,
    isFetching: false,
    errorUpdateCount: 1,
    refetch: () => Promise.resolve(undefined),
  });
  settleRead = (next) => {
    setQuery((current) => ({ ...current, ...next }));
  };
  const landing = useDiffRetryLanding(query, findMainContent);

  return (
    <>
      <FixtureBriefView diffTimeout={landing.retry} />
      <p data-testid="landing-status" role="status">
        {landing.announcement}
      </p>
    </>
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

function stubFrames(): void {
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    callback(0);
    return 0;
  });
}

describe("BriefView on a brief diff GitHub did not render in time", () => {
  it("bands the timeout under the header and retries the read", async () => {
    const retry = vi.fn();
    await mountBriefView({
      diffTimeout: {
        pending: false,
        failureCount: 1,
        retry,
        releaseFocus: vi.fn(),
      },
    });

    const notice = await screen.findByTestId("diff-timeout-notice");
    expect(notice.textContent).toContain("GitHub took too long");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("shows no band while the diff read has not timed out", async () => {
    await mountBriefView({ repoId: "repo-1" });

    expect(screen.queryByTestId("diff-timeout-notice")).toBeNull();
  });

  it("lands focus on the reading column and says the diff loaded", async () => {
    stubFrames();
    await mountBriefHost(<LandingStage />);
    screen.getByRole("button", { name: "Try again" }).focus();

    act(() => {
      settleRead?.({ data: "diff --git a/x b/x", error: null });
    });

    expect(screen.queryByTestId("diff-timeout-notice")).toBeNull();
    expect(document.activeElement?.id).toBe("main-content");
    expect(screen.getByTestId("landing-status").textContent).toBe(
      "Diff loaded.",
    );
  });

  it("keeps focus on the button through a failed retry", async () => {
    stubFrames();
    await mountBriefHost(<LandingStage />);
    const button = screen.getByRole("button", { name: "Try again" });
    button.focus();

    act(() => {
      settleRead?.({ errorUpdateCount: 2 });
    });

    expect(document.activeElement).toBe(button);
    expect(screen.getByTestId("landing-status").textContent).toBe("");
  });

  it("lands focus on the reading column when the retry fails otherwise", async () => {
    stubFrames();
    await mountBriefHost(<LandingStage />);
    screen.getByRole("button", { name: "Try again" }).focus();

    act(() => {
      settleRead?.({ error: UNAVAILABLE, errorUpdateCount: 2 });
    });

    expect(screen.queryByTestId("diff-timeout-notice")).toBeNull();
    expect(document.activeElement?.id).toBe("main-content");
    expect(screen.getByTestId("landing-status").textContent).toBe(
      "The diff did not load.",
    );
  });
});
