// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderInRouter } from "@web/test/router";
import type { ForkPrStack, LinearPrStack } from "../../../../../model/types";
import { StackArrows } from ".";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const REPO_SLUG = "acme/widgets";
const PULL_ROUTE = "/repos/$repoId/pulls/$prNumber";

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
    { number: 13, title: "Middle" },
    { number: 15, title: "Fork sibling" },
  ],
};

async function renderArrows(
  stack: LinearPrStack | ForkPrStack,
  currentNumber: number,
  repoId: string | undefined,
) {
  return await renderInRouter(
    <StackArrows
      currentNumber={currentNumber}
      repoSlug={REPO_SLUG}
      repoId={repoId}
      stack={stack}
    >
      <span data-testid="chip" />
    </StackArrows>,
    undefined,
    [PULL_ROUTE],
  );
}

describe("StackArrows", () => {
  it("frames the arrows and the chip as one named stepper", async () => {
    await renderArrows(LINEAR, 13, "42");
    const stepper = screen.getByRole("group", { name: "Stack navigation" });
    expect(stepper.firstElementChild).toBe(
      screen.getByTestId("stack-previous"),
    );
    expect(stepper.lastElementChild).toBe(screen.getByTestId("stack-next"));
    expect(stepper.contains(screen.getByTestId("chip"))).toBe(true);
  });

  it("names both neighbours in the middle of a linear stack", async () => {
    await renderArrows(LINEAR, 13, "42");
    const previous = screen.getByTestId("stack-previous");
    const next = screen.getByTestId("stack-next");
    expect(previous.getAttribute("aria-label")).toBe(
      "Previous PR in stack, #12: Bottom",
    );
    expect(next.getAttribute("aria-label")).toBe("Next PR in stack, #14: Tip");
    expect(previous.hasAttribute("aria-disabled")).toBe(false);
  });

  it("flanks the chip, previous before and next after", async () => {
    await renderArrows(LINEAR, 13, "42");
    const order = [...screen.getByTestId("stack-arrows").children].map(
      (child) => child.getAttribute("data-testid"),
    );
    expect(order).toEqual(["stack-previous", "chip", "stack-next"]);
  });

  it("follows the app route when the repo is known", async () => {
    const { router } = await renderArrows(LINEAR, 13, "42");
    fireEvent.click(screen.getByTestId("stack-next"));
    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/repos/42/pulls/14"),
    );
  });

  it("disables the arrow at an end of the stack", async () => {
    const { router } = await renderArrows(LINEAR, 14, "42");
    const next = screen.getByTestId("stack-next");
    expect(next.getAttribute("aria-disabled")).toBe("true");
    expect(next.getAttribute("aria-label")).toBe("No next PR in stack");
    fireEvent.click(next);
    expect(router.state.location.pathname).toBe("/");
  });

  it("renders the chip alone for a fork", async () => {
    await renderArrows(FORK, 13, "42");
    expect(screen.getByTestId("chip")).toBeTruthy();
    expect(screen.queryByTestId("stack-arrows")).toBeNull();
  });

  it("opens GitHub in a new tab when the repo is unknown", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    await renderArrows(LINEAR, 13, undefined);
    const previous = screen.getByTestId("stack-previous");
    expect(previous.getAttribute("aria-label")).toBe(
      "Previous PR in stack, #12: Bottom (opens in a new tab)",
    );
    fireEvent.click(previous);
    expect(open).toHaveBeenCalledWith(
      "https://github.com/acme/widgets/pull/12",
      "_blank",
      "noopener,noreferrer",
    );
  });
});
