// @vitest-environment jsdom
// These cases pin the parts a hand-rolled div would lose: the box is drawn,
// but the control underneath is still a real `<input type="checkbox">`.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Checkbox } from "./Checkbox";

afterEach(cleanup);

describe("Checkbox", () => {
  it("is a real checkbox with the label as its accessible name", () => {
    render(
      <Checkbox checked={false} onChange={vi.fn()}>
        Only each reviewer&apos;s latest
      </Checkbox>,
    );
    const box = screen.getByRole("checkbox", {
      name: /only each reviewer's latest/i,
    });
    if (!(box instanceof HTMLInputElement)) throw new Error("not an input");
    expect(box.type).toBe("checkbox");
    expect(box.checked).toBe(false);
  });

  it("reports the next checked state, not the event", () => {
    const onChange = vi.fn<(checked: boolean) => void>();
    render(
      <Checkbox checked={false} onChange={onChange}>
        Label
      </Checkbox>,
    );
    fireEvent.click(screen.getByRole("checkbox"));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("stays focusable — the input is visually replaced, not hidden", () => {
    render(
      <Checkbox checked onChange={vi.fn()}>
        Label
      </Checkbox>,
    );
    const box = screen.getByRole("checkbox");
    box.focus();
    expect(document.activeElement).toBe(box);
  });

  it("disables the underlying control, not just its look", () => {
    render(
      <Checkbox checked={false} disabled onChange={vi.fn()}>
        Label
      </Checkbox>,
    );
    // The native `disabled` attribute IS the guard — a browser blocks the
    // event before React sees it. (jsdom's fireEvent dispatches anyway, so
    // asserting on the handler here would test the test harness.)
    const box = screen.getByRole("checkbox");
    expect(box.hasAttribute("disabled")).toBe(true);
    expect(box.closest("label")?.getAttribute("data-disabled")).toBe("true");
  });
});
