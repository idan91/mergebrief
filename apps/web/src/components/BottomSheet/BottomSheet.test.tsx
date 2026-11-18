// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Button } from "../Button";
import { BottomSheet } from "./index";
import { BottomSheetHeights } from "./types";

function renderSheet(close = vi.fn()) {
  render(
    <BottomSheet
      close={close}
      closeLabel="Close"
      initialFocusSelector="[data-first]"
      label="Filters"
    >
      <Button data-first>First</Button>
    </BottomSheet>,
  );
  return close;
}

describe("BottomSheet", () => {
  afterEach(cleanup);

  it("is a labelled modal dialog with focus on the requested control", () => {
    renderSheet();

    const dialog = screen.getByRole("dialog", { name: "Filters" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "First" }),
    );
  });

  it("closes from Escape and from the scrim", () => {
    const close = renderSheet();

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(close).toHaveBeenCalledTimes(2);
  });

  it("opens at half height and the handle toggles it", () => {
    renderSheet();
    const dialog = screen.getByRole("dialog");
    expect(dialog.dataset["height"]).toBe(BottomSheetHeights.HALF);

    fireEvent.click(screen.getByRole("button", { name: /full height/i }));

    expect(dialog.dataset["height"]).toBe(BottomSheetHeights.FULL);
  });
});
