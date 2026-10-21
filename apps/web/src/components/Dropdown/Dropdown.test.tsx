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

import { resetMediaQueries, setMediaQueryMatches } from "@web/test/setup";
import { Button } from "../Button";
import { Dropdown } from ".";

afterEach(() => {
  cleanup();
  resetMediaQueries();
});

beforeEach(() => {
  setMediaQueryMatches("(prefers-reduced-motion: reduce)", true);
});

const OPTIONS = [
  { value: "apple", label: "Apple" },
  { value: "banana", label: "Banana" },
  { value: "cherry", label: "Cherry" },
] as const;

function renderSingle(value: string | undefined = "banana") {
  const onValueChange = vi.fn<(value: string) => void>();
  render(
    <Dropdown value={value} onValueChange={onValueChange}>
      <Dropdown.Trigger>
        <Button variant="secondary">Fruit</Button>
      </Dropdown.Trigger>
      <Dropdown.Content label="Fruit">
        {OPTIONS.map((option) => (
          <Dropdown.Item key={option.value} value={option.value}>
            {option.label}
          </Dropdown.Item>
        ))}
      </Dropdown.Content>
    </Dropdown>,
  );
  return { onValueChange };
}

function renderMultiple(value: readonly string[] = ["banana"]) {
  const onValueChange = vi.fn<(values: string[]) => void>();
  const view = render(buildMultiple(value, onValueChange));
  return { onValueChange, rerender: view.rerender };
}

function buildMultiple(
  value: readonly string[],
  onValueChange: (values: string[]) => void,
) {
  return (
    <Dropdown multiple value={value} onValueChange={onValueChange}>
      <Dropdown.Trigger>
        <Button variant="secondary">Fruit</Button>
      </Dropdown.Trigger>
      <Dropdown.Content label="Fruit">
        <Dropdown.Group label="Fresh">
          <Dropdown.Item value="apple">Apple</Dropdown.Item>
          <Dropdown.Item disabled value="banana">
            Banana
          </Dropdown.Item>
        </Dropdown.Group>
        <Dropdown.Separator />
        <Dropdown.Item value="cherry">Cherry</Dropdown.Item>
      </Dropdown.Content>
    </Dropdown>
  );
}

async function openList(): Promise<HTMLElement> {
  const trigger = screen.getByRole("button", { name: "Fruit" });
  await act(async () => {
    fireEvent.click(trigger);
  });
  return trigger;
}

async function press(key: string): Promise<void> {
  const target = document.activeElement ?? document.body;
  await act(async () => {
    fireEvent.keyDown(target, { key });
  });
}

describe("Dropdown", () => {
  it("the trigger announces a listbox and the list carries its name", async () => {
    renderSingle();
    const trigger = await openList();

    expect(trigger.getAttribute("aria-haspopup")).toBe("listbox");
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    const list = screen.getByRole("listbox", { name: "Fruit" });
    expect(list.getAttribute("aria-multiselectable")).toBeNull();
  });

  it("a single list ticks the value, focuses it, and closes on a choice", async () => {
    const { onValueChange } = renderSingle();
    const trigger = await openList();

    const options = screen.getAllByRole("option");
    expect(
      options.map((option) => option.getAttribute("aria-selected")),
    ).toEqual(["false", "true", "false"]);
    await waitFor(() => expect(document.activeElement).toBe(options[1]));

    await act(async () => {
      fireEvent.click(options[2]!);
    });
    expect(onValueChange).toHaveBeenCalledWith("cherry");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("a multiple list toggles values and stays open", async () => {
    const { onValueChange } = renderMultiple();
    await openList();

    const list = screen.getByRole("listbox", { name: "Fruit" });
    expect(list.getAttribute("aria-multiselectable")).toBe("true");
    await act(async () => {
      fireEvent.click(screen.getByRole("option", { name: "Cherry" }));
    });
    expect(onValueChange).toHaveBeenCalledWith(["banana", "cherry"]);
    expect(screen.getByRole("listbox")).toBeTruthy();

    cleanup();
    const second = renderMultiple(["banana", "cherry"]);
    await openList();
    await act(async () => {
      fireEvent.click(screen.getByRole("option", { name: "Cherry" }));
    });
    expect(second.onValueChange).toHaveBeenCalledWith(["banana"]);
  });

  it("reopening after unticking the lowest row lands on the next ticked one", async () => {
    const { rerender } = renderMultiple(["cherry", "apple"]);
    const trigger = await openList();
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("option", { name: "Apple" }),
      ),
    );

    rerender(buildMultiple(["cherry"], vi.fn()));
    await act(async () => {
      fireEvent.keyDown(document.activeElement ?? trigger, { key: "Escape" });
    });
    await act(async () => {
      fireEvent.click(trigger);
    });

    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("option", { name: "Cherry" }),
      ),
    );
  });

  it("with nothing ticked a disabled first row is skipped on open", async () => {
    render(
      <Dropdown multiple value={[]} onValueChange={vi.fn()}>
        <Dropdown.Trigger>
          <Button variant="secondary">Fruit</Button>
        </Dropdown.Trigger>
        <Dropdown.Content label="Fruit">
          <Dropdown.Item disabled value="apple">
            Apple
          </Dropdown.Item>
          <Dropdown.Item value="banana">Banana</Dropdown.Item>
        </Dropdown.Content>
      </Dropdown>,
    );
    await openList();

    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("option", { name: "Banana" }),
      ),
    );
  });

  it("a disabled row is inert and the arrows skip it", async () => {
    const { onValueChange } = renderMultiple([]);
    await openList();
    const apple = screen.getByRole("option", { name: "Apple" });
    await waitFor(() => expect(document.activeElement).toBe(apple));

    const banana = screen.getByRole("option", { name: "Banana" });
    expect(banana.getAttribute("aria-disabled")).toBe("true");
    await act(async () => {
      fireEvent.click(banana);
    });
    expect(onValueChange).not.toHaveBeenCalled();
    await press("ArrowDown");
    expect(document.activeElement).toBe(
      screen.getByRole("option", { name: "Cherry" }),
    );
  });

  it("arrows wrap, Home and End jump, and typing jumps to a label", async () => {
    renderSingle("apple");
    await openList();
    const [apple, banana, cherry] = screen.getAllByRole("option");
    await waitFor(() => expect(document.activeElement).toBe(apple));

    await press("ArrowUp");
    expect(document.activeElement).toBe(cherry);
    await press("ArrowDown");
    expect(document.activeElement).toBe(apple);
    await press("End");
    expect(document.activeElement).toBe(cherry);
    await press("Home");
    expect(document.activeElement).toBe(apple);
    await press("b");
    expect(document.activeElement).toBe(banana);
  });
});
