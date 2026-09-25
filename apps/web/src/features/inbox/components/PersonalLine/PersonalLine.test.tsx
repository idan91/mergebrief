// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { PersonalLine } from ".";

afterEach(cleanup);

function renderCounts(updated: number, fresh: number, inProgress = 0) {
  render(
    <PersonalLine counts={{ new: fresh, inProgress, reviewed: 0, updated }} />,
  );
}

describe("PersonalLine", () => {
  it("an empty Inbox says so in the slot instead of counting", () => {
    render(
      <PersonalLine
        counts={{ new: 0, inProgress: 0, reviewed: 0, updated: 0 }}
        empty
      />,
    );

    expect(
      screen.getByRole("heading", { level: 1, name: "Nothing to review yet" }),
    ).toBeTruthy();
    expect(screen.getByText(/Paste a pull request URL below/)).toBeTruthy();
  });

  it("counts every waiting row and lists the states, changed first", () => {
    renderCounts(2, 1, 1);

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "4 pull requests need your attention",
      }),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "2 changed since you reviewed them, 1 is new, 1 in progress.",
      ),
    ).toBeTruthy();
  });

  it("leaves a zero state out of the detail", () => {
    renderCounts(0, 3);

    expect(
      screen.getByRole("heading", {
        name: "3 pull requests need your attention",
      }),
    ).toBeTruthy();
    expect(screen.getByText("3 are new.")).toBeTruthy();
  });

  it("one waiting row reads in the singular and names its state", () => {
    renderCounts(1, 0);

    expect(
      screen.getByRole("heading", {
        name: "1 pull request needs your attention",
      }),
    ).toBeTruthy();
    expect(screen.getByText("It changed since you reviewed it.")).toBeTruthy();
  });

  it("one new row and one in progress each name their state", () => {
    renderCounts(0, 1);
    expect(screen.getByText("It is new to you.")).toBeTruthy();
    cleanup();

    renderCounts(0, 0, 1);
    expect(screen.getByText("You have started reviewing it.")).toBeTruthy();
  });

  it("with nothing waiting, the reviewer is caught up", () => {
    renderCounts(0, 0);

    expect(
      screen.getByRole("heading", { name: "You are all caught up" }),
    ).toBeTruthy();
    expect(screen.getByText("Nothing is waiting on you.")).toBeTruthy();
  });
});
