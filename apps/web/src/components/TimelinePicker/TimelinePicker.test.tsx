// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetMediaQueries, setMediaQueryMatches } from "@web/test/setup";
import { TimelinePicker } from "./TimelinePicker";

afterEach(() => {
  cleanup();
  resetMediaQueries();
});

beforeEach(() => {
  setMediaQueryMatches("(prefers-reduced-motion: reduce)", true);
});

const OPTIONS = [
  { value: "1", label: "Revision 1 of 3" },
  { value: "2", label: "Revision 2 of 3" },
  { value: "3", label: "Revision 3 of 3" },
];

function renderPicker() {
  const onValueChange = vi.fn<(value: string) => void>();
  const onKeyDown = vi.fn();
  render(
    <TimelinePicker
      label="Select PR revision"
      options={OPTIONS}
      value="2"
      onKeyDown={onKeyDown}
      onValueChange={onValueChange}
    />,
  );
  return { onValueChange, onKeyDown };
}

describe("TimelinePicker", () => {
  it("names itself by its label and the current option", () => {
    renderPicker();

    const trigger = screen.getByRole("button", { name: /Select PR revision/ });
    expect(
      within(trigger).getByText("Revision 2 of 3", { ignore: "[aria-hidden]" }),
    ).toBeTruthy();
    // Every option sizes the trigger, hidden from the accessible name.
    expect(within(trigger).getAllByText(/Revision \d of 3/)).toHaveLength(4);
  });

  it("opens a listbox with the current option ticked and reports a choice", async () => {
    const { onValueChange } = renderPicker();

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /Select PR revision/ }),
      );
    });
    const options = screen.getAllByRole("option");
    expect(
      options.map((option) => option.getAttribute("aria-selected")),
    ).toEqual(["false", "true", "false"]);
    await act(async () => {
      fireEvent.click(options[0]!);
    });

    expect(onValueChange).toHaveBeenCalledWith("1");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("choosing the current option reports nothing", async () => {
    const { onValueChange } = renderPicker();

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /Select PR revision/ }),
      );
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("option", { name: "Revision 2 of 3" }));
    });

    expect(onValueChange).not.toHaveBeenCalled();
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("hands the trigger's key presses to the navigator", () => {
    const { onKeyDown } = renderPicker();

    fireEvent.keyDown(
      screen.getByRole("button", { name: /Select PR revision/ }),
      {
        key: "ArrowRight",
      },
    );

    expect(onKeyDown).toHaveBeenCalledTimes(1);
  });
});
