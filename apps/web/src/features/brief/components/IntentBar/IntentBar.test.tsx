// @vitest-environment jsdom
// The ticket-gated intent bar (BRIEF-54): always-visible neutral header,
// body collapsed by default and never auto-expanding, quotes text-only,
// sourceUrl scheme-sanitized, groupIds reuse the group-jump machinery.
import { act, createRef } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { IntentBar, type IntentBarHandle } from "./IntentBar";
import type { IntentCheck } from "../../types";

afterEach(cleanup);

const PRECISE: IntentCheck = {
  ticketUrls: ["https://tracker.example/T-1"],
  specificity: "precise",
  scopeNote: "",
  accomplished: [
    {
      intent: "add the widget endpoint",
      quote: "Add a widget endpoint returning the list",
      sourceUrl: "https://tracker.example/T-1",
      groupIds: ["g1"],
    },
  ],
  statedButMissing: [
    {
      intent: "document the endpoint",
      quote: "and document it in the API guide",
      sourceUrl: "https://tracker.example/T-1",
      groupIds: [],
    },
  ],
  doneButUnstated: [
    { intent: "drive-by lint fix", quote: "", sourceUrl: "", groupIds: ["g2"] },
  ],
};

const BROAD: IntentCheck = {
  ticketUrls: ["https://tracker.example/EPIC-9"],
  specificity: "broad",
  scopeNote: "parent epic spans several PRs",
  accomplished: [],
  statedButMissing: [],
  doneButUnstated: [],
};

describe("IntentBar", () => {
  it("shows the three neutral bucket counts in the always-visible header", () => {
    render(<IntentBar intentCheck={PRECISE} jumpToGroup={() => {}} />);
    expect(screen.getByText("1 accomplished")).toBeTruthy();
    expect(screen.getByText("1 stated but missing")).toBeTruthy();
    expect(screen.getByText("1 done but unstated")).toBeTruthy();
    expect(screen.getByText("1 linked ticket")).toBeTruthy();
  });

  it("starts collapsed and never auto-expands, even with a missing ask", () => {
    render(<IntentBar intentCheck={PRECISE} jumpToGroup={() => {}} />);
    const toggle = screen.getByRole("button", { name: /intent check/i });
    expect(toggle).toHaveProperty("ariaExpanded", "false");
    // The panel exists but sits behind the `hidden` attribute until opened.
    expect(
      screen.getByText("add the widget endpoint").closest("[hidden]"),
    ).not.toBeNull();
  });

  it("expands on click and leads the body with the fallible-read framing", () => {
    render(<IntentBar intentCheck={PRECISE} jumpToGroup={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /intent check/i }));
    expect(screen.getByText(/fallible read/i)).toBeTruthy();
    expect(screen.getByText(/never\s+a verdict/i)).toBeTruthy();
    expect(screen.getByText("add the widget endpoint")).toBeTruthy();
  });

  it("renders a broad corpus as the same quiet bar with an unavailability line and no buckets", () => {
    render(<IntentBar intentCheck={BROAD} jumpToGroup={() => {}} />);
    expect(screen.getByText(/intent check unavailable/i)).toBeTruthy();
    expect(screen.queryByText("1 accomplished")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /intent check/i }));
    // Body has the framing but no bucket labels.
    expect(screen.getByText("parent epic spans several PRs")).toBeTruthy();
    expect(screen.queryByText("Accomplished")).toBeNull();
  });

  it("renders a none corpus with its own reason line", () => {
    render(
      <IntentBar
        intentCheck={{
          ...BROAD,
          specificity: "none",
          ticketUrls: [],
          scopeNote: "",
        }}
        jumpToGroup={() => {}}
      />,
    );
    expect(screen.getByText(/no stated intent was available/i)).toBeTruthy();
  });

  it("wires groupId chips to jumpToGroup (the TocBar path)", () => {
    const jumpToGroup = vi.fn();
    render(<IntentBar intentCheck={PRECISE} jumpToGroup={jumpToGroup} />);
    fireEvent.click(screen.getByRole("button", { name: /intent check/i }));
    fireEvent.click(screen.getByRole("button", { name: "g1" }));
    expect(jumpToGroup).toHaveBeenCalledWith("g1");
    fireEvent.click(screen.getByRole("button", { name: "g2" }));
    expect(jumpToGroup).toHaveBeenCalledWith("g2");
  });

  it("links a valid http(s) source and attributes an empty sourceUrl to the PR description", () => {
    render(<IntentBar intentCheck={PRECISE} jumpToGroup={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /intent check/i }));
    const link = screen.getAllByRole("link", { name: "source" })[0];
    expect(link?.getAttribute("href")).toBe("https://tracker.example/T-1");
    expect(link?.getAttribute("rel")).toContain("noreferrer");
    // doneButUnstated item sources from the diff — no ticket link, no attribution row.
    expect(screen.getByText("drive-by lint fix")).toBeTruthy();
  });

  it("keeps a valid source link even when the quote is empty (warn-only uncited item)", () => {
    const uncited: IntentCheck = {
      ...PRECISE,
      accomplished: [
        {
          intent: "cited but quoteless",
          quote: "",
          sourceUrl: "https://tracker.example/T-9",
          groupIds: ["g1"],
        },
      ],
      statedButMissing: [],
      doneButUnstated: [],
    };
    render(<IntentBar intentCheck={uncited} jumpToGroup={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /intent check/i }));
    const link = screen.getByRole("link", { name: "source" });
    expect(link.getAttribute("href")).toBe("https://tracker.example/T-9");
  });

  it("never renders a non-http(s) sourceUrl as a link (scheme sanitization)", () => {
    const malicious: IntentCheck = {
      ...PRECISE,
      accomplished: [
        {
          intent: "sneaky",
          quote: "click me",
          // eslint-disable-next-line no-script-url
          sourceUrl: "javascript:alert(1)",
          groupIds: [],
        },
      ],
      statedButMissing: [],
      doneButUnstated: [],
    };
    render(<IntentBar intentCheck={malicious} jumpToGroup={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /intent check/i }));
    // The quote renders as text; no link is produced for the bad scheme.
    expect(screen.getByText("click me")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "source" })).toBeNull();
  });

  it("renders quotes as text-only (no markdown/HTML interpretation)", () => {
    const htmlish: IntentCheck = {
      ...PRECISE,
      accomplished: [
        {
          intent: "render safely",
          quote: "<img src=x onerror=alert(1)> **bold**",
          sourceUrl: "",
          groupIds: [],
        },
      ],
      statedButMissing: [],
      doneButUnstated: [],
    };
    const { container } = render(
      <IntentBar intentCheck={htmlish} jumpToGroup={() => {}} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /intent check/i }));
    // The literal string appears verbatim; no <img>, no <strong>.
    expect(
      screen.getByText("<img src=x onerror=alert(1)> **bold**"),
    ).toBeTruthy();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("strong")).toBeNull();
  });

  it("exposes an imperative expand+scroll handle for the mark-ready jump (PR 4)", () => {
    const ref = createRef<IntentBarHandle>();
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    render(
      <IntentBar intentCheck={PRECISE} jumpToGroup={() => {}} ref={ref} />,
    );
    const toggle = screen.getByRole("button", { name: /intent check/i });
    expect(toggle).toHaveProperty("ariaExpanded", "false");
    act(() => ref.current?.expandAndScrollTo());
    expect(toggle).toHaveProperty("ariaExpanded", "true");
    expect(scrollIntoView).toHaveBeenCalled();
  });
});
