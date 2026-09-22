// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { InboxEmptinesses } from "../../types";
import { EmptyInbox } from "./EmptyInbox";

afterEach(cleanup);

describe("EmptyInbox", () => {
  it("filtered to nothing explains the default status and clears", () => {
    const onClear = vi.fn();
    render(
      <EmptyInbox
        defaultStatus
        reason={InboxEmptinesses.FILTERED}
        onClear={onClear}
        onShowHidden={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("heading", {
        name: "No pull requests match these filters",
      }),
    ).toBeTruthy();
    expect(screen.getByText(/hidden by default/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("nothing open and no filter set offers the hidden rows, not Clear", () => {
    const onShowHidden = vi.fn();
    render(
      <EmptyInbox
        defaultStatus
        reason={InboxEmptinesses.HIDDEN_BY_DEFAULT}
        onClear={vi.fn()}
        onShowHidden={onShowHidden}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "No open pull requests" }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Clear filters" })).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Show merged and closed" }),
    );
    expect(onShowHidden).toHaveBeenCalledTimes(1);
  });

  it("leaves the default-status line out once Status is changed", () => {
    render(
      <EmptyInbox
        defaultStatus={false}
        reason={InboxEmptinesses.FILTERED}
        onClear={vi.fn()}
        onShowHidden={vi.fn()}
      />,
    );

    expect(screen.queryByText(/hidden by default/)).toBeNull();
  });
});
