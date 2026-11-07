// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CALLOUT_HOVER_DELAY_MS } from "@web/components/Callout/consts";
import { startColdCalloutTimers } from "@web/test/callouts";

import { ProviderBadge } from ".";

afterEach(() => {
  vi.useRealTimers();
});

/** The pointer of `pointerType` resting on the mark cell past the hover delay. */
function restOnMark(pointerType: "mouse" | "touch"): void {
  const markCell = badge().firstElementChild;
  if (!markCell) {
    throw new Error("mark cell not rendered");
  }
  fireEvent.pointerEnter(markCell, { pointerType });
  act(() => {
    vi.advanceTimersByTime(CALLOUT_HOVER_DELAY_MS);
  });
}

function badge() {
  const el = document.querySelector("[data-provider-badge]");
  if (!el) {
    throw new Error("badge not rendered");
  }
  return el;
}

describe("ProviderBadge", () => {
  it("renders nothing without a generation stamp", () => {
    render(<ProviderBadge generation={undefined} />);
    expect(document.querySelector("[data-provider-badge]")).toBeNull();
  });

  it.each([
    ["anthropic", "Anthropic", "API"],
    ["openai", "OpenAI", "API"],
    ["openrouter", "OpenRouter", "API"],
    ["claude-code", "Claude Code", "CLI"],
    ["cursor", "Cursor", "CLI"],
  ] as const)(
    "%s: hidden official mark, sr-only name and %s class tag",
    (provider, name, tag) => {
      render(
        <ProviderBadge
          generation={{ provider, model: "m-1", effort: "medium" }}
        />,
      );
      const svg = badge().querySelector("svg");
      expect(svg?.getAttribute("aria-hidden")).toBe("true");
      // Provider name reaches screen readers ONLY, pinned to the sr-only
      // wrapper so a visible duplicate next to the mark can't slip in.
      const nameEl = screen.getByText(name);
      expect(nameEl.className).toContain("sr-only");
      expect(badge().textContent).toContain(tag);
      expect(badge().textContent).toContain("m-1 · medium");
    },
  );

  it("codex takes the named fallback: generic glyph + visible key, CLI tag", () => {
    // No standalone official Codex mark exists, so no brand approximation
    // ships, the pill names the provider in text instead. The model id
    // deliberately does NOT contain the provider key, so this pins the
    // visible key itself, not the model cell.
    render(
      <ProviderBadge
        generation={{ provider: "codex", model: "gpt-5.2", effort: null }}
      />,
    );
    expect(badge().textContent).toContain("codex");
    expect(badge().textContent).toContain("CLI");
    expect(badge().querySelector("svg")).toBeTruthy();
  });

  it("unknown providers get the same fallback with no class tag", () => {
    render(
      <ProviderBadge
        generation={{ provider: "my-proxy", model: "local-1", effort: null }}
      />,
    );
    expect(badge().textContent).toContain("my-proxy");
    expect(badge().textContent).toContain("local-1");
    expect(badge().textContent).not.toContain("API");
    expect(badge().textContent).not.toContain("CLI");
  });

  it("inherited-object keys read as unknown with no mark or tag", () => {
    render(
      <ProviderBadge
        generation={{ provider: "toString", model: "m-1", effort: null }}
      />,
    );
    expect(badge().textContent).toContain("toString");
    expect(badge().textContent).not.toContain("API");
  });

  it("keeps the OpenRouter author prefix in the identity", () => {
    render(
      <ProviderBadge
        generation={{
          provider: "openrouter",
          model: "anthropic/claude-opus-5",
          effort: "high",
        }}
      />,
    );
    expect(badge().textContent).toContain("anthropic/claude-opus-5 · high");
  });

  it("omits the effort suffix when effort is null", () => {
    render(
      <ProviderBadge
        generation={{ provider: "anthropic", model: "m-1", effort: null }}
      />,
    );
    expect(badge().textContent).toContain("m-1");
    expect(badge().textContent).not.toContain("·");
  });

  it("names the provider in a callout once a mouse rests on the mark", () => {
    startColdCalloutTimers();
    render(
      <ProviderBadge
        generation={{ provider: "cursor", model: "m-1", effort: null }}
      />,
    );

    restOnMark("mouse");

    expect(screen.getByRole("tooltip").textContent).toBe("Cursor");
  });

  it("opens no callout for a touch on the mark", () => {
    startColdCalloutTimers();
    render(
      <ProviderBadge
        generation={{ provider: "cursor", model: "m-1", effort: null }}
      />,
    );

    restOnMark("touch");

    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("opens no callout over a fallback that already shows its key", () => {
    startColdCalloutTimers();
    render(
      <ProviderBadge
        generation={{ provider: "codex", model: "m-1", effort: null }}
      />,
    );

    restOnMark("mouse");

    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("shows no callout when a hovered fallback turns into a known mark", () => {
    startColdCalloutTimers();
    const { rerender } = render(
      <ProviderBadge
        generation={{ provider: "codex", model: "m-1", effort: null }}
      />,
    );
    restOnMark("mouse");

    rerender(
      <ProviderBadge
        generation={{ provider: "cursor", model: "m-1", effort: null }}
      />,
    );

    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("shows no callout when a fallback swap returns to a known mark", () => {
    startColdCalloutTimers();
    const { rerender } = render(
      <ProviderBadge
        generation={{ provider: "cursor", model: "m-1", effort: null }}
      />,
    );
    restOnMark("mouse");
    expect(screen.getByRole("tooltip")).toBeTruthy();

    rerender(
      <ProviderBadge
        generation={{ provider: "codex", model: "m-1", effort: null }}
      />,
    );
    rerender(
      <ProviderBadge
        generation={{ provider: "anthropic", model: "m-1", effort: null }}
      />,
    );

    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});
