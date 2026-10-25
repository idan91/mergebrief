// @vitest-environment jsdom
import type { IntentCheck, PrimaryTicket } from "brief-core/types";
import { act, createRef } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { IconNames } from "@web/components/Icon/types";
import { IntentBar, type IntentBarHandle } from ".";
import { INTENT_BAR_ID } from "./consts";

const ALARM_MARK_SELECTOR = `[data-icon="${IconNames.WARNING_DIAMOND}"]`;

const PRIMARY: PrimaryTicket = {
  key: "T-1",
  url: "https://tracker.example/T-1",
  tracker: "github",
  foundIn: "description",
  title: "Widget endpoint returns the list",
  header: "",
  status: "read",
  reason: "",
};

const ALIGNMENT: IntentCheck["alignment"] = {
  read: "partial",
  goal: "Add a widget endpoint returning the list and document it",
  response: "The diff adds the endpoint; the API guide is untouched.",
};

/** A precise check with no primary ticket (older briefs, or no reference found). */
const PRECISE_NO_TICKET: IntentCheck = {
  ticketUrls: ["https://tracker.example/T-1"],
  ticketTitles: [],
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
  maskedFixes: [],
};

const PRECISE: IntentCheck = {
  ...PRECISE_NO_TICKET,
  primaryTicket: PRIMARY,
  alignment: ALIGNMENT,
};

const BROAD: IntentCheck = {
  ticketUrls: ["https://tracker.example/EPIC-9"],
  ticketTitles: [],
  specificity: "broad",
  scopeNote: "parent epic spans several PRs",
  primaryTicket: {
    ...PRIMARY,
    key: "EPIC-9",
    url: "https://tracker.example/EPIC-9",
    title: "Widgets everywhere",
  },
  accomplished: [],
  statedButMissing: [],
  doneButUnstated: [],
  deviations: [],
  maskedFixes: [],
};

describe("IntentBar", () => {
  it("offers the legend beside the toggle only on a precise check", () => {
    const { unmount } = render(
      <IntentBar intentCheck={PRECISE} jumpToGroup={() => {}} />,
    );
    const legend = screen.getByRole("button", { name: "What these mean" });
    const toggle = screen.getByRole("button", { name: /intent check/i });
    expect(toggle.contains(legend)).toBe(false);
    unmount();

    render(<IntentBar intentCheck={BROAD} jumpToGroup={() => {}} />);
    expect(
      screen.queryByRole("button", { name: "What these mean" }),
    ).toBeNull();
  });

  it("shows all five neutral bucket counts in the always-visible header", () => {
    render(<IntentBar intentCheck={PRECISE} jumpToGroup={() => {}} />);
    // The count digit renders in its own weighted element, so the pair is
    // asserted on the toggle's full text rather than one text node.
    const toggle = screen.getByRole("button", { name: /intent check/i });
    for (const pair of [
      "1 accomplished",
      "0 masked fixes",
      "0 deviations",
      "1 stated but missing",
      "1 done but unstated",
    ]) {
      expect(toggle.textContent).toContain(pair);
    }
    // Provenance, not a bucket count: the Ticket alignment card lives in the
    // panel preamble, never the bar.
    expect(toggle.textContent).not.toContain("Ticket alignment");
    expect(toggle.textContent).not.toContain("partial");
  });

  it("marks only the empty counts so they can recede", () => {
    const { container } = render(
      <IntentBar intentCheck={PRECISE} jumpToGroup={() => {}} />,
    );

    const zero = [...container.querySelectorAll("[data-zero]")].map(
      (count) => count.textContent,
    );
    expect(zero).toEqual(["0 masked fixes", "0 deviations"]);
  });

  it("starts collapsed, never auto-expands, and turns the twist on open", () => {
    render(<IntentBar intentCheck={PRECISE} jumpToGroup={() => {}} />);
    const toggle = screen.getByRole("button", { name: /intent check/i });
    expect(toggle).toHaveProperty("ariaExpanded", "false");
    const twist = toggle.querySelector('[data-icon="caret-down"]');
    expect(twist?.getAttribute("data-rotation")).toBe("270");
    // The panel exists but sits behind the `hidden` attribute until opened.
    expect(
      screen.getByText("add the widget endpoint").closest("[hidden]"),
    ).not.toBeNull();

    fireEvent.click(toggle);
    const openTwist = toggle.querySelector('[data-icon="caret-down"]');
    expect(openTwist?.hasAttribute("data-rotation")).toBe(false);
  });

  it("expands on click with no framing line, the scope note leads the panel", () => {
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
    ).toBeLessThan(body.indexOf("Ticket alignment"));
  });

  it("renders the Ticket alignment subsection in the preamble", () => {
    render(<IntentBar intentCheck={PRECISE} jumpToGroup={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /intent check/i }));
    expect(
      screen.getByRole("heading", { level: 3, name: "Ticket alignment" }),
    ).toBeTruthy();
    const link = screen.getByRole("link", {
      name: /^T-1 ?\(opens in a new tab\)$/,
    });
    expect(link.getAttribute("href")).toBe("https://tracker.example/T-1");
    expect(screen.getByText("Widget endpoint returns the list")).toBeTruthy();
    expect(screen.getByTestId("ticket-alignment-read").textContent).toBe(
      "Partial",
    );
    // The subsection precedes the split's headings and the buckets.
    const body = bodyText();
    expect(body.indexOf("Ticket alignment")).toBeLessThan(
      body.indexOf("Checks out"),
    );
    expect(body.indexOf("Ticket alignment")).toBeLessThan(
      body.indexOf("add the widget endpoint"),
    );
  });

  it("renders the unread notice inside the card and still the buckets", () => {
    const unread: IntentCheck = {
      ...PRECISE_NO_TICKET,
      primaryTicket: {
        ...PRIMARY,
        title: "",
        status: "unread",
        reason: "rate-limited",
      },
    };
    render(<IntentBar intentCheck={unread} jumpToGroup={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /intent check/i }));
    expect(screen.getByRole("status").textContent).toBe(
      "T-1 could not be read. GitHub rate-limited the read. No alignment read for this PR.",
    );
    expect(screen.getByText("add the widget endpoint")).toBeTruthy();
  });

  it("omits the subsection without a primary ticket, no linked list remains", () => {
    render(
      <IntentBar intentCheck={PRECISE_NO_TICKET} jumpToGroup={() => {}} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /intent check/i }));
    expect(screen.queryByTestId("ticket-alignment")).toBeNull();
    expect(screen.queryByText(/linked ticket/)).toBeNull();
    expect(screen.queryByText("Ticket alignment")).toBeNull();
    // `ticketUrls` is still on the wire but renders nothing on its own.
    expect(screen.queryByRole("link", { name: /T-1/ })).toBeNull();
  });

  it("renders broad sources as the quiet bar with a line and no buckets", () => {
    render(<IntentBar intentCheck={BROAD} jumpToGroup={() => {}} />);
    expect(screen.getByText(/intent check unavailable/i)).toBeTruthy();
    expect(screen.queryByText("1 accomplished")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /intent check/i }));
    // Body keeps the preamble (scope note + the card with its no-read row),
    // no buckets.
    expect(screen.getByText("parent epic spans several PRs")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: /^EPIC-9 ?\(opens in a new tab\)$/ }),
    ).toBeTruthy();
    expect(screen.getByTestId("ticket-alignment-no-read").textContent).toBe(
      "No read: the ticket scope is too broad to check against this PR",
    );
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
      name: /^Ticket ?\(opens in a new tab\)$/,
    });
    expect(linked?.getAttribute("data-color")).toBe("neutral");
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
      name: "Go to change-group g1: Add the widget endpoint and its store",
    });
    // The hover tooltip carries the same text as the accessible name.
    expect(button.getAttribute("title")).toBe(
      "Go to change-group g1: Add the widget endpoint and its store",
    );
    // A group with no known title keeps the plain label.
    const bare = screen.getByRole("button", { name: "Go to change-group g2" });
    expect(bare.getAttribute("title")).toBe("Go to change-group g2");
  });

  it("wires the go-to buttons to jumpToGroup on the TocBar path", () => {
    const jumpToGroup = vi.fn();
    render(<IntentBar intentCheck={PRECISE} jumpToGroup={jumpToGroup} />);
    fireEvent.click(screen.getByRole("button", { name: /intent check/i }));
    fireEvent.click(
      screen.getByRole("button", { name: "Go to change-group g1" }),
    );
    expect(jumpToGroup).toHaveBeenCalledWith("g1");
    fireEvent.click(
      screen.getByRole("button", { name: "Go to change-group g2" }),
    );
    expect(jumpToGroup).toHaveBeenCalledWith("g2");
  });

  it("gives every item a plain bullet, the jump is no longer the marker", () => {
    const { container } = render(
      <IntentBar intentCheck={PRECISE} jumpToGroup={() => {}} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /intent check/i }));
    const items = container.querySelectorAll("[data-intent-bar] li");
    // 3 bucket items + 1 ticket bullet, each carrying the ▪ marker.
    const marked = [...items].filter((li) => li.textContent?.includes("▪"));
    expect(marked.length).toBe(items.length);
  });

  it("labels go-to buttons with ids only on multi-group claims", () => {
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
    // Single-group buttons stay a bare ↳ with no visible id text.
    const bare = screen.getByRole("button", { name: "Go to change-group g2" });
    expect(bare.textContent).toBe("↳");
    // Multi-group claims disambiguate with a visible id per button.
    const labeled = screen.getByRole("button", {
      name: "Go to change-group g5",
    });
    expect(labeled.textContent).toBe("↳g5");
    expect(
      screen.getByRole("button", { name: "Go to change-group g6" }).textContent,
    ).toBe("↳g6");
  });

  it("labels the source: ticket, source, or the PR description", () => {
    const withLinkedPage: IntentCheck = {
      ...PRECISE,
      statedButMissing: [
        ...PRECISE.statedButMissing,
        {
          intent: "docs example",
          quote: "add a usage example",
          sourceUrl: "https://docs.example/spec",
          groupIds: [],
          acknowledged: false,
        },
      ],
    };
    render(<IntentBar intentCheck={withLinkedPage} jumpToGroup={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /intent check/i }));
    const link = screen.getAllByRole("link", {
      name: /^Ticket ?\(opens in a new tab\)$/,
    })[0];
    expect(link?.getAttribute("href")).toBe("https://tracker.example/T-1");
    const page = screen.getByRole("link", {
      name: /^Source ?\(opens in a new tab\)$/,
    });
    expect(page.getAttribute("href")).toBe("https://docs.example/spec");
    expect(link?.getAttribute("rel")).toContain("noreferrer");
    // doneButUnstated item sources from the diff: no ticket link, no attribution row.
    expect(screen.getByText("drive-by lint fix")).toBeTruthy();
  });

  it("keeps a valid source link on a warn-only item with an empty quote", () => {
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
      maskedFixes: [],
    };
    render(<IntentBar intentCheck={uncited} jumpToGroup={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /intent check/i }));
    const link = screen.getByRole("link", {
      name: /^Source ?\(opens in a new tab\)$/,
    });
    expect(link.getAttribute("href")).toBe("https://tracker.example/T-9");
  });

  it("never renders a sourceUrl off http or https as a link", () => {
    const malicious: IntentCheck = {
      ...PRECISE,
      accomplished: [
        {
          intent: "sneaky",
          quote: "click me",
          sourceUrl: "javascript:alert(1)",
          groupIds: [],
          acknowledged: false,
        },
      ],
      statedButMissing: [],
      doneButUnstated: [],
      deviations: [],
      maskedFixes: [],
    };
    render(<IntentBar intentCheck={malicious} jumpToGroup={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /intent check/i }));
    // The quote renders as text; no link is produced for the bad scheme.
    expect(screen.getByText("click me")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /source/ })).toBeNull();
  });

  it("renders quotes as text only, no markdown or HTML", () => {
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
      maskedFixes: [],
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

  it("exposes an expand handle and a landing id for the mark-ready jump", () => {
    const ref = createRef<IntentBarHandle>();
    const { container } = render(
      <IntentBar intentCheck={PRECISE} jumpToGroup={() => {}} ref={ref} />,
    );
    const toggle = screen.getByRole("button", { name: /intent check/i });
    expect(toggle).toHaveProperty("ariaExpanded", "false");
    act(() => ref.current?.expand());
    expect(toggle).toHaveProperty("ariaExpanded", "true");
    expect(container.querySelector(`#${INTENT_BAR_ID}`)).not.toBeNull();
  });

  it("closes the panel with one inference caution below the buckets", () => {
    render(<IntentBar intentCheck={PRECISE} jumpToGroup={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /intent check/i }));
    const caution = "AI-inferred. Verify against the ticket and the diff.";
    expect(screen.getAllByText(caution)).toHaveLength(1);
    const body = bodyText();
    expect(body.indexOf(caution)).toBeGreaterThan(
      body.indexOf("document the endpoint"),
    );
    expect(body.endsWith(caution)).toBe(true);
  });

  it("drops the inference caution when nothing in the panel is inferred", () => {
    const quiet: IntentCheck = { ...BROAD, scopeNote: "" };
    render(<IntentBar intentCheck={quiet} jumpToGroup={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /intent check/i }));
    expect(screen.getByTestId("ticket-alignment-no-read")).toBeTruthy();
    expect(screen.queryByText(/AI-inferred/)).toBeNull();
  });

  it("sets backtick spans in the intent check as inline code", () => {
    const withCode: IntentCheck = {
      ...PRECISE,
      scopeNote: "Stacked on `feature/base`, parent #12.",
      accomplished: [
        {
          ...PRECISE.accomplished[0]!,
          intent: "add the `GET /widgets` endpoint",
          quote: "Add a `widgets` route",
        },
      ],
    };
    const { container } = render(
      <IntentBar intentCheck={withCode} jumpToGroup={() => {}} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /intent check/i }));

    const codes = [...container.querySelectorAll("code")].map(
      (node) => node.textContent,
    );
    expect(codes).toEqual(["feature/base", "GET /widgets", "widgets"]);
    expect(screen.getByRole("note").textContent).toBe(
      "Stacked on feature/base, parent #12.",
    );
  });

  it("sets the scope note apart as a note", () => {
    render(<IntentBar intentCheck={BROAD} jumpToGroup={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /intent check/i }));
    expect(screen.getByRole("note").textContent).toBe(
      "parent epic spans several PRs",
    );
    expect(
      screen.getByText("AI-inferred. Verify against the ticket and the diff."),
    ).toBeTruthy();
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
  const toggle = screen.getByRole("button", { name: /intent check/i });
  const panelId = toggle.getAttribute("aria-controls") ?? "";
  return document.getElementById(panelId)?.textContent ?? "";
}

describe("IntentBar clamp", () => {
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

describe("IntentBar alarm buckets", () => {
  const WITH_ALARMS: IntentCheck = {
    ...PRECISE,
    deviations: [item("drops the cache the ticket asked to keep")],
    maskedFixes: [item("claims the flake is fixed but only skips it")],
  };

  it("ships the DOM in split order, Checks out first, static within a side", () => {
    render(<IntentBar intentCheck={WITH_ALARMS} jumpToGroup={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /intent check/i }));
    const body = bodyText();
    const order = [
      "Checks out",
      "Accomplished",
      "Needs a look",
      "Masked fixes",
      "Deviations",
      "Stated but missing",
      "Done but unstated",
    ].map((label) => body.indexOf(label));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect(order).toEqual(order.toSorted((a, b) => a - b));
  });

  it("exposes the heading ladder: band h2, split heads h3, buckets h4", () => {
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
      "Masked fixes",
      "Deviations",
      "Stated but missing",
      "Done but unstated",
    ]);
  });

  it("marks only the alarm headings, with the mark after the label", () => {
    render(<IntentBar intentCheck={WITH_ALARMS} jumpToGroup={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /intent check/i }));
    const marked = screen
      .getAllByRole("heading", { level: 4 })
      .filter((node) => node.querySelector(ALARM_MARK_SELECTOR) !== null);

    expect(marked.map((node) => node.textContent)).toEqual([
      "Masked fixes",
      "Deviations",
    ]);
    for (const heading of marked) {
      expect(heading.lastElementChild?.matches(ALARM_MARK_SELECTOR)).toBe(true);
      expect(heading.lastElementChild?.getAttribute("aria-hidden")).toBe(
        "true",
      );
    }
  });

  it("keeps an empty split side as information: head + quiet empty line", () => {
    const oneSided: IntentCheck = {
      ...PRECISE,
      statedButMissing: [],
      doneButUnstated: [],
    };
    render(<IntentBar intentCheck={oneSided} jumpToGroup={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /intent check/i }));
    // Both heads always render on a precise check; an empty "Needs a look"
    // is the band's best news, said out loud instead of silently dropped.
    expect(
      screen.getByRole("heading", { level: 3, name: "Checks out" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { level: 3, name: "Needs a look" }),
    ).toBeTruthy();
    expect(screen.getByText("Nothing needs a look")).toBeTruthy();
    expect(screen.queryByText("Nothing checks out")).toBeNull();

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
    expect(screen.getByText("Nothing checks out")).toBeTruthy();
    expect(screen.queryByText("Nothing needs a look")).toBeNull();
  });

  it("keeps the empty lines out of two-populated-side and broad renders", () => {
    render(<IntentBar intentCheck={WITH_ALARMS} jumpToGroup={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /intent check/i }));
    expect(screen.queryByText(/^nothing /)).toBeNull();

    cleanup();
    render(<IntentBar intentCheck={BROAD} jumpToGroup={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /intent check/i }));
    // Unavailable sources render no split body at all: no heads, no lines.
    // The Ticket alignment card's own h3 is the only level-3 heading left.
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(1);
    expect(screen.queryByText("Checks out")).toBeNull();
    expect(screen.queryByText("Needs a look")).toBeNull();
    expect(screen.queryByText(/^nothing /)).toBeNull();
  });

  it("carries one muted caution line per non-empty alarm bucket only", () => {
    render(<IntentBar intentCheck={WITH_ALARMS} jumpToGroup={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /intent check/i }));
    // Exactly two alarm buckets are non-empty here → exactly two cautions.
    expect(screen.getAllByText(/AI-inferred tension/i)).toHaveLength(2);

    cleanup();
    render(<IntentBar intentCheck={PRECISE} jumpToGroup={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /intent check/i }));
    // Neutral buckets never carry a caution; a caution with nothing under it
    // is exactly the anchoring noise the design forbids.
    expect(screen.queryByText(/AI-inferred tension/i)).toBeNull();
  });

  it("puts acknowledged deviations under Checks out, no chip, no caution", () => {
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
    // The chip is gone; the bucket label already says acknowledged.
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

  it("counts both halves of deviations in the header, the count is no alarm", () => {
    const mixed: IntentCheck = {
      ...PRECISE,
      deviations: [item("ack", true), item("unack")],
    };
    render(<IntentBar intentCheck={mixed} jumpToGroup={() => {}} />);
    expect(
      screen.getByRole("button", { name: /intent check/i }).textContent,
    ).toContain("2 deviations");
  });

  it("singularizes the deviations count", () => {
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
    expect(container.querySelector(ALARM_MARK_SELECTOR)).toBeNull();
    expect(html).not.toContain("AI-inferred tension");
    expect(html).not.toContain("Masked fixes");
    expect(html).not.toContain("Deviations acknowledged");
    // The header counts stay the neutral flat five: same class, no color,
    // no ordering.
    const counts = [...container.querySelectorAll("span")].filter((node) =>
      /^\d+ (accomplished|masked fix(?:es)?|deviations|stated but missing|done but unstated)$/.test(
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
