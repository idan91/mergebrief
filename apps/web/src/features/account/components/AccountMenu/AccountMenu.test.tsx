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

import { buildViewerQueryOptions } from "../../queries";
import { ViewerStates, type ViewerState } from "../../types";
import { AccountMenu } from "./AccountMenu";

const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", fetchMock);

afterEach(() => {
  cleanup();
  fetchMock.mockReset();
});

beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: true, addEventListener: vi.fn() })),
  );
});

function renderWithViewer(viewer: ViewerState, onOpenShortcuts?: () => void) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  queryClient.setQueryData(buildViewerQueryOptions().queryKey, viewer);
  render(
    <QueryClientProvider client={queryClient}>
      <AccountMenu onOpenShortcuts={onOpenShortcuts} />
    </QueryClientProvider>,
  );
}

const SIGNED_IN: ViewerState = {
  kind: ViewerStates.SIGNED_IN,
  login: "octocat",
  avatarUrl: "https://avatars.example/octocat.png",
};

describe("AccountMenu", () => {
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

  it("Sign out posts to the logout route", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    const assign = vi.fn();
    vi.stubGlobal("location", { assign, href: "/", hash: "", search: "" });
    renderWithViewer(SIGNED_IN);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Account menu/ }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/logout",
      expect.objectContaining({ method: "POST" }),
    );
    expect(assign).toHaveBeenCalledWith("/");
  });

  it("a refused sign out keeps the page and says so", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 503 }));
    const assign = vi.fn();
    vi.stubGlobal("location", { assign, href: "/", hash: "", search: "" });
    renderWithViewer(SIGNED_IN);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Account menu/ }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));
    });

    expect(assign).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe(
      "Sign out did not go through. Try again.",
    );
    expect(
      screen
        .getByRole("menuitem", { name: "Sign out" })
        .getAttribute("aria-disabled"),
    ).toBeNull();
  });
});
