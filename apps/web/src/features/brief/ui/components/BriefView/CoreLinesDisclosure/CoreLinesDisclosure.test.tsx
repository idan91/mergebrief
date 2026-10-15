// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CoreLinesDisclosure } from ".";

function renderDisclosure() {
  return render(
    <CoreLinesDisclosure
      allAdded={412}
      allDeleted={96}
      coreAdded={318}
      coreDeleted={54}
    >
      core lines
    </CoreLinesDisclosure>,
  );
}

describe("CoreLinesDisclosure", () => {
  it("renders a closed focusable trigger named by its visible content", () => {
    renderDisclosure();
    const trigger = screen.getByRole("button", { name: "core lines" });
    expect(trigger.dataset["state"]).toBe("closed");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("opens on click with both scopes and the derivation caveat", () => {
    renderDisclosure();
    const trigger = screen.getByRole("button", { name: "core lines" });
    fireEvent.click(trigger);
    expect(trigger.dataset["state"]).toBe("open");
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("all lines")).toBeTruthy();
    expect(screen.getByText("+318")).toBeTruthy();
    expect(screen.getByText("−54")).toBeTruthy();
    expect(screen.getByText("+412")).toBeTruthy();
    expect(screen.getByText("−96")).toBeTruthy();
    expect(screen.getByText(/derived from the diff/)).toBeTruthy();
    // The panel describes the trigger while open.
    const panelId = trigger.getAttribute("aria-describedby");
    expect(panelId).toBeTruthy();
  });

  it("a second activation collapses again", () => {
    renderDisclosure();
    const trigger = screen.getByRole("button", { name: "core lines" });
    fireEvent.click(trigger);
    fireEvent.click(trigger);
    expect(trigger.dataset["state"]).toBe("closed");
    expect(screen.queryByText(/derived from the diff/)).toBeNull();
  });

  it("Escape dismisses and the key never reaches page-level handlers", () => {
    renderDisclosure();
    const trigger = screen.getByRole("button", { name: "core lines" });
    fireEvent.click(trigger);
    let leaked = false;
    const pageListener = () => {
      leaked = true;
    };
    window.addEventListener("keydown", pageListener);
    fireEvent.keyDown(document.body, { key: "Escape" });
    window.removeEventListener("keydown", pageListener);
    expect(trigger.dataset["state"]).toBe("closed");
    expect(leaked).toBe(false);
  });
});
