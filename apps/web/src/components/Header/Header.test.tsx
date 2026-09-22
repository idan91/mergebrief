// @vitest-environment jsdom
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Header } from "./Header";

afterEach(cleanup);

async function renderHeader(end?: React.ReactNode) {
  const rootRoute = createRootRoute();
  const homeRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => <Header end={end} />,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([homeRoute]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
}

describe("Header", () => {
  it("renders the wordmark as a link to Home inside a banner", async () => {
    await renderHeader();

    const banner = screen.getByRole("banner");
    const wordmark = screen.getByRole("link", { name: "MergeBrief" });
    expect(banner.contains(wordmark)).toBe(true);
    expect(wordmark.getAttribute("href")).toBe("/");
  });

  it("puts the end slot after the wordmark", async () => {
    await renderHeader(<span data-testid="end">Account</span>);

    const wordmark = screen.getByRole("link", { name: "MergeBrief" });
    const account = screen.getByTestId("end");
    const order = wordmark.compareDocumentPosition(account);
    expect(order & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
