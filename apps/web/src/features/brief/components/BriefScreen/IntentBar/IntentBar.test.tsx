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
    // The count digit renders in its own weighted element, so the pair is
    // asserted on the toggle's full text rather than one text node.
    const toggle = screen.getByRole("button", { name: /intent check/i });
    for (const pair of [
      "1 accomplished",
      "0 claimed but unachieved",
      "0 deviations",
      "1 stated but missing",
      "1 done but unstated",
    ]) {
      expect(toggle.textContent).toContain(pair);
    }
    // Provenance, not a bucket count — the linked-ticket line lives in the
    // panel preamble, never the bar.
    expect(toggle.textContent).not.toContain("linked ticket");
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

  it("opens in full — the twist is the only disclosure, no inner height cap", () => {
    render(<IntentBar intentCheck={PRECISE} jumpToGroup={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /intent check/i }));
    // No second expand layer: the per-bucket clamp owns overflow instead.
    expect(
      screen.queryByRole("button", { name: /show full intent check/i }),
    ).toBeNull();
    expect(screen.queryByTestId("intent-text")).toBeNull();
  });

  it("expands on click with no framing line — the scope note leads the panel", () => {
    const withScope: IntentCheck = {
      ...PRECISE,
      scopeNote: "later URL-box work is outside this diff",
    };
    render(<IntentBar intentCheck={withScope} jumpToGroup={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /intent check/i }));
    expect(screen.queryByText(/fallible read/i)).toBeNull();
    expect(screen.getByText("add the widget endpoint")).toBeTruthy();
    const body = bodyText();
    expect(
      body.indexOf("later URL-box work is outside this diff"),
    ).toBeLessThan(body.indexOf("1 linked ticket"));
  });

  it("renders the linked-ticket subsection in the preamble: count line + id bullets", () => {
    render(<IntentBar intentCheck={PRECISE} jumpToGroup={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /intent check/i }));
    expect(screen.getByText("1 linked ticket")).toBeTruthy();
    // The id derives from the URL tail and carries the link.
    const link = screen.getByRole("link", {
      name: /^T-1 ?\(opens in a new tab\)$/,
    });
    expect(link.getAttribute("href")).toBe("https://tracker.example/T-1");
    // The subsection precedes the buckets.
    const body = bodyText();
    expect(body.indexOf("1 linked ticket")).toBeLessThan(
      body.indexOf("add the widget endpoint"),
    );
  });

  it("derives the ticket id from the URL path tail, dropping query and fragment", () => {
    render(
      <IntentBar
        intentCheck={{
          ...PRECISE,
          ticketUrls: ["https://tracker.example/browse/T-7?filter=x#top"],
        }}
        jumpToGroup={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /intent check/i }));
    expect(
      screen.getByRole("link", { name: /^T-7 ?\(opens in a new tab\)$/ }),
    ).toBeTruthy();
  });

  it("never links a non-http(s) ticket URL — the id renders as plain text", () => {
    const sneaky: IntentCheck = {
      ...PRECISE,
      // eslint-disable-next-line no-script-url
      ticketUrls: ["javascript:alert(1)"],
    };
    render(<IntentBar intentCheck={sneaky} jumpToGroup={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /intent check/i }));
    expect(screen.getByText("1 linked ticket")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /alert/ })).toBeNull();
  });

  it("omits the linked-ticket subsection entirely when there are no tickets", () => {
    render(
      <IntentBar
        intentCheck={{ ...PRECISE, ticketUrls: [] }}
        jumpToGroup={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /intent check/i }));
    expect(screen.queryByText(/linked ticket/)).toBeNull();
  });

  it("renders broad sources as the same quiet bar with an unavailability line and no buckets", () => {
    render(<IntentBar intentCheck={BROAD} jumpToGroup={() => {}} />);
    expect(screen.getByText(/intent check unavailable/i)).toBeTruthy();
    expect(screen.queryByText("1 accomplished")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /intent check/i }));
    // Body keeps the preamble (scope note + ticket provenance), no buckets.
    expect(screen.getByText("parent epic spans several PRs")).toBeTruthy();
    expect(screen.getByText("1 linked ticket")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: /^EPIC-9 ?\(opens in a new tab\)$/ }),
    ).toBeTruthy();
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

  it("renders the citation as a subtle neutral badge on its own row", () => {
    const mixedSources: IntentCheck = {
      ...PRECISE,
      accomplished: [
        {
          intent: "cited from the ticket",
          quote: "keep the widget cache",
          sourceUrl: "https://tracker.example/T-1",
          groupIds: [],
          acknowledged: false,
        },
        {
          intent: "cited from the description",
          quote: "a quote from the PR body",
          sourceUrl: "",
          groupIds: [],
          acknowledged: false,
        },
      ],
    };
    render(<IntentBar intentCheck={mixedSources} jumpToGroup={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /intent check/i }));
    const [linked] = screen.getAllByRole("link", {
      name: /^source ?\(opens in a new tab\)$/,
    });
    expect(linked?.closest('[data-color="neutral"]')).not.toBeNull();
    expect(
      screen.getByText("PR description").closest('[data-color="neutral"]'),
    ).not.toBeNull();
  });

  it("titles the go-to button with its group's own title when provided", () => {
    render(
      <IntentBar
        groupTitles={{ g1: "Add the widget endpoint and its store" }}
        intentCheck={PRECISE}
        jumpToGroup={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /intent check/i }));
    const button = screen.getByRole("button", {
      name: "go to change-group g1 — Add the widget endpoint and its store",
    });
    // The hover tooltip carries the same text as the accessible name.
    expect(button.getAttribute("title")).toBe(
      "go to change-group g1 — Add the widget endpoint and its store",
    );
    // A group with no known title keeps the plain label.
    const bare = screen.getByRole("button", { name: "go to change-group g2" });
    expect(bare.getAttribute("title")).toBe("go to change-group g2");
  });

  it("wires the go-to buttons to jumpToGroup (the TocBar path)", () => {
    const jumpToGroup = vi.fn();
    render(<IntentBar intentCheck={PRECISE} jumpToGroup={jumpToGroup} />);
    fireEvent.click(screen.getByRole("button", { name: /intent check/i }));
    fireEvent.click(
      screen.getByRole("button", { name: "go to change-group g1" }),
    );
    expect(jumpToGroup).toHaveBeenCalledWith("g1");
    fireEvent.click(
      screen.getByRole("button", { name: "go to change-group g2" }),
    );
    expect(jumpToGroup).toHaveBeenCalledWith("g2");
  });

  it("gives every item a plain bullet — the jump is no longer the marker", () => {
    const { container } = render(
      <IntentBar intentCheck={PRECISE} jumpToGroup={() => {}} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /intent check/i }));
    const items = container.querySelectorAll("[data-intent-bar] li");
    // 3 bucket items + 1 ticket bullet, each carrying the ▪ marker.
    const marked = [...items].filter((li) => li.textContent?.includes("▪"));
    expect(marked.length).toBe(items.length);
  });

  it("labels go-to buttons with ids only on multi-group claims (ids-multi)", () => {
    const multi: IntentCheck = {
      ...PRECISE,
      accomplished: [
        {
          intent: "spans two groups",
          quote: "",
          sourceUrl: "",
          groupIds: ["g5", "g6"],
          acknowledged: false,
        },
      ],
    };
    render(<IntentBar intentCheck={multi} jumpToGroup={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /intent check/i }));
    // Single-group buttons stay a bare ↳ — no visible id text.
    const bare = screen.getByRole("button", { name: "go to change-group g2" });
    expect(bare.textContent).toBe("↳");
    // Multi-group claims disambiguate with a visible id per button.
    const labeled = screen.getByRole("button", {
      name: "go to change-group g5",
    });
    expect(labeled.textContent).toBe("↳g5");
    expect(
      screen.getByRole("button", { name: "go to change-group g6" }).textContent,
    ).toBe("↳g6");
  });

  it("links a valid http(s) source and attributes an empty sourceUrl to the PR description", () => {
    render(<IntentBar intentCheck={PRECISE} jumpToGroup={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /intent check/i }));
    const link = screen.getAllByRole("link", {
      name: /^source ?\(opens in a new tab\)$/,
    })[0];
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
    const link = screen.getByRole("link", {
      name: /^source ?\(opens in a new tab\)$/,
    });
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
    expect(screen.queryByRole("link", { name: /source/ })).toBeNull();
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

describe("IntentBar — clamp", () => {
  const manyItems = (count: number) =>
    Array.from({ length: count }, (_, index) => ({
      intent: `ask number ${index + 1}`,
      quote: "",
      sourceUrl: "",
      groupIds: [],
      acknowledged: false,
    }));

  it("clamps a bucket past 6 items to 5 plus an in-place expander", () => {
    render(
      <IntentBar
        intentCheck={{ ...PRECISE, accomplished: manyItems(8) }}
        jumpToGroup={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /intent check/i }));
    expect(screen.getByText("ask number 5")).toBeTruthy();
    expect(screen.queryByText("ask number 6")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Show all 8" }));
    expect(screen.getByText("ask number 8")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Show fewer" }));
    expect(screen.queryByText("ask number 6")).toBeNull();
    expect(screen.getByText("ask number 5")).toBeTruthy();
  });

  it("announces the expander as a disclosure wired to its bucket list", () => {
    const { container } = render(
      <IntentBar
        intentCheck={{ ...PRECISE, accomplished: manyItems(8) }}
        jumpToGroup={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /intent check/i }));
    const expander = screen.getByRole("button", { name: "Show all 8" });
    expect(expander.getAttribute("aria-expanded")).toBe("false");
    const listId = expander.getAttribute("aria-controls") ?? "";
    expect(container.querySelector(`ul[id="${listId}"]`)).not.toBeNull();

    fireEvent.click(expander);
    expect(
      screen
        .getByRole("button", { name: "Show fewer" })
        .getAttribute("aria-expanded"),
    ).toBe("true");
  });

  it("never clamps at 6 or fewer items", () => {
    render(
      <IntentBar
        intentCheck={{ ...PRECISE, accomplished: manyItems(6) }}
        jumpToGroup={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /intent check/i }));
    expect(screen.getByText("ask number 6")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Show all/ })).toBeNull();
  });

  it("clamps buckets independently", () => {
    render(
      <IntentBar
        intentCheck={{
          ...PRECISE,
          accomplished: manyItems(7),
          doneButUnstated: manyItems(9).map((baseItem) => ({
            ...baseItem,
            intent: `unstated ${baseItem.intent}`,
          })),
        }}
        jumpToGroup={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /intent check/i }));
    fireEvent.click(screen.getByRole("button", { name: "Show all 9" }));
    // Expanding one bucket leaves the other clamped.
    expect(screen.getByText("unstated ask number 9")).toBeTruthy();
    expect(screen.queryByText(/^ask number 6$/)).toBeNull();
    expect(screen.getByRole("button", { name: "Show all 7" })).toBeTruthy();
  });
});

describe("IntentBar — alarm buckets", () => {
  const WITH_ALARMS: IntentCheck = {
    ...PRECISE,
    deviations: [item("drops the cache the ticket asked to keep")],
    claimedButUnachieved: [item("claims the flake is fixed but only skips it")],
  };

  it("ships the DOM in split order: Checks out first, static order within each side", () => {
    render(<IntentBar intentCheck={WITH_ALARMS} jumpToGroup={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /intent check/i }));
    const body = bodyText();
    const order = [
      "Checks out",
      "Accomplished",
      "Needs a look",
      "Claimed but unachieved",
      "Deviations",
      "Stated but missing",
      "Done but unstated",
    ].map((label) => body.indexOf(label));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect(order).toEqual(order.toSorted((a, b) => a - b));
  });

  it("exposes the real heading ladder: band h2, split heads h3, bucket labels h4", () => {
    render(<IntentBar intentCheck={WITH_ALARMS} jumpToGroup={() => {}} />);
    expect(
      screen.getByRole("heading", { level: 2, name: /intent check/i }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /intent check/i }));
    expect(
      screen.getByRole("heading", { level: 3, name: "Checks out" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { level: 3, name: "Needs a look" }),
    ).toBeTruthy();
    const bucketHeads = screen
      .getAllByRole("heading", { level: 4 })
      .map((node) => node.textContent);
    expect(bucketHeads).toEqual([
      "Accomplished",
      "◇Claimed but unachieved",
      "◇Deviations",
      "Stated but missing",
      "Done but unstated",
    ]);
  });

  it("keeps an empty split side as information: head + quiet empty line", () => {
    const oneSided: IntentCheck = {
      ...PRECISE,
      statedButMissing: [],
      doneButUnstated: [],
    };
    render(<IntentBar intentCheck={oneSided} jumpToGroup={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /intent check/i }));
    // Both heads always render on a precise check — an empty "Needs a look"
    // is the band's best news, said out loud instead of silently dropped.
    expect(
      screen.getByRole("heading", { level: 3, name: "Checks out" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { level: 3, name: "Needs a look" }),
    ).toBeTruthy();
    expect(screen.getByText("nothing needs a look")).toBeTruthy();
    expect(screen.queryByText("nothing checks out")).toBeNull();

    cleanup();
    const alarmOnly: IntentCheck = {
      ...PRECISE,
      accomplished: [],
      deviations: [item("drops the cache")],
    };
    render(<IntentBar intentCheck={alarmOnly} jumpToGroup={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /intent check/i }));
    expect(
      screen.getByRole("heading", { level: 3, name: "Checks out" }),
    ).toBeTruthy();
    expect(screen.getByText("nothing checks out")).toBeTruthy();
    expect(screen.queryByText("nothing needs a look")).toBeNull();
  });

  it("keeps the empty lines out of two-populated-side and broad renders", () => {
    render(<IntentBar intentCheck={WITH_ALARMS} jumpToGroup={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /intent check/i }));
    expect(screen.queryByText(/^nothing /)).toBeNull();

    cleanup();
    render(<IntentBar intentCheck={BROAD} jumpToGroup={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /intent check/i }));
    // Unavailable sources render no split body at all — no heads, no lines.
    expect(screen.queryByRole("heading", { level: 3 })).toBeNull();
    expect(screen.queryByText(/^nothing /)).toBeNull();
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

  it("partitions acknowledged deviations under Checks out, with no chip and no caution", () => {
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
    // The acknowledged half is a quiet receipt on the Checks-out side; the
    // unacknowledged half stays in the alarm slot on the other side.
    expect(body.indexOf("reversal the description owns")).toBeLessThan(
      body.indexOf("Needs a look"),
    );
    expect(body.indexOf("Needs a look")).toBeLessThan(
      body.indexOf("silent reversal"),
    );
    // The chip is gone — the bucket label already says acknowledged.
    expect(screen.queryByText("acknowledged")).toBeNull();
    expect(
      screen.getByRole("heading", {
        level: 4,
        name: "Deviations acknowledged in the description",
      }),
    ).toBeTruthy();
    // Only the unacknowledged half is alarm-class.
    expect(screen.getAllByText(/AI-inferred tension/i)).toHaveLength(1);
  });

  it("counts BOTH halves of deviations in the header (the count is not the alarm)", () => {
    const mixed: IntentCheck = {
      ...PRECISE,
      deviations: [item("ack", true), item("unack")],
    };
    render(<IntentBar intentCheck={mixed} jumpToGroup={() => {}} />);
    expect(
      screen.getByRole("button", { name: /intent check/i }).textContent,
    ).toContain("2 deviations");
  });

  it('singularizes the deviations count (never "1 deviations")', () => {
    render(
      <IntentBar
        intentCheck={{ ...PRECISE, deviations: [item("only one")] }}
        jumpToGroup={() => {}}
      />,
    );
    const header = screen.getByRole("button", {
      name: /intent check/i,
    }).textContent;
    expect(header).toContain("1 deviation");
    expect(header).not.toContain("1 deviations");
  });

  it("renders no alarm residue when the alarm buckets are empty", () => {
    const { container } = render(
      <IntentBar intentCheck={PRECISE} jumpToGroup={() => {}} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /intent check/i }));
    const html = container.innerHTML;
    expect(html).not.toContain("◇");
    expect(html).not.toContain("AI-inferred tension");
    expect(html).not.toContain("Claimed but unachieved");
    expect(html).not.toContain("Deviations acknowledged");
    // The header counts stay the neutral flat five — same class, no color,
    // no ordering.
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
