// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SignOutScopes, type SignOutFlow } from "../../../types";
import { SignOutModal } from ".";

const OPEN: SignOutFlow = { open: true, pending: undefined, failed: false };

function renderModal(flow: Partial<SignOutFlow> = {}) {
  const cancel = vi.fn();
  const confirm = vi.fn();
  const { container } = render(
    <SignOutModal
      cancel={cancel}
      confirm={confirm}
      flow={{ ...OPEN, ...flow }}
    />,
  );
  return { cancel, confirm, container };
}

describe("SignOutModal", () => {
  it("opens with focus on Cancel and names itself by its heading", () => {
    const { container } = renderModal();

    const dialog = screen.getByRole("dialog", { name: "Sign out?" });
    // Portalled out of its owner, so a header's backdrop-filter cannot hold it.
    expect(container.contains(dialog)).toBe(false);
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Cancel" }),
    );
  });

  it("each scope button confirms its own scope", () => {
    const { confirm } = renderModal();

    fireEvent.click(screen.getByRole("button", { name: "This device" }));
    fireEvent.click(screen.getByRole("button", { name: "Everywhere" }));

    expect(confirm.mock.calls).toEqual([
      [SignOutScopes.THIS_DEVICE],
      [SignOutScopes.EVERYWHERE],
    ]);
  });

  it("Escape cancels unless a sign out is in flight", () => {
    const idle = renderModal();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(idle.cancel).toHaveBeenCalledTimes(1);
    cleanup();

    const busy = renderModal({ pending: SignOutScopes.THIS_DEVICE });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(busy.cancel).not.toHaveBeenCalled();
  });

  it("while a scope is in flight every button holds and that one reads busy", () => {
    renderModal({ pending: SignOutScopes.EVERYWHERE });

    const buttons = screen.getAllByRole("button");
    expect(
      buttons.map((button) => button.getAttribute("aria-disabled")),
    ).toEqual(["true", "true", "true"]);
    expect(
      screen
        .getByRole("button", { name: "Signing out" })
        .getAttribute("aria-busy"),
    ).toBe("true");
    expect(
      screen
        .getByRole("button", { name: "This device" })
        .getAttribute("aria-busy"),
    ).toBeNull();
  });

  it("a failed sign out reports as an alert inside the dialog", () => {
    renderModal({ failed: true });

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toBe("Sign out did not go through. Try again.");
    expect(screen.getByRole("dialog").contains(alert)).toBe(true);
  });
});
