// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { PersonalLine } from "./PersonalLine";

afterEach(cleanup);

function renderCounts(updated: number, fresh: number) {
  render(
    <PersonalLine
      counts={{ new: fresh, inProgress: 0, reviewed: 0, updated }}
    />,
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

  it("leads with what changed since the review, then what is new", () => {
    renderCounts(2, 1);

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "2 pull requests changed since you reviewed them",
      }),
    ).toBeTruthy();
    expect(screen.getByText("1 more is new to you.")).toBeTruthy();
  });

  it("one changed row reads in the singular with nothing else new", () => {
    renderCounts(1, 0);

    expect(
      screen.getByRole("heading", {
        name: "1 pull request changed since you reviewed it",
      }),
    ).toBeTruthy();
    expect(screen.getByText("Nothing else is new.")).toBeTruthy();
  });

  it("with nothing changed, the new rows lead", () => {
    renderCounts(0, 3);

    expect(
      screen.getByRole("heading", { name: "3 pull requests are new to you" }),
    ).toBeTruthy();
    expect(
      screen.getByText("Nothing changed since your last review."),
    ).toBeTruthy();
  });

  it("with nothing new either, the reviewer is caught up", () => {
    renderCounts(0, 0);

    expect(
      screen.getByRole("heading", { name: "You are all caught up" }),
    ).toBeTruthy();
  });
});
