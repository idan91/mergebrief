// @vitest-environment jsdom
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { ForkPrStack, LinearPrStack } from "../../../../types";
import { StackChip } from ".";

afterEach(cleanup);

const LINEAR: LinearPrStack = {
  members: [
    { number: 12, title: "Bottom" },
    { number: 13, title: "Middle" },
    { number: 14, title: "Tip" },
  ],
  index: 2,
};

const FORK: ForkPrStack = {
  parent: { number: 12, title: "Bottom" },
  children: [
    { number: 14, title: "Tip" },
    { number: 15, title: "Fork sibling" },
  ],
};

async function renderChip(
  ui: Parameters<typeof render>[0],
): Promise<ReturnType<typeof render>> {
  const rootRoute = createRootRoute();
  const homeRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => ui,
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
  return render(<RouterProvider router={router} />);
}

describe("StackChip", () => {
  it("shows the linear index over total", async () => {
    await renderChip(
      <StackChip
        currentNumber={13}
        prUrl="https://github.com/o/r/pull/13"
        stack={LINEAR}
      />,
    );
    expect(
      screen.getByRole("button", { name: "pull request 2 of 3 in the stack" })
        .textContent,
    ).toBe("2/3");
    expect(
      screen
        .getByRole("button", { name: "pull request 2 of 3 in the stack" })
        .querySelector("svg[aria-hidden='true']"),
    ).toBeTruthy();
  });

  it("shows stacked without a fraction on a fork", async () => {
    await renderChip(
      <StackChip
        currentNumber={13}
        prUrl="https://github.com/o/r/pull/13"
        stack={FORK}
      />,
    );
    const chip = screen.getByRole("button", { name: "Stacked" });
    expect(chip.textContent).toBe("Stacked");
    expect(chip.textContent).not.toMatch(/\d+\/\d+/);
  });

  it("lists titles and keeps the current PR from being a link", async () => {
    await renderChip(
      <StackChip
        currentNumber={13}
        prUrl="https://github.com/o/r/pull/13"
        stack={LINEAR}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "pull request 2 of 3 in the stack" }),
    );
    expect(screen.getByRole("link", { name: /#12 Bottom/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: /#14 Tip/ })).toBeTruthy();
    const current = screen.getByText("Middle").closest("[aria-current='true']");
    expect(current).toBeTruthy();
    expect(current?.closest("a")).toBeNull();
    expect(current?.getAttribute("aria-label")).toBe("#13 Middle");
  });

  it("links a neighbour through the in-app repo pull route", async () => {
    await renderChip(
      <StackChip
        currentNumber={13}
        prUrl="https://github.com/o/r/pull/13"
        repoId="424242"
        stack={LINEAR}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "pull request 2 of 3 in the stack" }),
    );
    expect(
      screen.getByRole("link", { name: "#12 Bottom" }).getAttribute("href"),
    ).toBe("/repos/424242/pulls/12");
  });

  it("rewrites the GitHub URL when repo identity is absent", async () => {
    await renderChip(
      <StackChip
        currentNumber={13}
        prUrl="https://github.com/o/r/pull/13"
        stack={LINEAR}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "pull request 2 of 3 in the stack" }),
    );
    expect(
      screen.getByRole("link", { name: /#12 Bottom/ }).getAttribute("href"),
    ).toBe("https://github.com/o/r/pull/12");
  });

  it("notes the generation-time stack when it differs from the live one", async () => {
    const snapshot: LinearPrStack = {
      members: [
        { number: 12, title: "Bottom" },
        { number: 13, title: "Middle" },
      ],
      index: 2,
    };
    await renderChip(
      <StackChip
        currentNumber={13}
        prUrl="https://github.com/o/r/pull/13"
        snapshot={snapshot}
        stack={LINEAR}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "pull request 2 of 3 in the stack" }),
    );
    expect(
      screen.getByText("Stack changed since this brief was generated"),
    ).toBeTruthy();
    const live = screen.getByRole("list", {
      name: "Pull requests in this stack",
    });
    const then = screen.getByRole("list", {
      name: "Pull requests in the stack when this brief was generated",
    });
    expect(live.querySelectorAll("li")).toHaveLength(3);
    expect(then.querySelectorAll("li")).toHaveLength(2);
  });

  it("shows no note when the stacks agree", async () => {
    await renderChip(
      <StackChip
        currentNumber={13}
        prUrl="https://github.com/o/r/pull/13"
        stack={LINEAR}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "pull request 2 of 3 in the stack" }),
    );
    expect(
      screen.queryByText("Stack changed since this brief was generated"),
    ).toBeNull();
  });

  it("dates a recorded stack in the panel", async () => {
    await renderChip(
      <StackChip
        asOf="2026-09-19T12:00:00.000Z"
        currentNumber={13}
        prUrl="https://github.com/o/r/pull/13"
        stack={LINEAR}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "pull request 2 of 3 in the stack" }),
    );
    expect(screen.getByText("As of Sep 19, 2026")).toBeTruthy();
  });

  it("labels the generation-time stack when it stands in for the live one", async () => {
    await renderChip(
      <StackChip
        atGeneration
        currentNumber={13}
        prUrl="https://github.com/o/r/pull/13"
        stack={LINEAR}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "pull request 2 of 3 in the stack" }),
    );
    expect(screen.getByText("At generation time")).toBeTruthy();
    expect(
      screen.queryByText("Stack changed since this brief was generated"),
    ).toBeNull();
    expect(
      screen.getByRole("list", {
        name: "Pull requests in the stack when this brief was generated",
      }),
    ).toBeTruthy();
    expect(screen.queryByText(/^As of /)).toBeNull();
  });

  it("keeps the panel open on the first click after hover", async () => {
    await renderChip(
      <StackChip
        currentNumber={13}
        prUrl="https://github.com/o/r/pull/13"
        stack={LINEAR}
      />,
    );
    const chip = screen.getByRole("button", {
      name: "pull request 2 of 3 in the stack",
    });
    const hoverArea = chip.parentElement;
    if (hoverArea === null) throw new Error("missing hover area");
    fireEvent.pointerEnter(hoverArea, { pointerType: "mouse" });
    expect(chip.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(chip);
    expect(chip.getAttribute("aria-expanded")).toBe("true");
    const panel = screen.getByRole("list").closest("[tabindex='-1']");
    expect(document.activeElement).toBe(panel);
  });
});
