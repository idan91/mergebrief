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
    viewerCanDelete: false,
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

const URL_ROW = makeItem({
  source: "url",
  installationId: null,
  viewerCanDelete: true,
});
const ADMIN_ROW = makeItem({ viewerCanDelete: true });

function readRequestBody(init: RequestInit | undefined): unknown {
  const body = init?.body;
  return typeof body === "string" ? JSON.parse(body) : undefined;
}

function readRequestUrl(input: string | URL | Request | undefined): string {
  if (input === undefined) return "";
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

async function renderActions(item: InboxItem) {
  const onAnnounce = vi.fn();
  const onDelete = vi.fn();
  const { queryClient } = await renderInRouter(
    <RowActions item={item} onAnnounce={onAnnounce} onDelete={onDelete} />,
  );
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  return { onAnnounce, onDelete, invalidate };
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

  it("Delete hands the row to the list and makes no request itself", async () => {
    const { onDelete } = await renderActions(URL_ROW);

    await chooseDelete();

    expect(onDelete).toHaveBeenCalledWith(URL_ROW);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a row behind GitHub regenerates through the paste path", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ repoId: "424242", prNumber: 7 }), {
        status: 202,
        headers: { "content-type": "application/json" },
      }),
    );
    const { onAnnounce, invalidate } = await renderActions(
      makeItem({ behind: true }),
    );

    await openMenu();
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: "Regenerate" }));
    });

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(readRequestUrl(url)).toMatch(/\/api\/generate$/);
    expect(init?.method).toBe("POST");
    expect(readRequestBody(init)).toEqual({
      url: "https://github.com/acme/payments/pull/7",
    });
    expect(onAnnounce).toHaveBeenCalledWith("Regenerate queued");
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["inbox"] });
  });

  it("a refused regenerate announces and keeps the row", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ code: "unauthorized" }), { status: 401 }),
    );
    const { onAnnounce } = await renderActions(makeItem({ behind: true }));

    await openMenu();
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: "Regenerate" }));
    });

    expect(onAnnounce).toHaveBeenCalledWith(
      expect.stringContaining("sign in again"),
    );
  });

  it("a current row, or one with no repository name, has no Regenerate", async () => {
    await renderActions(makeItem());
    await openMenu();
    expect(screen.queryByRole("menuitem", { name: "Regenerate" })).toBeNull();
    cleanup();

    await renderActions(makeItem({ behind: true, repoSlug: null }));
    await openMenu();
    expect(screen.queryByRole("menuitem", { name: "Regenerate" })).toBeNull();
  });

  it("a row the viewer may not delete has no Delete, whatever its source", async () => {
    await renderActions(makeItem({ source: "url", installationId: null }));

    await openMenu();

    expect(screen.queryByRole("menuitem", { name: "Delete" })).toBeNull();
  });

  it("an installation row the viewer administers offers Delete", async () => {
    await renderActions(ADMIN_ROW);

    await openMenu();

    expect(screen.getByRole("menuitem", { name: "Delete" })).toBeDefined();
  });
});
