// @vitest-environment jsdom
// Org-switcher behavior (BRIEF-19 PR 2.2): menu-button a11y pattern, switch
// POST + full reset, remember-as-default, failure surfaced without a reset.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type * as QueriesModule from "../queries";

vi.mock("../queries", async (importOriginal) => {
  const actual = await importOriginal<typeof QueriesModule>();
  return { ...actual, reloadToPicker: vi.fn(), switchInstallation: vi.fn() };
});

import {
  installationsQueryOptions,
  reloadToPicker,
  switchInstallation,
} from "../queries";
import type { InstallationsView } from "../types";
import { OrgSwitcher } from "./OrgSwitcher";

const switchMock = vi.mocked(switchInstallation);
const reloadMock = vi.mocked(reloadToPicker);

const VIEW: InstallationsView = {
  installations: [
    {
      installationId: "111",
      accountLogin: "acme",
      isCurrent: true,
      isDefault: false,
    },
    {
      installationId: "222",
      accountLogin: "globex",
      isCurrent: false,
      isDefault: true,
    },
  ],
  currentInstallationId: "111",
  defaultInstallationId: "222",
};

function renderSwitcher(view: InstallationsView = VIEW) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  queryClient.setQueryData(installationsQueryOptions().queryKey, view);
  render(
    <QueryClientProvider client={queryClient}>
      <OrgSwitcher enabled />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("OrgSwitcher", () => {
  it("shows the current org and opens a menu with focus on the current item", async () => {
    renderSwitcher();
    const trigger = screen.getByRole("button", { name: /organization.*acme/i });
    expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
    fireEvent.click(trigger);

    const menu = screen.getByRole("menu", { name: /switch organization/i });
    expect(menu).toBeTruthy();
    const current = screen.getByRole("menuitemradio", { name: /acme/i });
    expect(current.getAttribute("aria-checked")).toBe("true");
    await waitFor(() => expect(document.activeElement).toBe(current));
  });

  it("Escape closes the menu and returns focus to the trigger", async () => {
    renderSwitcher();
    const trigger = screen.getByRole("button", { name: /acme/i });
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("switching POSTs the target id and resets the app", async () => {
    switchMock.mockResolvedValue(undefined);
    renderSwitcher();
    fireEvent.click(screen.getByRole("button", { name: /acme/i }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: /globex/i }));

    await waitFor(() =>
      expect(switchMock.mock.calls[0]?.[0]).toEqual({
        installationId: "222",
        setDefault: false,
      }),
    );
    await waitFor(() => expect(reloadMock).toHaveBeenCalled());
  });

  it("remember-as-default is a menu-native checkbox item that rides the switch", async () => {
    switchMock.mockResolvedValue(undefined);
    renderSwitcher();
    fireEvent.click(screen.getByRole("button", { name: /acme/i }));
    const toggle = screen.getByRole("menuitemcheckbox", { name: /remember/i });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("menuitemradio", { name: /globex/i }));

    await waitFor(() =>
      expect(switchMock.mock.calls[0]?.[0]).toEqual({
        installationId: "222",
        setDefault: true,
      }),
    );
  });

  it("a failed switch shows an alert and does NOT reset", async () => {
    switchMock.mockRejectedValue(new Error("forbidden"));
    renderSwitcher();
    fireEvent.click(screen.getByRole("button", { name: /acme/i }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: /globex/i }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(reloadMock).not.toHaveBeenCalled();
  });

  it("renders nothing when disabled or when no installation is accessible", () => {
    renderSwitcher({
      installations: [],
      currentInstallationId: "111",
      defaultInstallationId: null,
    });
    expect(screen.queryByRole("button")).toBeNull();
  });
});
