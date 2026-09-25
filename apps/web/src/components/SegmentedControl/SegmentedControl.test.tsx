// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SegmentedControl, type SegmentedOption } from ".";

afterEach(cleanup);

const OPTIONS: SegmentedOption<"full" | "changes">[] = [
  { value: "full", label: "Full brief" },
  { value: "changes", label: "Changes Only" },
];

function renderControl(
  options: SegmentedOption<"full" | "changes">[] = OPTIONS,
  value: "full" | "changes" = "full",
) {
  const onChange = vi.fn();
  render(
    <SegmentedControl
      legend="View"
      name="test-view"
      onChange={onChange}
      options={options}
      value={value}
    />,
  );
  return { onChange };
}

describe("SegmentedControl", () => {
  it("is a named group of radios, one of them selected", () => {
    renderControl();
    expect(screen.getByRole("group", { name: "View" })).toBeTruthy();
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(2);
    expect((radios[0] as HTMLInputElement).checked).toBe(true);
    expect((radios[1] as HTMLInputElement).checked).toBe(false);
  });

  it("reports the chosen value once", () => {
    const { onChange } = renderControl();
    fireEvent.click(screen.getByRole("radio", { name: "Changes Only" }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("changes");
  });

  it("refuses an unavailable option and leaves the selection alone", () => {
    // The guard is the ONLY thing stopping selection now.
    const { onChange } = renderControl([
      OPTIONS[0]!,
      {
        value: "changes",
        label: "Changes Only",
        unavailableReason: "Needs a baseline",
      },
    ]);
    const unavailable = screen.getByRole("radio", { name: "Changes Only" });
    fireEvent.click(unavailable);
    expect(onChange).not.toHaveBeenCalled();
    expect(
      (screen.getByRole("radio", { name: "Full brief" }) as HTMLInputElement)
        .checked,
    ).toBe(true);
  });

  it("keeps an unavailable option focusable and describes it by its reason", () => {
    renderControl([
      OPTIONS[0]!,
      {
        value: "changes",
        label: "Changes Only",
        unavailableReason: "Needs a baseline",
      },
    ]);
    const unavailable = screen.getByRole("radio", { name: "Changes Only" });
    expect(unavailable.getAttribute("aria-disabled")).toBe("true");
    expect((unavailable as HTMLInputElement).disabled).toBe(false);
    const reason = document.getElementById(
      unavailable.getAttribute("aria-describedby") ?? "",
    );
    expect(reason?.textContent).toBe("Needs a baseline");
  });

  it("dismisses the reason with Escape and re-arms it on blur", () => {
    renderControl([
      OPTIONS[0]!,
      {
        value: "changes",
        label: "Changes Only",
        unavailableReason: "Needs a baseline",
      },
    ]);
    const unavailable = screen.getByRole("radio", { name: "Changes Only" });
    const wrapper = unavailable.parentElement;
    fireEvent.keyDown(unavailable, { key: "Escape" });
    expect(wrapper?.getAttribute("data-tip-dismissed")).toBe("true");
    fireEvent.blur(unavailable);
    expect(wrapper?.getAttribute("data-tip-dismissed")).toBeNull();
  });
});
