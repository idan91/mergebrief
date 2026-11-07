// @vitest-environment jsdom
// These cases pin the parts a hand-rolled div would lose: the box is drawn,
// but the control underneath is still a real `<input type="checkbox">`.
import { fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";

import { Checkbox } from ".";

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
    if (!(box instanceof HTMLInputElement)) {
      throw new Error("not an input");
    }
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

  it("marks a partial selection indeterminate on the control", () => {
    render(
      <Checkbox indeterminate checked={false} onChange={vi.fn()}>
        Some
      </Checkbox>,
    );
    const input = screen.getByRole("checkbox", { name: "Some" });
    expect(input).toBeInstanceOf(HTMLInputElement);
    if (!(input instanceof HTMLInputElement)) {
      throw new Error("no input");
    }
    expect(input.indeterminate).toBe(true);
    expect(input.getAttribute("aria-checked")).toBe("mixed");
  });

  it("disables the underlying control, not just its look", () => {
    render(
      <Checkbox checked={false} disabled onChange={vi.fn()}>
        Label
      </Checkbox>,
    );
    // The native `disabled` attribute IS the guard: a browser blocks the
    // event before React sees it. (jsdom's fireEvent dispatches anyway, so
    // asserting on the handler here would test the test harness.)
    const box = screen.getByRole("checkbox");
    expect(box.hasAttribute("disabled")).toBe(true);
    expect(box.closest("label")?.getAttribute("data-disabled")).toBe("true");
  });

  it("hands the native input to a caller's ref", () => {
    const inputRef = createRef<HTMLInputElement>();
    render(
      <Checkbox checked={false} inputRef={inputRef} onChange={vi.fn()}>
        Label
      </Checkbox>,
    );
    expect(inputRef.current).toBe(screen.getByRole("checkbox"));
  });

  it("names a control with no visible label from its aria label", () => {
    const onChange = vi.fn();
    render(
      <Checkbox
        ariaLabel="Select app.ts"
        checked={false}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole("checkbox", { name: "Select app.ts" }));

    expect(onChange).toHaveBeenCalledWith(true);
  });
});
