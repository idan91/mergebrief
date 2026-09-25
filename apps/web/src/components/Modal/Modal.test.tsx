// @vitest-environment jsdom
import { useRef, useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Button } from "../Button/Button";
import { Modal } from "./Modal";

afterEach(cleanup);

interface HarnessProps {
  namesField?: boolean;
}

function Harness({ namesField = false }: HarnessProps) {
  const [open, setOpen] = useState(false);
  const fieldRef = useRef<HTMLTextAreaElement | null>(null);

  return (
    <>
      <Button onClick={() => setOpen(true)}>Open</Button>
      <Modal
        close={() => setOpen(false)}
        initialFocus={namesField ? fieldRef : undefined}
        labelledBy="harness-heading"
        open={open}
      >
        <h2 id="harness-heading">Harness</h2>
        <textarea aria-label="Reason" ref={fieldRef} />
        <Button onClick={() => setOpen(false)}>Close</Button>
      </Modal>
    </>
  );
}

describe("Modal", () => {
  it("lands focus on the named control when it opens", () => {
    render(<Harness namesField />);

    fireEvent.click(screen.getByRole("button", { name: "Open" }));

    expect(document.activeElement).toBe(
      screen.getByRole("textbox", { name: "Reason" }),
    );
  });

  it("lands focus on the box when no control is named", () => {
    render(<Harness />);

    fireEvent.click(screen.getByRole("button", { name: "Open" }));

    expect(document.activeElement).toBe(screen.getByRole("dialog"));
  });

  it("returns focus to the trigger when the close dropped it", async () => {
    render(<Harness namesField />);
    const trigger = screen.getByRole("button", { name: "Open" });
    trigger.focus();

    fireEvent.click(trigger);
    screen.getByRole("textbox", { name: "Reason" }).blur();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await Promise.resolve();

    expect(document.activeElement).toBe(trigger);
  });

  it("returns focus to the trigger when it is still inside the closed box", async () => {
    render(<Harness namesField />);
    const trigger = screen.getByRole("button", { name: "Open" });
    trigger.focus();

    fireEvent.click(trigger);
    const close = screen.getByRole("button", { name: "Close" });
    close.focus();
    fireEvent.click(close);
    await Promise.resolve();

    expect(document.activeElement).toBe(trigger);
  });
});
