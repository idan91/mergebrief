// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../../../../../../i18n/I18nProvider";
import { NewerCommitsChip } from ".";
import {
  NewerCommitsActionKinds,
  NewerCommitsStates,
  type NewerCommitsAction,
  type NewerCommitsStatus,
} from "./types";

afterEach(cleanup);

const RETRY: NewerCommitsAction = {
  kind: NewerCommitsActionKinds.RETRY,
  label: "Retry",
  pending: false,
  onTrigger: () => undefined,
};

const FAILED: NewerCommitsStatus = {
  state: NewerCommitsStates.FAILED,
  label: "Newer commits",
  infoLabel: "About newer commits",
  statusLabel: "New brief failed",
  title: "New brief failed",
  explanation: ["The lead.", "The model provider timed out."],
  action: RETRY,
};

function stubStatus(overrides: Partial<NewerCommitsStatus> = {}) {
  return { ...FAILED, ...overrides };
}

function makeChip(status: NewerCommitsStatus) {
  return (
    <I18nProvider>
      <NewerCommitsChip status={status} />
    </I18nProvider>
  );
}

function openPanel(): HTMLElement {
  fireEvent.click(screen.getByRole("button", { name: "About newer commits" }));
  return screen.getByTestId("newer-commits-panel");
}

describe("NewerCommitsChip", () => {
  it("names the group by its label and status", () => {
    const status = stubStatus();
    render(makeChip(status));

    const group = screen.getByRole("group", {
      name: "Newer commits New brief failed",
    });
    expect(within(group).getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("runs the attached action on click", () => {
    const onTrigger = vi.fn();
    const status = stubStatus({ action: { ...RETRY, onTrigger } });
    render(makeChip(status));

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(onTrigger).toHaveBeenCalledTimes(1);
  });

  it("holds the action busy while its request is in flight", () => {
    const onTrigger = vi.fn();
    const pending = { ...RETRY, label: "Retrying…", pending: true, onTrigger };
    const status = stubStatus({ action: pending });
    render(makeChip(status));
    const button = screen.getByRole("button", { name: "Retrying…" });

    fireEvent.click(button);

    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(onTrigger).not.toHaveBeenCalled();
  });

  it("shows the status alone when there is nothing to do", () => {
    const { action: _omitted, ...statusOnly } = stubStatus();
    render(makeChip(statusOnly));

    expect(screen.getByText("New brief failed")).toBeTruthy();
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("trails the arrow after Go to new brief and leads other glyphs", () => {
    const navigate: NewerCommitsAction = {
      ...RETRY,
      kind: NewerCommitsActionKinds.NAVIGATE,
      label: "Go to new brief",
    };
    const status = stubStatus({ action: navigate });
    const view = render(makeChip(status));
    const goButton = screen.getByRole("button", { name: "Go to new brief" });
    expect(goButton.lastElementChild?.tagName.toLowerCase()).toBe("svg");

    const nextStatus = stubStatus();
    view.rerender(makeChip(nextStatus));

    const retryButton = screen.getByRole("button", { name: "Retry" });
    expect(retryButton.firstElementChild?.tagName.toLowerCase()).toBe("svg");
  });

  it("spins only while the new brief generates", () => {
    const status = stubStatus();
    const view = render(makeChip(status));
    const chip = screen.getByTestId("newer-commits-chip");
    expect(within(chip).queryByTestId("newer-commits-spinner")).toBeNull();

    const nextStatus = stubStatus({ state: NewerCommitsStates.GENERATING });
    view.rerender(makeChip(nextStatus));

    expect(within(chip).queryByTestId("newer-commits-spinner")).not.toBeNull();
  });

  it("opens the full explanation and the same action from the info button", () => {
    const onTrigger = vi.fn();
    const status = stubStatus({ action: { ...RETRY, onTrigger } });
    render(makeChip(status));
    const info = screen.getByRole("button", { name: "About newer commits" });
    expect(info.getAttribute("aria-expanded")).toBe("false");

    const panel = openPanel();

    expect(info.getAttribute("aria-expanded")).toBe("true");
    expect(within(panel).getByRole("heading", { level: 2 }).textContent).toBe(
      "Newer commits",
    );
    expect(screen.getByRole("region", { name: "New brief failed" })).toBe(
      panel,
    );
    expect(
      within(panel).getByText("The model provider timed out."),
    ).toBeTruthy();
    fireEvent.click(within(panel).getByRole("button", { name: "Retry" }));
    expect(onTrigger).toHaveBeenCalledTimes(1);
  });

  it("offers the latest push's run in the panel beside a newer brief", () => {
    const onRetry = vi.fn();
    const navigate: NewerCommitsAction = {
      ...RETRY,
      kind: NewerCommitsActionKinds.NAVIGATE,
      label: "Go to newer brief",
    };
    const status = stubStatus({
      action: navigate,
      runAction: { ...RETRY, onTrigger: onRetry },
    });
    render(makeChip(status));
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();

    const panel = openPanel();

    expect(
      within(panel).getByRole("button", { name: "Go to newer brief" }),
    ).toBeTruthy();
    fireEvent.click(within(panel).getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("closes the panel on Escape and returns focus to the info button", () => {
    const status = stubStatus();
    render(makeChip(status));
    const info = screen.getByRole("button", { name: "About newer commits" });
    openPanel();

    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });

    expect(info.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(info);
  });

  it("shows a paste refusal beside the chip and in the panel", () => {
    const status = stubStatus({ failure: "Your session expired." });
    render(makeChip(status));

    expect(screen.getByText("Your session expired.")).toBeTruthy();
    const panel = openPanel();
    expect(within(panel).getByText("Your session expired.")).toBeTruthy();
  });

  it("hands focus to the main landmark when a poll drops its action", () => {
    render(<main id="main-content" tabIndex={-1} />);
    const { action: _omitted, ...statusOnly } = stubStatus();
    const status = stubStatus();
    const view = render(makeChip(status));
    screen.getByRole("button", { name: "Retry" }).focus();

    view.rerender(makeChip(statusOnly));

    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    expect(document.activeElement?.id).toBe("main-content");
  });

  it("hands focus to the main landmark when the chip leaves", () => {
    render(<main id="main-content" tabIndex={-1} />);
    const status = stubStatus();
    const view = render(makeChip(status));
    screen.getByRole("button", { name: "About newer commits" }).focus();

    view.unmount();

    expect(document.activeElement?.id).toBe("main-content");
  });

  it("leaves focus alone when the chip never held it", () => {
    render(<main id="main-content" tabIndex={-1} />);
    const status = stubStatus();
    const view = render(makeChip(status));

    view.unmount();

    expect(document.activeElement).toBe(document.body);
  });
});
