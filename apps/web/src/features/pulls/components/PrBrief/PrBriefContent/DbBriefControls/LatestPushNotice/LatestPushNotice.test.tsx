// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../../../../../../i18n/I18nProvider";
import type { PrSummary } from "../../../../../types";
import { makeGeneration, makeMeta } from "./test-utils";
import { LatestPushNotice } from ".";
import type { LatestPushAction } from "./types";
import { useLatestPushNotice } from "./useLatestPushNotice";

const fetchMock = vi.fn<typeof fetch>();
const REGENERATE = /regenerate brief/i;
const TIMEOUT_REASON = "The model provider timed out before finishing.";

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  fetchMock.mockReset();
});

function makeWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <I18nProvider>
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      </I18nProvider>
    );
  };
}

function renderNoticeHook(meta: PrSummary) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const rendered = renderHook(() => useLatestPushNotice(meta, "424242", 7), {
    wrapper: makeWrapper(client),
  });
  return { ...rendered, invalidate };
}

const FAILED_ACTION: LatestPushAction = {
  pending: false,
  label: "Regenerate brief",
  onTrigger: () => undefined,
};

function makeNotice(action: LatestPushAction | undefined) {
  return (
    <I18nProvider>
      <LatestPushNotice
        action={action}
        label="Latest push failed"
        title="The latest push got no brief."
      />
    </I18nProvider>
  );
}

describe("LatestPushNotice", () => {
  it("shows the chip, the reason and the action beside it", () => {
    render(
      <I18nProvider>
        <LatestPushNotice
          action={FAILED_ACTION}
          detail={TIMEOUT_REASON}
          label="Latest push failed"
          title="The latest push got no brief."
        />
      </I18nProvider>,
    );

    expect(screen.getByText("Latest push failed")).toBeTruthy();
    expect(screen.getByText(TIMEOUT_REASON)).toBeTruthy();
    expect(screen.getByRole("button", { name: REGENERATE })).toBeTruthy();
  });

  it("hands focus to the main landmark when a poll drops its action", () => {
    render(<main id="main-content" tabIndex={-1} />);
    const view = render(makeNotice(FAILED_ACTION));
    screen.getByRole("button", { name: REGENERATE }).focus();

    view.rerender(makeNotice(undefined));

    expect(screen.queryByRole("button", { name: REGENERATE })).toBeNull();
    expect(document.activeElement?.id).toBe("main-content");
  });

  it("hands focus to the main landmark when the notice leaves", () => {
    render(<main id="main-content" tabIndex={-1} />);
    const view = render(makeNotice(FAILED_ACTION));
    screen.getByRole("button", { name: REGENERATE }).focus();

    view.unmount();

    expect(document.activeElement?.id).toBe("main-content");
  });

  it("leaves focus alone when its button never held it", () => {
    render(<main id="main-content" tabIndex={-1} />);
    const view = render(makeNotice(FAILED_ACTION));

    view.rerender(makeNotice(undefined));

    expect(document.activeElement).toBe(document.body);
  });

  it("shows the chip alone when there is nothing to say or do", () => {
    render(
      <I18nProvider>
        <LatestPushNotice
          label="Latest push generating"
          title="The latest push's brief is generating."
        />
      </I18nProvider>,
    );

    expect(screen.getByText("Latest push generating")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("useLatestPushNotice", () => {
  it("offers a pusher Regenerate on a transient failure over a stored brief", () => {
    const { result } = renderNoticeHook(makeMeta());

    expect(result.current.notice?.label).toBe("Latest push failed");
    expect(result.current.notice?.detail).toBe(
      `${TIMEOUT_REASON} 1 attempt so far.`,
    );
    expect(result.current.notice?.action?.label).toBe("Regenerate brief");
  });

  it("names an earlier base in a retargeted head's failed notice", () => {
    const oldBaseBrief = {
      headSha: "head-2",
      baseSha: "base-old",
      headIndex: 1,
      createdAt: "2026-10-24T09:00:00.000Z",
      comparisons: {},
    };
    const meta = makeMeta({
      baseSha: "base-old",
      behind: false,
      revisions: [oldBaseBrief],
    });

    const { result } = renderNoticeHook(meta);

    expect(result.current.notice?.action?.label).toBe("Regenerate brief");
    expect(result.current.notice?.title).toContain(
      "or this push on an earlier base",
    );
  });

  it("gives a cannot-help failure its reason and the requeue line", () => {
    const generation = makeGeneration({ errorCode: "diff-too-large" });
    const { result } = renderNoticeHook(makeMeta({ generation }));

    expect(result.current.notice?.action).toBeUndefined();
    expect(result.current.notice?.detail).toBe(
      "The diff is too large to summarize. 1 attempt so far. A new push re-queues generation automatically.",
    );
  });

  it("offers no Regenerate on a closed PR and says none will generate", () => {
    const { result } = renderNoticeHook(makeMeta({ state: "closed" }));

    expect(result.current.notice?.action).toBeUndefined();
    expect(result.current.notice?.detail).toBe(
      `${TIMEOUT_REASON} 1 attempt so far. This pull request is no longer open, so no brief will generate.`,
    );
  });

  it("offers no Regenerate to a viewer without push access", () => {
    const { result } = renderNoticeHook(makeMeta({ viewerCanPush: false }));

    expect(result.current.notice).toBeDefined();
    expect(result.current.notice?.action).toBeUndefined();
  });

  it("names a generating latest push and offers nothing to do", () => {
    const generation = makeGeneration({ status: "running" });
    const { result } = renderNoticeHook(makeMeta({ generation }));

    expect(result.current.notice?.label).toBe("Latest push generating");
    expect(result.current.notice?.title).toBe(
      "The latest push's brief is generating. The brief on screen covers an earlier push.",
    );
    expect(result.current.notice?.detail).toBeUndefined();
    expect(result.current.notice?.action).toBeUndefined();
  });

  it("names a capped latest push and offers a pusher no rerun", () => {
    const generation = makeGeneration({ status: "capped" });
    const { result } = renderNoticeHook(makeMeta({ generation }));

    expect(result.current.notice?.label).toBe("Latest push skipped");
    expect(result.current.notice?.title).toBe(
      "The latest push was skipped because this instance reached its daily generation cap. The brief on screen covers an earlier push.",
    );
    expect(result.current.notice?.detail).toMatch(/next push/);
    expect(result.current.notice?.action).toBeUndefined();
  });

  it("offers no notice for a superseded latest push", () => {
    const generation = makeGeneration({ status: "superseded" });
    const { result } = renderNoticeHook(makeMeta({ generation }));

    expect(result.current.notice).toBeUndefined();
  });

  it("offers no notice once the latest push has its brief", () => {
    const { result } = renderNoticeHook(makeMeta({ briefAvailable: true }));

    expect(result.current.notice).toBeUndefined();
  });

  it("queues the rerun, re-reads the meta and says so", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 202 }));
    const { result, invalidate } = renderNoticeHook(makeMeta());

    act(() => result.current.notice?.action?.onTrigger());

    await waitFor(() =>
      expect(result.current.announcement).toBe(
        "Rerun queued for the latest push.",
      ),
    );
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(typeof url === "string" ? url : "").toContain(
      "/api/repos/424242/pulls/7/regenerate",
    );
    expect(init?.method).toBe("POST");
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["pr-meta", "424242", 7],
    });
  });
});
