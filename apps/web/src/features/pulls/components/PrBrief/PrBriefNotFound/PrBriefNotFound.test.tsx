// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../../../../i18n/I18nProvider";
import { renderInRouter } from "../../../../../test/router";
import { PrBriefNotFound } from ".";

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Promise(() => undefined)),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function renderAtPrPath(path: string): Promise<void> {
  const rootRoute = createRootRoute();
  const prRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/repos/$repoId/pulls/$prNumber",
    component: () => (
      <QueryClientProvider client={new QueryClient()}>
        <I18nProvider>
          <PrBriefNotFound />
        </I18nProvider>
      </QueryClientProvider>
    ),
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([prRoute]),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
  await screen.findByRole("main");
}

describe("PrBriefNotFound", () => {
  it("names both causes and offers the way home", async () => {
    await renderInRouter(
      <I18nProvider>
        <PrBriefNotFound />
      </I18nProvider>,
    );

    const main = screen.getByRole("main");
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "This pull request isn't available",
      }),
    ).toBeTruthy();
    expect(main.textContent).toContain(
      "It may not exist, or your GitHub account may not have access to it.",
    );
    const home = screen.getByRole("link", { name: "Go home" });
    expect(main.contains(home)).toBe(true);
    expect(home.getAttribute("href")).toBe("/");
  });

  it("never echoes the repository or pull request number", async () => {
    await renderAtPrPath("/repos/424242/pulls/999");

    const page = document.body.textContent ?? "";
    expect(page).not.toContain("424242");
    expect(page).not.toContain("999");
  });
});
