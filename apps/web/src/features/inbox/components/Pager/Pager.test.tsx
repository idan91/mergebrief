// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Pager } from "./Pager";

afterEach(cleanup);

describe("Pager", () => {
  it("renders nothing for one page", () => {
    render(<Pager page={1} pageSize={25} total={25} onPage={vi.fn()} />);

    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it("reads the range live, marks the current page and holds the ends", () => {
    const onPage = vi.fn();
    render(<Pager page={1} pageSize={25} total={290} onPage={onPage} />);

    const range = screen.getByText("1 to 25 of 290");
    expect(range.getAttribute("aria-live")).toBe("polite");
    const current = screen.getByRole("button", { name: "Page 1" });
    expect(current.getAttribute("aria-current")).toBe("page");
    const previous = screen.getByRole("button", { name: "Previous page" });
    expect(previous.getAttribute("aria-disabled")).toBe("true");
    expect(previous.hasAttribute("disabled")).toBe(false);

    fireEvent.click(previous);
    fireEvent.click(screen.getByRole("button", { name: "Page 12" }));
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));

    expect(onPage.mock.calls).toHaveLength(2);
    expect(onPage.mock.calls[0]).toEqual([12]);
    const [step] = onPage.mock.calls[1] ?? [];
    if (typeof step !== "function") throw new Error("Next is not a step");
    expect(step(1)).toBe(2);
    expect(step(3)).toBe(4);
  });

  it("points the step carets back and forward", () => {
    render(<Pager page={2} pageSize={25} total={290} onPage={vi.fn()} />);

    const previous = screen.getByRole("button", { name: "Previous page" });
    const next = screen.getByRole("button", { name: "Next page" });
    const previousCaret = previous.querySelector('[data-icon="caret-down"]');
    const nextCaret = next.querySelector('[data-icon="caret-down"]');

    expect(previousCaret?.getAttribute("data-rotation")).toBe("90");
    expect(nextCaret?.getAttribute("data-rotation")).toBe("270");
  });
});
