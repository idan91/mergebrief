// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { InboxReviewStates } from "types/inbox";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderInRouter } from "../../../../../../test/router";
import type { InboxItem } from "../../../../types";
import { RowActions } from "./RowActions";

const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", fetchMock);
const writeText = vi.fn<(text: string) => Promise<void>>();

afterEach(() => {
  cleanup();
  fetchMock.mockReset();
  writeText.mockReset();
});

beforeEach(() => {
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: true, addEventListener: vi.fn() })),
  );
});

function makeItem(overrides: Partial<InboxItem> = {}): InboxItem {
  return {
    repoId: "424242",
    repoSlug: "acme/payments",
    prNumber: 7,
    title: "t",
    state: "open",
    draft: false,
    source: "installation",
    installationId: "10",
    viewerIsAuthor: false,
    reviewState: InboxReviewStates.NEW,
    behind: false,
    unreachable: false,
    generation: null,
    latestBriefAt: null,
    githubUpdatedAt: null,
    stack: null,
    ...overrides,
  };
}

const URL_ROW = makeItem({ source: "url", installationId: null });

function readRequestUrl(input: string | URL | Request | undefined): string {
  if (input === undefined) return "";
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

async function renderActions(item: InboxItem) {
  const onAnnounce = vi.fn();
  const onDeleted = vi.fn();
  await renderInRouter(
    <RowActions item={item} onAnnounce={onAnnounce} onDeleted={onDeleted} />,
  );
  return { onAnnounce, onDeleted };
}

async function openMenu() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
  });
}

async function chooseDelete() {
  await openMenu();
  await act(async () => {
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
  });
}

describe("RowActions", () => {
  it("opens the pull request on GitHub in a new tab", async () => {
    await renderActions(makeItem());

    const link = screen.getByRole("link", { name: /^Open on GitHub/ });
    expect(link.getAttribute("href")).toBe(
      "https://github.com/acme/payments/pull/7",
    );
    expect(link.getAttribute("target")).toBe("_blank");
  });

  it("offers no GitHub link while the repository name is unknown", async () => {
    await renderActions(makeItem({ repoSlug: null }));

    expect(screen.queryByRole("link", { name: /^Open on GitHub/ })).toBeNull();
  });

  it("Copy link writes the row's own address and announces it", async () => {
    writeText.mockResolvedValue(undefined);
    const { onAnnounce } = await renderActions(makeItem());

    await openMenu();
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: "Copy link" }));
    });

    expect(writeText).toHaveBeenCalledWith(
      `${window.location.origin}/repos/424242/pulls/7`,
    );
    expect(onAnnounce).toHaveBeenCalledWith("Link copied");
  });

  it("a refused clipboard write announces the failure", async () => {
    writeText.mockRejectedValue(new Error("denied"));
    const { onAnnounce } = await renderActions(makeItem());

    await openMenu();
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: "Copy link" }));
    });

    expect(onAnnounce).toHaveBeenCalledWith("Copy failed");
  });

  it("Delete exists only on url rows, calls the Inbox delete and announces", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    const { onAnnounce, onDeleted } = await renderActions(URL_ROW);

    await chooseDelete();

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(readRequestUrl(url)).toMatch(/\/api\/inbox\/424242\/7$/);
    expect(init?.method).toBe("DELETE");
    expect(onAnnounce).toHaveBeenCalledWith("Deleted");
    expect(onDeleted).toHaveBeenCalledTimes(1);
  });

  it("an installation row has no Delete", async () => {
    await renderActions(makeItem());

    await openMenu();

    expect(screen.queryByRole("menuitem", { name: "Delete" })).toBeNull();
  });

  it("a refused delete announces and keeps the row", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ code: "not-found" }), { status: 404 }),
    );
    const { onAnnounce, onDeleted } = await renderActions(URL_ROW);

    await chooseDelete();

    expect(onAnnounce).toHaveBeenCalledWith(
      "Delete failed; the row is still here",
    );
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it("a dropped connection announces the failure and frees the row", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    const { onAnnounce } = await renderActions(URL_ROW);

    await chooseDelete();

    expect(onAnnounce).toHaveBeenCalledWith(
      "Delete failed; the row is still here",
    );
    await openMenu();
    expect(
      screen
        .getByRole("menuitem", { name: "Delete" })
        .getAttribute("aria-disabled"),
    ).toBeNull();
  });
});
