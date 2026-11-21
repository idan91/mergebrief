// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import {
  InboxArchivedFilters,
  InboxReviewStates,
  type InboxArchivedFilter,
} from "types/inbox";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { omitFields } from "@web/test/fields";
import { renderInRouter } from "../../../../../../test/router";
import { INBOX_QUERY_ROOT } from "../../../../consts";
import type { InboxItem } from "../../../../types";
import { RowActions } from ".";

const fetchMock = vi.fn<typeof fetch>();
const writeText = vi.fn<(text: string) => Promise<void>>();
const realLocation = window.location;

afterEach(() => {
  cleanup();
  fetchMock.mockReset();
  writeText.mockReset();
  vi.stubGlobal("location", realLocation);
  window.localStorage.clear();
});

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
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
    viewerCanPush: false,
    generateEveryPush: false,
    reviewState: InboxReviewStates.NEW,
    behind: false,
    unreachable: false,
    ...overrides,
  };
}

const URL_ROW = omitFields(
  makeItem({ source: "url", viewerCanDelete: true }),
  "installationId",
);

const HELD_ROW = makeItem({
  viewerCanPush: true,
  generateEveryPush: false,
  generation: {
    status: "held",
    updatedAt: "2026-09-20T10:00:00Z",
    unmetConditions: [{ kind: "labels", setBy: "repo", labels: ["x"] }],
  },
});

function readRequestBody(init: RequestInit | undefined): unknown {
  const body = init?.body;
  return typeof body === "string" ? JSON.parse(body) : undefined;
}

function readRequestUrl(input: string | URL | Request | undefined): string {
  if (input === undefined) {
    return "";
  }
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.href;
  }
  return input.url;
}

async function renderActions(
  item: InboxItem,
  archived: InboxArchivedFilter = InboxArchivedFilters.HIDE,
) {
  const onAnnounce = vi.fn();
  const onDelete = vi.fn();
  const onPurgeAttachments = vi.fn();
  const onRemoved = vi.fn();
  const onArchived = vi.fn();
  const { queryClient } = await renderInRouter(
    <RowActions
      archived={archived}
      archiveHeld={false}
      deleteHeld={false}
      item={item}
      onAnnounce={onAnnounce}
      onArchived={onArchived}
      onDelete={onDelete}
      onPurgeAttachments={onPurgeAttachments}
      onRemoved={onRemoved}
    />,
  );
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  return {
    onAnnounce,
    onArchived,
    onDelete,
    onPurgeAttachments,
    onRemoved,
    invalidate,
  };
}

async function openMenu() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
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

  it("offers GitHub from the menu too, for a phone that hides the icon", async () => {
    const opened = vi.spyOn(window, "open").mockReturnValue(null);
    await renderActions(makeItem());

    await openMenu();
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: "Open on GitHub" }));
    });

    expect(opened).toHaveBeenCalledWith(
      "https://github.com/acme/payments/pull/7",
      "_blank",
      "noopener,noreferrer",
    );
    opened.mockRestore();
  });

  it("offers no GitHub link while the repository name is unknown", async () => {
    await renderActions(omitFields(makeItem(), "repoSlug"));

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

  it("a pasted row and a non-admin row offer no purge", async () => {
    await renderActions(URL_ROW);
    await openMenu();
    expect(
      screen.queryByRole("menuitem", { name: "Delete attachment branch" }),
    ).toBeNull();

    cleanup();
    await renderActions(makeItem());
    await openMenu();
    expect(
      screen.queryByRole("menuitem", { name: "Delete attachment branch" }),
    ).toBeNull();
  });

  it("Archive on any row calls the archive transport and frees the row", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    const item = makeItem();
    const { onArchived, onRemoved, invalidate } = await renderActions(item);

    await openMenu();
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: "Archive" }));
    });

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(readRequestUrl(url)).toMatch(
      /\/api\/repos\/424242\/pulls\/7\/archive$/,
    );
    expect(init?.method).toBe("POST");
    expect(onArchived).toHaveBeenCalledWith(
      "Archived; it comes back when a new brief lands",
      [item],
    );
    expect(onRemoved).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: [INBOX_QUERY_ROOT] });
  });

  it("in the archived view the row offers Unarchive instead", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    const { onAnnounce, onRemoved } = await renderActions(
      makeItem(),
      InboxArchivedFilters.ONLY,
    );

    await openMenu();
    expect(screen.queryByRole("menuitem", { name: "Archive" })).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: "Unarchive" }));
    });

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(readRequestUrl(url)).toMatch(
      /\/api\/repos\/424242\/pulls\/7\/unarchive$/,
    );
    expect(init?.method).toBe("POST");
    expect(onAnnounce).toHaveBeenCalledWith("Back in your Inbox");
    expect(onRemoved).toHaveBeenCalledTimes(1);
  });

  it("a refused archive announces the failure and keeps the row", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "x", code: "not-found" }), {
        status: 404,
      }),
    );
    const { onAnnounce, onRemoved } = await renderActions(makeItem());

    await openMenu();
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: "Archive" }));
    });

    expect(onAnnounce).toHaveBeenCalledWith(
      "Archive failed; the row is still here",
    );
    expect(onRemoved).not.toHaveBeenCalled();
  });

  it("an archive GitHub refused for the session sends the viewer to sign in", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ code: "unauthorized" }), { status: 401 }),
    );
    const { onRemoved } = await renderActions(makeItem());
    const assign = vi.fn();
    vi.stubGlobal("location", { assign, href: "/", hash: "", search: "" });

    await openMenu();
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: "Archive" }));
    });

    expect(assign).toHaveBeenCalledWith("/api/auth/github");
    expect(onRemoved).not.toHaveBeenCalled();
  });

  it("a row behind GitHub regenerates through the paste path", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ repoId: "424242", prNumber: 7 }), {
        status: 202,
        headers: { "content-type": "application/json" },
      }),
    );
    const { onAnnounce, invalidate } = await renderActions({
      ...URL_ROW,
      behind: true,
    });

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

  it("a 401 on regenerate announces sign in again and never redirects", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ code: "unauthorized" }), { status: 401 }),
    );
    const { onAnnounce } = await renderActions({ ...URL_ROW, behind: true });
    const assign = vi.fn();
    vi.stubGlobal("location", { assign, href: "/", hash: "", search: "" });

    await openMenu();
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: "Regenerate" }));
    });

    expect(onAnnounce).toHaveBeenCalledWith(
      expect.stringContaining("Sign in again"),
    );
    expect(assign).not.toHaveBeenCalled();
  });

  it("a held row the viewer can push to offers Generate brief", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 202 }));
    const { onAnnounce, invalidate } = await renderActions(HELD_ROW);

    await openMenu();
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: "Generate brief" }));
    });

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(readRequestUrl(url)).toMatch(
      /\/api\/repos\/424242\/pulls\/7\/regenerate$/,
    );
    expect(init?.method).toBe("POST");
    expect(onAnnounce).toHaveBeenCalledWith("Generate queued");
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["inbox"] });
  });

  it("a held head that moved on says so and refreshes the list", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: "refused",
          code: "generation-not-regenerable",
        }),
        {
          status: 409,
        },
      ),
    );
    const { onAnnounce, invalidate } = await renderActions(HELD_ROW);

    await openMenu();
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: "Generate brief" }));
    });

    expect(onAnnounce).toHaveBeenCalledWith("This push is no longer held.");
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["inbox"] });
  });

  it.each([
    ["no push access", { viewerCanPush: false }],
    ["a merged pull request", { state: "merged" as const }],
    [
      "a head that is not held",
      { generation: { status: "failed" as const, updatedAt: "2026-09-20" } },
    ],
  ])(
    "a held row offers no Generate brief with %s",
    async (_label, overrides) => {
      await renderActions({ ...HELD_ROW, ...overrides });
      await openMenu();

      expect(
        screen.queryByRole("menuitem", { name: "Generate brief" }),
      ).toBeNull();
    },
  );

  it("a pusher's open row toggles generate on every push on", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    const { onAnnounce, invalidate } = await renderActions(
      makeItem({ viewerCanPush: true }),
    );

    await openMenu();
    const toggle = screen.getByRole("menuitemcheckbox", {
      name: "Generate on every push",
    });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    await act(async () => {
      fireEvent.click(toggle);
    });

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(readRequestUrl(url)).toMatch(
      /\/api\/repos\/424242\/pulls\/7\/generate-every-push\/on$/,
    );
    expect(init?.method).toBe("POST");
    expect(onAnnounce).toHaveBeenCalledWith(
      "Every push on this pull request now generates a brief.",
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["inbox"] });
    expect(screen.getByRole("menu")).toBeTruthy();
  });

  it("a row already on shows its tick and turns it off", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await renderActions(
      makeItem({ viewerCanPush: true, generateEveryPush: true }),
    );

    await openMenu();
    const toggle = screen.getByRole("menuitemcheckbox", {
      name: "Generate on every push",
    });
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    await act(async () => {
      fireEvent.click(toggle);
    });

    const [url] = fetchMock.mock.calls[0] ?? [];
    expect(readRequestUrl(url)).toMatch(/\/generate-every-push\/off$/);
  });

  it("a refused toggle announces why and leaves the tick as it was", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "refused", code: "not-found" }), {
        status: 404,
      }),
    );
    const { onAnnounce } = await renderActions(
      makeItem({ viewerCanPush: true }),
    );

    await openMenu();
    await act(async () => {
      fireEvent.click(
        screen.getByRole("menuitemcheckbox", {
          name: "Generate on every push",
        }),
      );
    });

    expect(onAnnounce).toHaveBeenCalledWith(
      "Changing this needs push access to this repository and the MergeBrief App installed on it.",
    );
    expect(
      screen
        .getByRole("menuitemcheckbox", { name: "Generate on every push" })
        .getAttribute("aria-checked"),
    ).toBe("false");
  });

  it.each([
    ["no push access", { viewerCanPush: false }],
    ["a pasted row", { source: "url" as const, viewerCanPush: true }],
    [
      "a merged pull request",
      { state: "merged" as const, viewerCanPush: true },
    ],
  ])("offers no every-push toggle with %s", async (_label, overrides) => {
    await renderActions(makeItem(overrides));

    await openMenu();

    expect(screen.queryByRole("menuitemcheckbox")).toBeNull();
  });

  it("an installation row behind GitHub has no Regenerate", async () => {
    await renderActions(makeItem({ behind: true }));
    await openMenu();

    expect(screen.queryByRole("menuitem", { name: "Regenerate" })).toBeNull();
  });

  it("a current row, or one with no repository name, has no Regenerate", async () => {
    await renderActions(makeItem());
    await openMenu();
    expect(screen.queryByRole("menuitem", { name: "Regenerate" })).toBeNull();
    cleanup();

    await renderActions(omitFields(makeItem({ behind: true }), "repoSlug"));
    await openMenu();
    expect(screen.queryByRole("menuitem", { name: "Regenerate" })).toBeNull();
  });

  it.each(["diff-too-large", "output-secret", "provider-refusal"] as const)(
    "a url row whose head failed as %s has no Regenerate",
    async (errorCode) => {
      const generation = {
        status: "failed",
        errorCode,
        updatedAt: "2026-09-20T10:00:00Z",
      } as const;
      await renderActions({ ...URL_ROW, behind: true, generation });
      await openMenu();

      expect(screen.queryByRole("menuitem", { name: "Regenerate" })).toBeNull();
    },
  );

  it.each(["provider-timeout", "provider-auth"] as const)(
    "a url row whose head failed as %s keeps Regenerate",
    async (errorCode) => {
      const generation = {
        status: "failed",
        errorCode,
        updatedAt: "2026-09-20T10:00:00Z",
      } as const;
      await renderActions({ ...URL_ROW, behind: true, generation });
      await openMenu();

      expect(
        screen.getByRole("menuitem", { name: "Regenerate" }),
      ).toBeDefined();
    },
  );

  it("a row the viewer may not delete has no Delete, whatever its source", async () => {
    await renderActions(
      omitFields(makeItem({ source: "url" }), "installationId"),
    );

    await openMenu();

    expect(screen.queryByRole("menuitem", { name: "Delete" })).toBeNull();
  });
});
