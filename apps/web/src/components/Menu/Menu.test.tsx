// @vitest-environment jsdom
import { useListItem } from "@floating-ui/react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetMediaQueries, setMediaQueryMatches } from "@web/test/setup";
import { Button } from "../Button";
import { Menu } from ".";

afterEach(() => {
  cleanup();
  resetMediaQueries();
});

beforeEach(() => {
  setMediaQueryMatches("(prefers-reduced-motion: reduce)", true);
});

function renderMenu(checkedLocale = "en") {
  const onSelect = vi.fn<(name: string) => void>();
  const view = render(buildMenu(checkedLocale, onSelect));
  return { onSelect, view };
}

function buildMenu(
  checkedLocale: string,
  onSelect: (name: string) => void,
  settingsLabel = "Settings",
) {
  return (
    <div>
      <Button variant="secondary">Before</Button>
      <Menu>
        <Menu.Trigger>
          <Button variant="secondary">Account menu</Button>
        </Menu.Trigger>
        <Menu.Content>
          <Menu.Label>Signed in as octocat</Menu.Label>
          <Menu.Item onSelect={() => onSelect("Settings")}>
            {settingsLabel}
          </Menu.Item>
          <Menu.Group label="Language">
            <Menu.Item
              checked={checkedLocale === "en"}
              onSelect={() => onSelect("English")}
            >
              English
            </Menu.Item>
            <Menu.Item
              checked={checkedLocale === "fr"}
              onSelect={() => onSelect("French")}
            >
              French
            </Menu.Item>
          </Menu.Group>
          <Menu.Separator />
          <Menu.Item disabled onSelect={() => onSelect("Disabled")}>
            Disabled
          </Menu.Item>
          <Menu.Item danger onSelect={() => onSelect("Delete")}>
            Delete
          </Menu.Item>
        </Menu.Content>
      </Menu>
    </div>
  );
}

async function openMenu(): Promise<HTMLElement> {
  const trigger = screen.getByRole("button", { name: "Account menu" });
  await act(async () => {
    fireEvent.click(trigger);
  });
  return trigger;
}

/** A row no primitive renders yet: registered with the list, natively disabled. */
function NativeDisabledRow({ label }: { label: string }) {
  const { ref } = useListItem({ label });
  return (
    <button disabled ref={ref} role="menuitem" type="button">
      {label}
    </button>
  );
}

async function press(key: string): Promise<void> {
  await act(async () => {
    fireEvent.keyDown(document.activeElement ?? document.body, { key });
  });
}

describe("Menu", () => {
  it("the trigger names the menu and a row fires then closes it", async () => {
    const { onSelect } = renderMenu();
    const trigger = await openMenu();

    expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
    expect(screen.getByRole("menu", { name: "Account menu" })).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: "Settings" }));
    });

    expect(onSelect).toHaveBeenCalledWith("Settings");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("a checked row is a radio that keeps the menu open on select", async () => {
    const { onSelect, view } = renderMenu("fr");
    await openMenu();
    const panel = screen.getByRole("menu");

    const radios = screen.getAllByRole("menuitemradio");
    expect(radios.map((row) => row.getAttribute("aria-checked"))).toEqual([
      "false",
      "true",
    ]);
    await act(async () => {
      fireEvent.click(radios[0]!);
    });
    expect(onSelect).toHaveBeenCalledWith("English");

    view.rerender(buildMenu("en", onSelect));

    expect(screen.getByRole("menu")).toBe(panel);
    expect(
      screen
        .getByRole("menuitemradio", { name: "English" })
        .getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("a toggling row is a checkbox that keeps the menu open", async () => {
    const onToggle = vi.fn<() => void>();
    render(
      <Menu>
        <Menu.Trigger>
          <Button variant="secondary">Account menu</Button>
        </Menu.Trigger>
        <Menu.Content>
          <Menu.Item checked={false} toggles onSelect={onToggle}>
            Generate on every push
          </Menu.Item>
        </Menu.Content>
      </Menu>,
    );
    await openMenu();

    const row = screen.getByRole("menuitemcheckbox", {
      name: "Generate on every push",
    });
    expect(row.getAttribute("aria-checked")).toBe("false");
    await act(async () => {
      fireEvent.click(row);
    });

    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("menu")).toBeTruthy();
  });

  it("the menu opens on its first row whatever is checked", async () => {
    renderMenu("fr");
    await openMenu();

    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("menuitem", { name: "Settings" }),
      ),
    );
  });

  it("a disabled row is inert and a danger row wears the variant", async () => {
    const { onSelect } = renderMenu();
    await openMenu();

    const disabled = screen.getByRole("menuitem", { name: "Disabled" });
    await act(async () => {
      fireEvent.click(disabled);
    });
    expect(onSelect).not.toHaveBeenCalled();
    expect(
      screen
        .getByRole("menuitem", { name: "Delete" })
        .getAttribute("data-variant"),
    ).toBe("danger");
  });

  it("an unavailable row refuses the select and describes why", async () => {
    const onSelect = vi.fn();
    render(
      <Menu>
        <Menu.Trigger>
          <Button variant="secondary">Account menu</Button>
        </Menu.Trigger>
        <Menu.Content>
          <Menu.Item unavailableReason="Wait for the read" onSelect={onSelect}>
            Delete
          </Menu.Item>
        </Menu.Content>
      </Menu>,
    );
    await openMenu();

    const row = screen.getByRole("menuitem", { name: "Delete" });
    await act(async () => {
      fireEvent.click(row);
    });

    expect(onSelect).not.toHaveBeenCalled();
    expect(row.getAttribute("aria-disabled")).toBe("true");
    const reasonId = row.getAttribute("aria-describedby") ?? "";
    expect(document.getElementById(reasonId)?.textContent).toBe(
      "Wait for the read",
    );
  });

  it("an unavailable row shows its reason inside the row it describes", async () => {
    render(
      <Menu>
        <Menu.Trigger>
          <Button variant="secondary">Account menu</Button>
        </Menu.Trigger>
        <Menu.Content>
          <Menu.Item unavailableReason="Wait for the read" onSelect={vi.fn()}>
            Delete
          </Menu.Item>
        </Menu.Content>
      </Menu>,
    );
    await openMenu();

    const row = screen.getByRole("menuitem", {
      name: "Delete",
      description: "Wait for the read",
    });
    const reason = screen.getByText("Wait for the read");

    expect(row.contains(reason)).toBe(true);
    expect(reason.closest("[hidden]")).toBeNull();
  });

  it("arrow keys reach an unavailable row so its reason is heard", async () => {
    render(
      <Menu>
        <Menu.Trigger>
          <Button variant="secondary">Account menu</Button>
        </Menu.Trigger>
        <Menu.Content>
          <Menu.Item onSelect={vi.fn()}>Copy link</Menu.Item>
          <Menu.Item disabled onSelect={vi.fn()}>
            Archive
          </Menu.Item>
          <Menu.Item unavailableReason="Wait for the read" onSelect={vi.fn()}>
            Delete
          </Menu.Item>
        </Menu.Content>
      </Menu>,
    );
    await openMenu();
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("menuitem", { name: "Copy link" }),
      ),
    );

    await press("ArrowDown");

    expect(document.activeElement).toBe(
      screen.getByRole("menuitem", { name: "Delete" }),
    );
  });

  it("opens on a refused first row that states why, the row Home reaches", async () => {
    render(
      <Menu>
        <Menu.Trigger>
          <Button variant="secondary">Account menu</Button>
        </Menu.Trigger>
        <Menu.Content>
          <Menu.Item unavailableReason="Wait for the read" onSelect={vi.fn()}>
            Delete
          </Menu.Item>
          <Menu.Item onSelect={vi.fn()}>Copy link</Menu.Item>
        </Menu.Content>
      </Menu>,
    );
    await openMenu();
    const refused = screen.getByRole("menuitem", { name: "Delete" });
    await waitFor(() => expect(document.activeElement).toBe(refused));

    await press("End");
    await press("Home");

    expect(document.activeElement).toBe(refused);
  });

  it("arrow keys skip a natively disabled row", async () => {
    render(
      <Menu>
        <Menu.Trigger>
          <Button variant="secondary">Account menu</Button>
        </Menu.Trigger>
        <Menu.Content>
          <Menu.Item onSelect={vi.fn()}>Copy link</Menu.Item>
          <NativeDisabledRow label="Archive" />
          <Menu.Item onSelect={vi.fn()}>Delete</Menu.Item>
        </Menu.Content>
      </Menu>,
    );
    await openMenu();
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("menuitem", { name: "Copy link" }),
      ),
    );

    await press("ArrowDown");

    expect(document.activeElement).toBe(
      screen.getByRole("menuitem", { name: "Delete" }),
    );
  });

  it("typing jumps to a row and Escape returns focus to the trigger", async () => {
    renderMenu();
    const trigger = await openMenu();
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("menuitem", { name: "Settings" }),
      ),
    );

    await press("f");
    expect(document.activeElement).toBe(
      screen.getByRole("menuitemradio", { name: "French" }),
    );
    await press("Escape");

    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("Escape on the panel or the trigger never reaches window", async () => {
    renderMenu();
    const onWindowKeyDown = vi.fn();
    window.addEventListener("keydown", onWindowKeyDown);
    const trigger = await openMenu();

    await act(async () => {
      fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    await openMenu();
    await act(async () => {
      fireEvent.keyDown(trigger, { key: "Escape" });
    });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());

    expect(onWindowKeyDown).not.toHaveBeenCalled();
    window.removeEventListener("keydown", onWindowKeyDown);
  });

  it("typeahead follows a relabel while the menu stays open", async () => {
    const { onSelect, view } = renderMenu("en");
    await openMenu();
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("menuitem", { name: "Settings" }),
      ),
    );

    view.rerender(buildMenu("en", onSelect, "Paramètres"));
    await press("End");
    await press("p");

    expect(document.activeElement).toBe(
      screen.getByRole("menuitem", { name: "Paramètres" }),
    );
  });

  it("a label and a group name their rows without joining the list", async () => {
    renderMenu();
    await openMenu();

    expect(screen.getByText("Signed in as octocat")).toBeTruthy();
    expect(screen.getByRole("group", { name: "Language" })).toBeTruthy();
    expect(screen.getAllByRole("menuitem")).toHaveLength(3);
  });
});
