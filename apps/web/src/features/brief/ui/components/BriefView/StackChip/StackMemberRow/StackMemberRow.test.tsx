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

import type { StackRow } from "../types";
import { StackMemberRow } from ".";

const MEMBER = { number: 13, title: "Middle" };

async function renderRow(row: StackRow, repoId?: string): Promise<void> {
  const rootRoute = createRootRoute();
  const homeRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => (
      <StackMemberRow repoId={repoId} repoSlug="o/r" row={row} />
    ),
  });
  const prRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/repos/$repoId/pulls/$prNumber",
    component: () => null,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([homeRoute, prRoute]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
}

describe("StackMemberRow", () => {
  afterEach(cleanup);

  it("shows the place, title and number of a member", async () => {
    await renderRow({ member: MEMBER, position: 4, current: false }, "42");
    const link = screen.getByRole("link", { name: "#13 Middle" });
    expect(link.getAttribute("href")).toBe("/repos/42/pulls/13?view=full");
    expect(link.textContent).toBe("4Middle#13");
  });

  it("keeps the current PR as a labelled row rather than a link", async () => {
    await renderRow({ member: MEMBER, position: 4, current: true }, "42");
    expect(screen.queryByRole("link")).toBeNull();
    const row = screen.getByText("Middle").closest("[aria-current='true']");
    expect(row?.getAttribute("aria-label")).toBe("#13 Middle");
  });

  it("links to GitHub in a new tab without a repo id", async () => {
    await renderRow({ member: MEMBER, position: 4, current: false });
    const link = screen.getByRole("link", {
      name: "#13 Middle (opens in a new tab)",
    });
    expect(link.getAttribute("href")).toBe("https://github.com/o/r/pull/13");
    expect(link.getAttribute("target")).toBe("_blank");
  });

  it("leaves the place blank for a row of a fork", async () => {
    await renderRow({ member: MEMBER, current: false }, "42");
    expect(screen.getByRole("link").textContent).toBe("Middle#13");
  });

  it("names the branch after the number when the live read knows it", async () => {
    const member = { ...MEMBER, headRef: "feature/middle" };
    await renderRow({ member, position: 4, current: false }, "42");
    expect(screen.getByText("#13 · feature/middle")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "#13 Middle, feature/middle" }),
    ).toBeTruthy();
  });

  it("draws an open member's state and names it in the link", async () => {
    const member = { ...MEMBER, state: "open" as const };
    await renderRow({ member, position: 4, current: false }, "42");
    const link = screen.getByRole("link", { name: "#13 Middle, Open" });
    const icon = link.querySelector("[data-icon]");
    expect(icon?.getAttribute("data-icon")).toBe("git-pull-request");
    expect(icon?.closest("[data-state]")?.getAttribute("data-state")).toBe(
      "open",
    );
  });

  it("names a draft current row's state and branch in its label", async () => {
    const member = { ...MEMBER, state: "draft" as const, headRef: "f/mid" };
    await renderRow({ member, position: 4, current: true }, "42");
    const row = screen.getByText("Middle").closest("[aria-current='true']");
    expect(row?.getAttribute("aria-label")).toBe("#13 Middle, Draft, f/mid");
    const icon = row?.querySelector("[data-icon]");
    expect(icon?.getAttribute("data-icon")).toBe("circle-dashed");
  });

  it("draws no state for one this bundle predates", async () => {
    const member = { ...MEMBER, state: "unknown" as const };
    await renderRow({ member, position: 4, current: false }, "42");
    expect(document.querySelector("[data-icon]")).toBeNull();
    expect(screen.getByRole("link", { name: "#13 Middle" })).toBeTruthy();
  });
});
