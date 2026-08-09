// @vitest-environment jsdom
import { act, createRef } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { IntentBar, type IntentBarHandle } from "./IntentBar";
import type { IntentCheck } from "../../../types";

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
      acknowledged: false,
    },
  ],
  statedButMissing: [
    {
      intent: "document the endpoint",
      quote: "and document it in the API guide",
      sourceUrl: "https://tracker.example/T-1",
      groupIds: [],
      acknowledged: false,
    },
  ],
  doneButUnstated: [
    {
      intent: "drive-by lint fix",
      quote: "",
      sourceUrl: "",
      groupIds: ["g2"],
      acknowledged: false,
    },
  ],
  deviations: [],
  claimedButUnachieved: [],
};

const BROAD: IntentCheck = {
  ticketUrls: ["https://tracker.example/EPIC-9"],
  specificity: "broad",
  scopeNote: "parent epic spans several PRs",
  accomplished: [],
  statedButMissing: [],
  doneButUnstated: [],
  deviations: [],
  claimedButUnachieved: [],
};

describe("IntentBar", () => {
  it("shows all five neutral bucket counts in the always-visible header", () => {
    render(<IntentBar intentCheck={PRECISE} jumpToGroup={() => {}} />);
    expect(screen.getByText("1 accomplished")).toBeTruthy();
    expect(screen.getByText("0 claimed but unachieved")).toBeTruthy();
    expect(screen.getByText("0 deviations")).toBeTruthy();
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

  it("renders broad sources as the same quiet bar with an unavailability line and no buckets", () => {
    render(<IntentBar intentCheck={BROAD} jumpToGroup={() => {}} />);
    expect(screen.getByText(/intent check unavailable/i)).toBeTruthy();
    expect(screen.queryByText("1 accomplished")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /intent check/i }));
    // Body has the framing but no bucket labels.
    expect(screen.getByText("parent epic spans several PRs")).toBeTruthy();
    expect(screen.queryByText("Accomplished")).toBeNull();
  });

  it("renders empty sources with its own reason line", () => {
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
          acknowledged: false,
        },
      ],
      statedButMissing: [],
      doneButUnstated: [],
      deviations: [],
      claimedButUnachieved: [],
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
          acknowledged: false,
        },
      ],
      statedButMissing: [],
      doneButUnstated: [],
      deviations: [],
      claimedButUnachieved: [],
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
          acknowledged: false,
        },
      ],
      statedButMissing: [],
      doneButUnstated: [],
      deviations: [],
      claimedButUnachieved: [],
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

  it("exposes an imperative expand+scroll handle for the mark-ready jump", () => {
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

/** One alarm-bucket item; `acknowledged` is the only axis these tests vary. */
const item = (intent: string, acknowledged = false) => ({
  intent,
  quote: "keep the widget cache",
  sourceUrl: "https://tracker.example/T-1",
  groupIds: ["g1"],
  acknowledged,
});

/** The expanded panel's text, for order assertions. */
function bodyText(): string {
  const panel = document.querySelector("[data-intent-bar] div");
  return panel?.textContent ?? "";
}

describe("IntentBar — alarm buckets", () => {
  const WITH_ALARMS: IntentCheck = {
    ...PRECISE,
    deviations: [item("drops the cache the ticket asked to keep")],
    claimedButUnachieved: [item("claims the flake is fixed but only skips it")],
  };

  it("renders the buckets in the locked static order, never severity-sorted", () => {
    render(<IntentBar intentCheck={WITH_ALARMS} jumpToGroup={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /intent check/i }));
    const body = bodyText();
    const order = [
      "Accomplished",
      "Claimed but unachieved",
      "Deviations",
      "Stated but missing",
      "Done but unstated",
    ].map((label) => body.indexOf(label));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect(order).toEqual(order.toSorted((a, b) => a - b));
  });

  it("carries one muted caution line per NON-EMPTY alarm bucket, and none otherwise", () => {
    render(<IntentBar intentCheck={WITH_ALARMS} jumpToGroup={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /intent check/i }));
    // Exactly two alarm buckets are non-empty here → exactly two cautions.
    expect(screen.getAllByText(/AI-inferred tension/i)).toHaveLength(2);

    cleanup();
    render(<IntentBar intentCheck={PRECISE} jumpToGroup={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /intent check/i }));
    // Neutral buckets never carry a caution — a caution with nothing under it
    // is exactly the anchoring noise the design forbids.
    expect(screen.queryByText(/AI-inferred tension/i)).toBeNull();
  });

  it("partitions acknowledged deviations to the TAIL, with a chip and no caution", () => {
    const mixed: IntentCheck = {
      ...PRECISE,
      deviations: [
        // Deliberately non-overlapping strings: an `indexOf` order assertion
        // is meaningless if one intent is a substring of the other.
        item("reversal the description owns", true),
        item("silent reversal", false),
      ],
    };
    render(<IntentBar intentCheck={mixed} jumpToGroup={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /intent check/i }));
    const body = bodyText();
    // The unacknowledged one sits in the alarm slot; the acknowledged one is a
    // quiet receipt after every other bucket.
    expect(body.indexOf("silent reversal")).toBeLessThan(
      body.indexOf("Done but unstated"),
    );
    expect(body.indexOf("Done but unstated")).toBeLessThan(
      body.indexOf("reversal the description owns"),
    );
    expect(screen.getByText("acknowledged")).toBeTruthy();
    // Only the unacknowledged half is alarm-class.
    expect(screen.getAllByText(/AI-inferred tension/i)).toHaveLength(1);
  });

  it("counts BOTH halves of deviations in the header (the count is not the alarm)", () => {
    const mixed: IntentCheck = {
      ...PRECISE,
      deviations: [item("ack", true), item("unack")],
    };
    render(<IntentBar intentCheck={mixed} jumpToGroup={() => {}} />);
    expect(screen.getByText("2 deviations")).toBeTruthy();
  });

  it('singularizes the deviations count (never "1 deviations")', () => {
    render(
      <IntentBar
        intentCheck={{ ...PRECISE, deviations: [item("only one")] }}
        jumpToGroup={() => {}}
      />,
    );
    expect(screen.getByText("1 deviation")).toBeTruthy();
    expect(screen.queryByText("1 deviations")).toBeNull();
  });

  it("renders a brief with no alarm items byte-identically to the old bar", () => {
    // An intent check whose alarm arrays are empty must produce exactly the
    // markup it produced before the buckets existed — no stray glyph,
    // caution, chip, or heading.
    const { container } = render(
      <IntentBar intentCheck={PRECISE} jumpToGroup={() => {}} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /intent check/i }));
    const html = container.innerHTML;
    expect(html).not.toContain("◇");
    expect(html).not.toContain("AI-inferred tension");
    expect(html).not.toContain("acknowledged");
    expect(html).not.toContain("Claimed but unachieved");
    expect(html).not.toContain("Deviations acknowledged");
    // The header counts DO grow to five — that is the one visible change, and
    // it stays neutral (same class as its siblings, no color, no ordering).
    const counts = [...container.querySelectorAll("span")].filter((node) =>
      /^\d+ (accomplished|claimed but unachieved|deviations|stated but missing|done but unstated)$/.test(
        (node.textContent ?? "").replace(/\s+/g, " ").trim(),
      ),
    );
    expect(counts).toHaveLength(5);
    const classes = new Set(counts.map((node) => node.className));
    expect(classes.size).toBe(1);
  });

  it("keeps the alarm buckets out of broad/none sources entirely", () => {
    const broadWithAlarms: IntentCheck = {
      ...BROAD,
      deviations: [item("should never render")],
    };
    render(<IntentBar intentCheck={broadWithAlarms} jumpToGroup={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /intent check/i }));
    expect(screen.queryByText("should never render")).toBeNull();
    expect(screen.queryByText(/AI-inferred tension/i)).toBeNull();
  });
});
