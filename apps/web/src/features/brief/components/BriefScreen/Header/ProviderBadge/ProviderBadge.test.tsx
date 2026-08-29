// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ProviderBadge } from "./ProviderBadge";

afterEach(cleanup);

function badge() {
  const el = document.querySelector("[data-provider-badge]");
  if (!el) throw new Error("badge not rendered");
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
    "%s: official mark (aria-hidden) + sr-only name + %s class tag",
    (provider, name, tag) => {
      render(
        <ProviderBadge
          generation={{ provider, model: "m-1", effort: "medium" }}
        />,
      );
      const svg = badge().querySelector("svg");
      expect(svg?.getAttribute("aria-hidden")).toBe("true");
      // Provider name reaches screen readers ONLY — pinned to the sr-only
      // wrapper so a visible duplicate next to the mark can't slip in.
      const nameEl = screen.getByText(name);
      expect(nameEl.className).toContain("sr-only");
      // Pointer users get the provider name as the native tooltip.
      expect(nameEl.closest("[title]")?.getAttribute("title")).toBe(name);
      expect(badge().textContent).toContain(tag);
      expect(badge().textContent).toContain("m-1 · medium");
    },
  );

  it("codex takes the named fallback: generic glyph + visible token, CLI tag", () => {
    // No standalone official Codex mark exists, so no brand approximation
    // ships — the pill names the provider in text instead. The model id
    // deliberately does NOT contain the provider token, so this pins the
    // visible token itself, not the model cell.
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

  it("inherited-object tokens read as unknown (no bogus mark or tag)", () => {
    render(
      <ProviderBadge
        generation={{ provider: "toString", model: "m-1", effort: null }}
      />,
    );
    expect(badge().textContent).toContain("toString");
    expect(badge().textContent).not.toContain("API");
  });

  it("keeps the OpenRouter author prefix — origin never abbreviates identity", () => {
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
});
