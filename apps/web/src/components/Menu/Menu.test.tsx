// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Button } from "../Button/Button";
import { Menu } from "./Menu";
import { MenuRow } from "./MenuRow/MenuRow";

afterEach(cleanup);

beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: true, addEventListener: vi.fn() })),
  );
});

function renderMenu(rows: readonly string[] = ["One", "Two", "Three"]) {
  const onSelect = vi.fn();
  const view = render(
    <div>
      <Button variant="secondary">Before</Button>
      <Menu label="Account menu" trigger={<span>A</span>}>
        {rows.map((row) => (
          <MenuRow key={row} onSelect={() => onSelect(row)}>
            {row}
          </MenuRow>
        ))}
      </Menu>
    </div>,
  );
  return { ...view, onSelect };
}

async function openMenu() {
  const trigger = screen.getByRole("button", { name: "Account menu" });
  await act(async () => {
    fireEvent.click(trigger);
  });
  return trigger;
}

describe("Menu", () => {
  it("opens on click, names itself, and closes on Escape with focus back", async () => {
    renderMenu();
    const trigger = await openMenu();

    const menu = screen.getByRole("menu", { name: "Account menu" });
    expect(menu).toBeTruthy();
    expect(trigger.getAttribute("aria-expanded")).toBe("true");

    await act(async () => {
      fireEvent.keyDown(menu, { key: "Escape" });
    });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("arrows move through the rows and a click selects", async () => {
    const { onSelect } = renderMenu();
    await openMenu();
    const [one, two] = screen.getAllByRole("menuitem");
    await waitFor(() => expect(document.activeElement).toBe(one));

    await act(async () => {
      fireEvent.keyDown(one!, { key: "ArrowDown" });
    });
    expect(document.activeElement).toBe(two);

    await act(async () => {
      fireEvent.click(two!);
    });
    expect(onSelect).toHaveBeenCalledWith("Two");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("an outside press closes it", async () => {
    renderMenu();
    await openMenu();

    await act(async () => {
      fireEvent.pointerDown(screen.getByRole("button", { name: "Before" }));
      fireEvent.mouseDown(screen.getByRole("button", { name: "Before" }));
    });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("content changing while open keeps the same panel", async () => {
    const { rerender } = renderMenu(["One"]);
    await openMenu();
    const panel = screen.getByRole("menu");

    rerender(
      <div>
        <Button variant="secondary">Before</Button>
        <Menu label="Account menu" trigger={<span>A</span>}>
          <MenuRow onSelect={() => undefined}>One</MenuRow>
          <MenuRow onSelect={() => undefined}>Two</MenuRow>
        </Menu>
      </div>,
    );

    expect(screen.getByRole("menu")).toBe(panel);
    expect(screen.getAllByRole("menuitem")).toHaveLength(2);
  });
});
