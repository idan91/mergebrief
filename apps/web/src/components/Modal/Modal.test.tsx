// @vitest-environment jsdom
import { useRef, useState } from "react";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  compileStylesheet,
  parseCompiledRules,
  readDeclarations,
  SHORT_SCREEN_MEDIA,
} from "@web/test/compiled-css";
import { stubExitTransition } from "@web/test/transitions";
import { Button } from "../Button";
import { Modal } from ".";

interface HarnessProps {
  namesField?: boolean;
  namesOpener?: boolean;
}

function Harness({ namesField = false, namesOpener = false }: HarnessProps) {
  const [open, setOpen] = useState(false);
  const [opener, setOpener] = useState<HTMLElement | undefined>();
  const fieldRef = useRef<HTMLTextAreaElement | null>(null);

  return (
    <>
      <Button
        onClick={(event) => {
          setOpener(namesOpener ? event.currentTarget : undefined);
          setOpen(true);
        }}
      >
        Open
      </Button>
      <Modal
        close={() => setOpen(false)}
        initialFocus={namesField ? fieldRef : undefined}
        labelledBy="harness-heading"
        open={open}
        opener={opener}
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

  it("returns focus to the trigger without scrolling the page", async () => {
    render(<Harness namesField />);
    const trigger = screen.getByRole("button", { name: "Open" });
    trigger.focus();
    const focus = vi.spyOn(trigger, "focus");

    fireEvent.click(trigger);
    screen.getByRole("textbox", { name: "Reason" }).blur();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await Promise.resolve();

    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it("holds the page still while open and releases it on close", () => {
    render(<Harness />);

    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(document.body.style.overflow).toBe("hidden");

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(document.body.style.overflow).toBe("");
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

  it("returns focus to the named opener the click never focused", async () => {
    render(<Harness namesField namesOpener />);
    const trigger = screen.getByRole("button", { name: "Open" });

    fireEvent.click(trigger);
    expect(document.activeElement).not.toBe(trigger);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await Promise.resolve();

    expect(document.activeElement).toBe(trigger);
  });
});

describe("Modal anatomy", () => {
  it("names the dialog from its header and closes from its control", () => {
    let closed = false;
    render(
      <Modal
        close={() => {
          closed = true;
        }}
        labelledBy="anatomy-heading"
        open
      >
        <Modal.Header
          close={() => {
            closed = true;
          }}
          detail="What happens next"
          id="anatomy-heading"
          title="Delete brief"
        />
      </Modal>,
    );

    expect(screen.getByRole("dialog", { name: "Delete brief" })).toBeTruthy();
    expect(screen.getByText("What happens next")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(closed).toBe(true);
  });

  it("hides the close control while a dialog cannot be dismissed", () => {
    render(
      <Modal labelledBy="busy-heading" open>
        <Modal.Header id="busy-heading" title="Posting" />
      </Modal>,
    );

    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
  });

  it("puts the footer's reason directly above the action row", () => {
    render(
      <Modal labelledBy="reason-heading" open>
        <Modal.Header id="reason-heading" title="Submit" />
        <Modal.Footer reason={<p>Too long to post</p>}>
          <Button>Submit</Button>
        </Modal.Footer>
      </Modal>,
    );

    const reason = screen.getByText("Too long to post");
    const action = screen.getByRole("button", { name: "Submit" });
    const actionFollows =
      reason.compareDocumentPosition(action) & Node.DOCUMENT_POSITION_FOLLOWING;
    expect(actionFollows).toBeTruthy();
  });

  it("marks a keyboard surface as opening with no motion", () => {
    render(
      <Modal instant labelledBy="instant-heading" open>
        <Modal.Header id="instant-heading" title="Keys" />
      </Modal>,
    );

    expect(
      screen.getByRole("dialog").parentElement?.getAttribute("data-motion"),
    ).toBe("instant");
  });
});

const EXIT_MS = 120;

interface ExitHarnessProps {
  instant?: boolean;
}

function ExitHarness({ instant = false }: ExitHarnessProps) {
  const [target, setTarget] = useState<string | undefined>("row 12");

  return (
    <Modal
      close={() => setTarget(undefined)}
      instant={instant}
      labelledBy="exit-heading"
      open={target !== undefined}
    >
      <h2 id="exit-heading">Delete {target ?? "nothing"}</h2>
      {target === undefined ? null : <textarea aria-label="Note" />}
      <Button onClick={() => setTarget(undefined)}>Close</Button>
    </Modal>
  );
}

describe("Modal exit", () => {
  let exitStyle: HTMLStyleElement | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    exitStyle = stubExitTransition(EXIT_MS);
  });

  afterEach(() => {
    exitStyle?.remove();
    vi.useRealTimers();
  });

  it("keeps the last open content through the exit fade", () => {
    render(<ExitHarness />);
    const note = screen.getByRole("textbox", { name: "Note" });
    fireEvent.change(note, { target: { value: "seen it" } });

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(screen.getByText("Delete row 12")).toBeTruthy();
    expect(screen.getByDisplayValue("seen it")).toBe(note);
  });

  it("shows the closed content once the exit fade ends", () => {
    render(<ExitHarness />);

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    act(() => {
      vi.advanceTimersByTime(EXIT_MS);
    });

    expect(screen.getByText("Delete nothing")).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: "Note" })).toBeNull();
  });

  it("holds nothing for a dialog with no exit", () => {
    render(<ExitHarness instant />);

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(screen.getByText("Delete nothing")).toBeTruthy();
  });
});

const TEST_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const MODAL_STYLESHEET = join(TEST_DIRECTORY, "Modal.module.scss");
const MODAL_RULES = parseCompiledRules(compileStylesheet(MODAL_STYLESHEET));
const LIST_BOX = ".box:has(> .unresolvedList)";
const LIST = ".unresolvedList";
const LONG_LIST = ".unresolvedList:has(> :nth-child(2))";

describe("Modal list dialogs", () => {
  it("scrolls only the list between a fixed header and footer", () => {
    const box = readDeclarations(MODAL_RULES, LIST_BOX);
    const list = readDeclarations(MODAL_RULES, LIST);
    const longList = readDeclarations(MODAL_RULES, LONG_LIST);

    expect(box.get("display")).toBe("flex");
    expect(box.get("flex-direction")).toBe("column");
    expect(list.get("flex")).toBe("0 1 auto");
    expect(list.get("overflow-y")).toBe("auto");
    expect(list.get("overscroll-behavior")).toBe("contain");
    expect(longList.get("min-block-size")).toBe("7.5rem");
  });

  it("keeps a focused row's ring inside the list's scrollport", () => {
    const list = readDeclarations(MODAL_RULES, LIST);
    const ringRoom = "var(--ring-room)";

    expect(list.get("--ring-room")).toBe("0.3125rem");
    expect(list.get("padding")).toBe(ringRoom);
    expect(list.get("margin-block-start")).toBe(`calc(-1 * ${ringRoom})`);
    expect(list.get("margin-inline")).toBe(`calc(-1 * ${ringRoom})`);
    expect(list.get("scroll-padding-block")).toBe(ringRoom);
  });

  it("hands a drag past the list's end to the box on short screens", () => {
    const box = readDeclarations(MODAL_RULES, LIST_BOX, SHORT_SCREEN_MEDIA);
    const list = readDeclarations(MODAL_RULES, LIST, SHORT_SCREEN_MEDIA);

    expect(list.get("overscroll-behavior")).toBe("auto");
    expect(box.get("overscroll-behavior")).toBe("contain");
  });
});
