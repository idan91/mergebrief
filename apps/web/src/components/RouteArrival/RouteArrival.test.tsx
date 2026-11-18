// @vitest-environment jsdom
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
  type AnyRouter,
} from "@tanstack/react-router";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";

import { Button } from "@web/components/Button";
import { MAIN_CONTENT_ID } from "@web/utils/main-content";

import { RouteArrival } from ".";

const OTHER_PAGE_TITLE = "Other page";
const SAME_PAGE_TITLE = "Same page";

afterEach(() => {
  cleanup();
  document.title = "";
});

/**
 * A router whose root holds the region, a field and the main landmark, so
 * all three outlive a move; the "/" page holds a button that leaves with it.
 */
async function renderArrivalRouter(): Promise<AnyRouter> {
  const rootRoute = createRootRoute({
    component: () => (
      <>
        <RouteArrival />
        <input aria-label="Search" />
        <main id={MAIN_CONTENT_ID} tabIndex={-1}>
          <Outlet />
        </main>
      </>
    ),
  });
  const home = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => <Button variant="secondary">Leaves with the page</Button>,
  });
  const other = createRoute({
    getParentRoute: () => rootRoute,
    path: "/other",
    component: () => null,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([home, other]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
  return router;
}

async function navigateTo(
  router: AnyRouter,
  target: { to: string; search?: Record<string, string>; hash?: string },
): Promise<void> {
  await act(async () => {
    await router.navigate(target);
  });
}

async function waitOneFrame(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => resolve());
    });
  });
}

function readStatus(): string {
  return screen.getByTestId("route-arrival").textContent;
}

describe("RouteArrival", () => {
  it("stays quiet and keeps focus on a search-only move", async () => {
    const router = await renderArrivalRouter();
    const field = screen.getByRole("textbox", { name: "Search" });
    field.focus();
    document.title = SAME_PAGE_TITLE;

    await navigateTo(router, { to: "/", search: { q: "next" } });
    await waitOneFrame();

    expect(readStatus()).toBe("");
    expect(document.activeElement).toBe(field);
  });

  it("stays quiet and keeps focus on a hash-only move", async () => {
    const router = await renderArrivalRouter();
    const field = screen.getByRole("textbox", { name: "Search" });
    field.focus();
    document.title = SAME_PAGE_TITLE;

    await navigateTo(router, { to: "/", hash: "section" });
    await waitOneFrame();

    expect(readStatus()).toBe("");
    expect(document.activeElement).toBe(field);
  });

  it("names the new page and leaves a kept focus where it is", async () => {
    const router = await renderArrivalRouter();
    const field = screen.getByRole("textbox", { name: "Search" });
    field.focus();
    document.title = OTHER_PAGE_TITLE;

    await navigateTo(router, { to: "/other" });

    await waitFor(() => expect(readStatus()).toBe(OTHER_PAGE_TITLE));
    expect(document.activeElement).toBe(field);
  });

  it("moves a focus the old page took with it to the main landmark", async () => {
    const router = await renderArrivalRouter();
    screen.getByRole("button", { name: "Leaves with the page" }).focus();
    const focusSpy = vi.spyOn(HTMLElement.prototype, "focus");
    onTestFinished(() => focusSpy.mockRestore());

    await navigateTo(router, { to: "/other" });

    expect(document.activeElement?.id).toBe(MAIN_CONTENT_ID);
    expect(focusSpy).toHaveBeenCalledWith({ preventScroll: true });
  });
});
