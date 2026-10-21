// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Button } from ".";

describe("Button", () => {
  it("renders a type=button secondary md by default", () => {
    render(<Button>Go</Button>);
    const button = screen.getByRole("button", { name: "Go" });
    expect(button.getAttribute("type")).toBe("button");
    expect(button.getAttribute("data-variant")).toBe("secondary");
    expect(button.getAttribute("data-size")).toBe("md");
  });

  it("lets the caller override type, variant, and size", () => {
    render(
      <Button size="sm" type="submit" variant="accent">
        Go
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Go" });
    expect(button.getAttribute("type")).toBe("submit");
    expect(button.getAttribute("data-variant")).toBe("accent");
    expect(button.getAttribute("data-size")).toBe("sm");
  });

  it("disabled sets aria-disabled, not the attribute, and guards clicks", () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Go
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Go" });
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(button.hasAttribute("disabled")).toBe(false);
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("loading renders aria-busy and guards clicks independently of disabled", () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Go
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Go" });
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(button.getAttribute("aria-disabled")).toBeNull();
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("a caller aria-disabled without the disabled prop keeps clicks live", () => {
    // The announce-on-click contract: the call site owns the reason
    // announcement, so the guard must not key off the rendered attribute.
    const onClick = vi.fn();
    render(
      <Button aria-disabled onClick={onClick}>
        Go
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Go" });
    expect(button.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("the disabled prop beats a caller aria-disabled={false}", () => {
    const onClick = vi.fn();
    render(
      <Button aria-disabled={false} disabled onClick={onClick}>
        Go
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Go" });
    expect(button.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("fires onClick when enabled", () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Go</Button>);
    fireEvent.click(screen.getByRole("button", { name: "Go" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("passes through className, data-* hooks, and aria-describedby", () => {
    render(
      <Button
        aria-describedby="why-off"
        className="extra"
        data-testid="cta"
        disabled
      >
        Go
      </Button>,
    );
    const button = screen.getByTestId("cta");
    expect(button.className).toContain("extra");
    expect(button.getAttribute("aria-describedby")).toBe("why-off");
  });

  it("as=a renders an anchor with the href and no type attribute", () => {
    render(
      <Button as="a" href="/somewhere" variant="accent">
        Go
      </Button>,
    );
    const anchor = screen.getByRole("link", { name: "Go" });
    expect(anchor.getAttribute("href")).toBe("/somewhere");
    expect(anchor.hasAttribute("type")).toBe(false);
  });

  it("as=a disabled prevents navigation and suppresses onClick", () => {
    const onClick = vi.fn();
    render(
      <Button as="a" disabled href="/somewhere" onClick={onClick}>
        Go
      </Button>,
    );
    const anchor = screen.getByRole("link", { name: "Go" });
    const cancelled = !fireEvent.click(anchor);
    expect(cancelled).toBe(true);
    expect(onClick).not.toHaveBeenCalled();
    expect(anchor.getAttribute("aria-disabled")).toBe("true");
  });
});
