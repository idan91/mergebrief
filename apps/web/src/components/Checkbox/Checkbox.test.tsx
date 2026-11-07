// @vitest-environment jsdom
// These cases pin the parts a hand-rolled div would lose: the box is drawn,
// but the control underneath is still a real `<input type="checkbox">`.
import { fireEvent, render, screen } from "@testing-library/react";
import {
  createRef,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
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

  it("replays a tick made before hydration as a change", () => {
    const onChange = vi.fn<(checked: boolean) => void>();
    const container = stubPrerenderedCheckbox({ tick: true });

    render(<Checkbox ariaLabel="Row" checked={false} onChange={onChange} />, {
      container,
      hydrate: true,
    });

    expect(onChange).toHaveBeenCalledExactlyOnceWith(true);
    expect(screen.getByRole("checkbox", { name: "Row" })).toHaveProperty(
      "checked",
      false,
    );
  });

  it("stays quiet when nothing changed before hydration", () => {
    const onChange = vi.fn();
    const container = stubPrerenderedCheckbox({ tick: false });

    render(<Checkbox ariaLabel="Row" checked={false} onChange={onChange} />, {
      container,
      hydrate: true,
    });

    expect(onChange).not.toHaveBeenCalled();
  });

  it("keeps a click made after hydration commits, before its effects", async () => {
    const onToggle = vi.fn();
    const container = document.createElement("div");
    container.innerHTML = renderToString(
      <StubTogglingOwner onToggle={onToggle} />,
    );
    document.body.append(container);
    const actEnvironment = Reflect.get(globalThis, "IS_REACT_ACT_ENVIRONMENT");
    Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", false);
    const root = hydrateRoot(
      container,
      <StubTogglingOwner onToggle={onToggle} />,
    );

    try {
      await waitForSchedulerIdle();

      expect(onToggle).toHaveBeenCalledOnce();
      expect(container.querySelector("input")).toHaveProperty("checked", true);
    } finally {
      root.unmount();
      container.remove();
      Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", actEnvironment);
    }
  });

  it("opts out of browser form restore", () => {
    render(<Checkbox ariaLabel="Row" checked={false} onChange={vi.fn()} />);

    expect(screen.getByRole("checkbox").getAttribute("autocomplete")).toBe(
      "off",
    );
  });
});

/** Server markup for an unticked box, ticked by hand when `tick` mimics a click before hydration. */
function stubPrerenderedCheckbox({ tick }: { tick: boolean }): HTMLElement {
  const container = document.createElement("div");
  container.innerHTML = renderToString(
    <Checkbox ariaLabel="Row" checked={false} onChange={() => undefined} />,
  );
  document.body.append(container);
  const input = container.querySelector("input");
  if (input === null) {
    throw new Error("no input");
  }
  input.checked = tick;
  return container;
}

const COMMIT_OVERRUN_MS = 10;
const SCHEDULER_IDLE_MS = 50;

/** An owner that flips on any change, as ChunkCard does. */
function StubTogglingOwner({ onToggle }: { onToggle: () => void }) {
  const [ticked, setTicked] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <>
      <Checkbox
        ariaLabel="Row"
        checked={ticked}
        inputRef={inputRef}
        onChange={() => {
          onToggle();
          setTicked((current) => !current);
        }}
      />
      <StubClickAfterCommit inputRef={inputRef} />
    </>
  );
}

/**
 * Clicks the box once the commit's task ends. The commit overruns the
 * scheduler's frame so it yields before running passive effects, and the
 * click lands in that gap, as a real click can.
 */
function StubClickAfterCommit({
  inputRef,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
}) {
  useLayoutEffect(() => {
    const start = performance.now();
    while (performance.now() - start < COMMIT_OVERRUN_MS) {
      // Busy: the scheduler measures frame time, not work.
    }
    queueMicrotask(() => inputRef.current?.click());
  }, [inputRef]);

  return null;
}

function waitForSchedulerIdle(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, SCHEDULER_IDLE_MS);
  });
}
