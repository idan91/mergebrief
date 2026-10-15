// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildVersionQueryOptions } from "@web/features/version/queries";
import { VersionStates, type VersionState } from "@web/features/version/types";
import { buildViewerQueryOptions } from "../../queries";
import { ViewerStates, type ViewerState } from "../../types";
import { AccountMenu } from ".";

const fetchMock = vi.fn<typeof fetch>();

afterEach(() => {
  cleanup();
  fetchMock.mockReset();
});

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: true, addEventListener: vi.fn() })),
  );
});

function renderWithViewer(
  viewer: ViewerState,
  onOpenShortcuts?: () => void,
  version?: VersionState,
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  queryClient.setQueryData(buildViewerQueryOptions().queryKey, viewer);
  if (version !== undefined) {
    queryClient.setQueryData(buildVersionQueryOptions().queryKey, version);
  }
  render(
    <QueryClientProvider client={queryClient}>
      <AccountMenu onOpenShortcuts={onOpenShortcuts} />
    </QueryClientProvider>,
  );
}

function renderWithoutViewer(): void {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <AccountMenu />
    </QueryClientProvider>,
  );
}

const SIGNED_IN: ViewerState = {
  kind: ViewerStates.SIGNED_IN,
  login: "octocat",
  avatarUrl: "https://avatars.example/octocat.png",
};

describe("AccountMenu", () => {
  it("renders nothing while the viewer loads", () => {
    fetchMock.mockReturnValue(new Promise(() => undefined));
    renderWithoutViewer();

    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("a failed viewer read keeps the menu behind the generic trigger", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    renderWithoutViewer();

    const trigger = await screen.findByRole("button", { name: "Account menu" });
    fireEvent.click(trigger);
    expect(
      await screen.findByRole("menuitem", { name: "Settings" }),
    ).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Sign out" })).toBeTruthy();
  });

  it("signed out, the slot holds a Sign in link", () => {
    renderWithViewer({ kind: ViewerStates.SIGNED_OUT });

    const signIn = screen.getByRole("link", { name: "Sign in with GitHub" });
    expect(signIn.getAttribute("href")).toBe("/api/auth/github");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("signed in, the avatar opens the note, Settings and Sign out", async () => {
    renderWithViewer(SIGNED_IN);

    const trigger = screen.getByRole("button", {
      name: "Account menu for octocat",
    });
    await act(async () => {
      fireEvent.click(trigger);
    });

    expect(screen.getByText("Signed in as octocat")).toBeTruthy();
    const names = screen.getAllByRole("menuitem").map((row) => row.textContent);
    expect(names).toEqual(["Settings", "Sign out"]);
  });

  it("signed in with a modal, the menu is the note and three rows with icons", async () => {
    const onOpenShortcuts = vi.fn();
    renderWithViewer(SIGNED_IN, onOpenShortcuts);

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Account menu for octocat" }),
      );
    });

    expect(screen.getByText("Signed in as octocat")).toBeTruthy();
    const rows = screen.getAllByRole("menuitem");
    expect(rows.map((row) => row.textContent)).toEqual([
      "Settings",
      "Keyboard shortcuts",
      "Sign out",
    ]);
    expect(rows.every((row) => row.querySelector("svg") !== null)).toBe(true);
    await act(async () => {
      fireEvent.click(
        screen.getByRole("menuitem", { name: "Keyboard shortcuts" }),
      );
    });
    expect(onOpenShortcuts).toHaveBeenCalledTimes(1);
  });

  it("language selection on, the rows carry lang and one is checked", async () => {
    vi.stubEnv("ENABLE_LANGUAGE_SELECTION", "true");
    renderWithViewer(SIGNED_IN);
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Account menu for octocat" }),
      );
    });

    const rows = screen.getAllByRole("menuitemradio");
    const checked = rows.filter(
      (row) => row.getAttribute("aria-checked") === "true",
    );
    expect(checked).toHaveLength(1);
    expect(checked[0]?.textContent).toBe("English");
    expect(checked[0]?.getAttribute("lang")).toBe("en");
    const pseudo = rows.find((row) => /pseudo/i.test(row.textContent ?? ""));
    expect(pseudo).toBeTruthy();
    expect(pseudo?.getAttribute("lang")).toBeNull();
    vi.unstubAllEnvs();
  });

  it("the shortcuts row exists only where a modal does", async () => {
    const onOpenShortcuts = vi.fn();
    renderWithViewer(SIGNED_IN, onOpenShortcuts);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Account menu/ }));
    });
    await act(async () => {
      fireEvent.click(
        screen.getByRole("menuitem", { name: "Keyboard shortcuts" }),
      );
    });

    expect(onOpenShortcuts).toHaveBeenCalledTimes(1);
    // The modal a row opens captures the trigger, not the vanishing row.
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: /Account menu/ }),
    );
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("a row hands focus to the trigger before the panel leaves", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: false, addEventListener: vi.fn() })),
    );
    renderWithViewer(SIGNED_IN, vi.fn());
    const trigger = screen.getByRole("button", { name: /Account menu/ });

    await act(async () => {
      fireEvent.click(trigger);
    });
    const row = screen.getByRole("menuitem", { name: "Keyboard shortcuts" });
    // A real pointer press focuses the row a frame before the click lands;
    // jsdom's click does not, so the press is played by hand.
    await act(async () => {
      row.focus();
      await new Promise((resolve) => setTimeout(resolve, 40));
    });
    await act(async () => {
      fireEvent.click(row);
    });

    // The exit transition still holds the panel in the DOM; focus is home already.
    expect(screen.getByRole("menu")).toBeTruthy();
    expect(document.activeElement).toBe(trigger);
  });

  async function openSignOutModal(): Promise<void> {
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Account menu/ }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));
    });
  }

  it("the Sign out row closes the menu and opens the confirm on Cancel", async () => {
    renderWithViewer(SIGNED_IN);

    await openSignOutModal();

    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.getByRole("dialog", { name: "Sign out?" })).toBeTruthy();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Cancel" }),
    );
  });

  it("This device posts to the logout route and leaves for Home", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    const assign = vi.fn();
    vi.stubGlobal("location", { assign, href: "/", hash: "", search: "" });
    renderWithViewer(SIGNED_IN);

    await openSignOutModal();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "This device" }));
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/logout",
      expect.objectContaining({ method: "POST" }),
    );
    expect(assign).toHaveBeenCalledWith("/");
  });

  it("Everywhere deletes every session and leaves for Home", async () => {
    fetchMock.mockImplementation(async () =>
      Response.json({ revoked: 2 }, { status: 200 }),
    );
    const assign = vi.fn();
    vi.stubGlobal("location", { assign, href: "/", hash: "", search: "" });
    renderWithViewer(SIGNED_IN);

    await openSignOutModal();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Everywhere" }));
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/sessions",
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(assign).toHaveBeenCalledWith("/");
  });

  it("a refused sign out keeps the confirm open and reports inside it", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 503 }));
    const assign = vi.fn();
    vi.stubGlobal("location", { assign, href: "/", hash: "", search: "" });
    renderWithViewer(SIGNED_IN);

    await openSignOutModal();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "This device" }));
    });

    expect(assign).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog", { name: "Sign out?" });
    const alert = screen.getByRole("alert");
    expect(dialog.contains(alert)).toBe(true);
    expect(alert.textContent).toBe("Sign out did not go through. Try again.");
    expect(
      screen
        .getByRole("button", { name: "This device" })
        .getAttribute("aria-disabled"),
    ).toBeNull();
  });

  it("a refused sign out everywhere keeps the confirm open", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 503 }));
    const assign = vi.fn();
    vi.stubGlobal("location", { assign, href: "/", hash: "", search: "" });
    renderWithViewer(SIGNED_IN);

    await openSignOutModal();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Everywhere" }));
    });

    expect(assign).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe(
      "Sign out did not go through. Try again.",
    );
  });

  it("while a sign out runs the chosen button reads busy and Escape holds", async () => {
    let settle: (response: Response) => void = () => undefined;
    fetchMock.mockReturnValue(
      new Promise<Response>((resolve) => {
        settle = resolve;
      }),
    );
    const assign = vi.fn();
    vi.stubGlobal("location", { assign, href: "/", hash: "", search: "" });
    renderWithViewer(SIGNED_IN);

    await openSignOutModal();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "This device" }));
    });
    await act(async () => {
      fireEvent.keyDown(window, { key: "Escape" });
    });

    const busy = screen.getByRole("button", { name: "Signing out" });
    expect(busy.getAttribute("aria-busy")).toBe("true");
    expect(screen.getByRole("dialog", { name: "Sign out?" })).toBeTruthy();
    await act(async () => {
      settle(new Response(null, { status: 204 }));
    });
    expect(assign).toHaveBeenCalledWith("/");
  });

  it("Cancel closes the confirm and focus returns to the avatar", async () => {
    renderWithViewer(SIGNED_IN);
    const trigger = screen.getByRole("button", { name: /Account menu/ });

    await openSignOutModal();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    });

    expect(
      screen.getByRole("dialog", { hidden: true }).closest("[inert]"),
    ).not.toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});

const DISMISSED: VersionState = {
  kind: VersionStates.KNOWN,
  snapshot: {
    version: "1.4.0",
    latest: "1.6.0",
    releaseNotesUrl: "https://example.test/releases/v1.6.0",
    checkedAt: "2026-10-03T10:00:00.000Z",
    breaking: false,
    security: false,
    dismissedVersion: "1.6.0",
  },
};

describe("AccountMenu after the version notice is dismissed", () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it("marks the trigger with the dot and names the new version", () => {
    renderWithViewer(SIGNED_IN, undefined, DISMISSED);

    const trigger = screen.getByRole("button", {
      name: "Account menu for octocat, a new version is available",
    });
    expect(
      trigger.contains(screen.getByTestId("version-presence")) &&
        screen.getByTestId("version-presence").hasAttribute("data-presence"),
    ).toBe(true);
  });

  it("lists the release above Settings and opens its notes", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    renderWithViewer(SIGNED_IN, undefined, DISMISSED);

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /Account menu for octocat/ }),
      );
    });

    const rows = screen.getAllByRole("menuitem");
    expect(rows.map((row) => row.textContent)).toEqual([
      "MergeBrief 1.6.0 is available",
      "Settings",
      "Sign out",
    ]);
    await act(async () => {
      fireEvent.click(
        screen.getByRole("menuitem", { name: "MergeBrief 1.6.0 is available" }),
      );
    });
    expect(open).toHaveBeenCalledWith(
      "https://example.test/releases/v1.6.0",
      "_blank",
      "noreferrer",
    );
    open.mockRestore();
  });

  it("clears the dot on the first open and keeps the row", async () => {
    renderWithViewer(SIGNED_IN, undefined, DISMISSED);
    const trigger = screen.getByRole("button", {
      name: /Account menu for octocat/,
    });

    await act(async () => {
      fireEvent.click(trigger);
    });

    expect(
      screen.getByTestId("version-presence").hasAttribute("data-presence"),
    ).toBe(false);
    expect(
      screen.getByRole("menuitem", { name: "MergeBrief 1.6.0 is available" }),
    ).toBeTruthy();
    expect(window.localStorage.getItem("mergebrief.versionSeen")).toBe(
      JSON.stringify("1.6.0"),
    );
  });

  it("clears the dot when an arrow key opens the menu", async () => {
    renderWithViewer(SIGNED_IN, undefined, DISMISSED);
    const trigger = screen.getByRole("button", {
      name: /Account menu for octocat/,
    });

    await act(async () => {
      fireEvent.keyDown(trigger, { key: "ArrowDown" });
    });

    expect(
      screen.getByTestId("version-presence").hasAttribute("data-presence"),
    ).toBe(false);
    expect(window.localStorage.getItem("mergebrief.versionSeen")).toBe(
      JSON.stringify("1.6.0"),
    );
  });

  it("stays plain once a newer release reopens the band", async () => {
    renderWithViewer(SIGNED_IN, undefined, {
      kind: VersionStates.KNOWN,
      snapshot: { ...DISMISSED.snapshot, dismissedVersion: "1.5.0" },
    });
    const trigger = screen.getByRole("button", {
      name: "Account menu for octocat",
    });
    expect(
      screen.getByTestId("version-presence").hasAttribute("data-presence"),
    ).toBe(false);

    await act(async () => {
      fireEvent.click(trigger);
    });

    expect(
      screen.getAllByRole("menuitem").map((row) => row.textContent),
    ).toEqual(["Settings", "Sign out"]);
  });

  it("never lists a security release as dismissed", async () => {
    renderWithViewer(SIGNED_IN, undefined, {
      kind: VersionStates.KNOWN,
      snapshot: { ...DISMISSED.snapshot, security: true },
    });

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Account menu for octocat" }),
      );
    });

    expect(
      screen.getAllByRole("menuitem").map((row) => row.textContent),
    ).toEqual(["Settings", "Sign out"]);
  });
});
