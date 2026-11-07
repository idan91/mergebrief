// @vitest-environment jsdom
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { afterEach, describe, expect, it } from "vitest";

import { appI18n } from "../../i18n/I18nProvider";
import { NavigationProgress } from ".";
import { NAVIGATION_NOTICE_DELAY_MS } from "./consts";

afterEach(cleanup);

function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** An instant settings route and a brief route whose loader waits on `gate`. */
async function renderWithRoutes(gate: Promise<void>) {
  const rootRoute = createRootRoute({
    component: () => (
      <I18nextProvider i18n={appI18n}>
        <NavigationProgress />
        <Outlet />
      </I18nextProvider>
    ),
  });
  const home = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => null,
  });
  const fast = createRoute({
    getParentRoute: () => rootRoute,
    path: "/settings",
    component: () => null,
  });
  const slow = createRoute({
    getParentRoute: () => rootRoute,
    path: "/repos/$repoId/pulls/$prNumber",
    loader: () => gate,
    component: () => null,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([home, fast, slow]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
  return router;
}

function readNotice(): string | null {
  return screen.getByRole("status").textContent;
}

describe("NavigationProgress", () => {
  it("says the page is loading once a navigation runs slow", async () => {
    let openGate: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      openGate = resolve;
    });
    const router = await renderWithRoutes(gate);
    const region = screen.getByRole("status");
    let changes = 0;
    const observer = new MutationObserver(() => {
      changes += 1;
    });
    observer.observe(region, {
      childList: true,
      characterData: true,
      subtree: true,
    });

    let landed: Promise<void> = Promise.resolve();
    act(() => {
      landed = router.navigate({
        to: "/repos/$repoId/pulls/$prNumber",
        params: { repoId: "1", prNumber: "7" },
      });
    });
    expect(readNotice()).toBe("");
    await waitFor(() => {
      expect(readNotice()).toBe("Loading the page");
    });
    await act(() => waitMs(NAVIGATION_NOTICE_DELAY_MS * 3));
    expect(changes).toBe(1);
    expect(screen.getByTestId("navigation-progress")).toBeTruthy();

    await act(async () => {
      openGate();
      await landed;
    });
    await waitFor(() => {
      expect(readNotice()).toBe("");
    });
    observer.disconnect();
    expect(screen.queryByTestId("navigation-progress")).toBeNull();
  });

  it("stays quiet for a navigation that lands at once", async () => {
    const router = await renderWithRoutes(Promise.resolve());

    await act(() => router.navigate({ to: "/settings" }));
    await act(() => waitMs(NAVIGATION_NOTICE_DELAY_MS * 2));

    expect(readNotice()).toBe("");
  });
});
