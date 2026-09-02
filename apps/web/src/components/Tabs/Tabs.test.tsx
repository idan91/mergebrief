// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Tabs } from "./Tabs";

afterEach(cleanup);

function renderTabs(value: string, onValueChange: (value: string) => void) {
  return render(
    <Tabs value={value} onValueChange={onValueChange}>
      <Tabs.List label="Sections">
        <Tabs.Tab value="a">First</Tabs.Tab>
        <Tabs.Tab value="b">Second</Tabs.Tab>
      </Tabs.List>
      <Tabs.Panel value="a">Panel A</Tabs.Panel>
      <Tabs.Panel value="b">Panel B</Tabs.Panel>
    </Tabs>,
  );
}

describe("Tabs", () => {
  it("wires the tablist, roving tabindex, and each tab to its panel", () => {
    renderTabs("a", () => {});
    const first = screen.getByRole("tab", { name: "First" });
    const second = screen.getByRole("tab", { name: "Second" });
    const panel = screen.getByRole("tabpanel");

    expect(screen.getByRole("tablist", { name: "Sections" })).toBeTruthy();
    expect(first.getAttribute("aria-selected")).toBe("true");
    expect(first.getAttribute("tabindex")).toBe("0");
    expect(second.getAttribute("aria-selected")).toBe("false");
    expect(second.getAttribute("tabindex")).toBe("-1");
    expect(first.getAttribute("aria-controls")).toBe(panel.id);
    expect(panel.getAttribute("aria-labelledby")).toBe(first.id);
    expect(panel.textContent).toBe("Panel A");
    expect(screen.getByText("Panel B").hidden).toBe(true);
  });

  it("selects on click", () => {
    const onValueChange = vi.fn();
    renderTabs("a", onValueChange);

    fireEvent.click(screen.getByRole("tab", { name: "Second" }));

    expect(onValueChange).toHaveBeenCalledWith("b");
  });

  it("moves and selects with the arrow keys, wrapping, plus Home and End", () => {
    const onValueChange = vi.fn();
    renderTabs("a", onValueChange);
    const first = screen.getByRole("tab", { name: "First" });
    const second = screen.getByRole("tab", { name: "Second" });

    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect(onValueChange).toHaveBeenLastCalledWith("b");
    expect(document.activeElement).toBe(second);

    fireEvent.keyDown(first, { key: "ArrowLeft" });
    expect(onValueChange).toHaveBeenLastCalledWith("b");

    fireEvent.keyDown(second, { key: "Home" });
    expect(onValueChange).toHaveBeenLastCalledWith("a");
    expect(document.activeElement).toBe(first);

    fireEvent.keyDown(first, { key: "End" });
    expect(onValueChange).toHaveBeenLastCalledWith("b");
    expect(onValueChange).toHaveBeenCalledTimes(4);
  });

  it("ignores other keys", () => {
    const onValueChange = vi.fn();
    renderTabs("a", onValueChange);

    fireEvent.keyDown(screen.getByRole("tab", { name: "First" }), {
      key: "ArrowDown",
    });

    expect(onValueChange).not.toHaveBeenCalled();
  });

  it("refuses a sub-component outside the root", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => render(<Tabs.Tab value="a">Lone</Tabs.Tab>)).toThrow(
      "Tabs sub-components render inside <Tabs>",
    );

    vi.restoreAllMocks();
  });
});
