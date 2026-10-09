// @vitest-environment jsdom
import type {
  PrimaryTicket,
  TicketAlignment as Alignment,
} from "brief-core/types";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { TicketAlignment } from ".";

afterEach(cleanup);

const READ_TICKET: PrimaryTicket = {
  key: "BRIEF-88",
  url: "https://app.notion.com/p/3a95e9400eeb80f4a1b2c3d4e5f60788",
  tracker: "notion",
  foundIn: "description",
  title: "Scrub URL-shaped secrets once, in the logging seam",
  header: "Status: In progress · Type: Backend",
  status: "read",
  reason: "",
};

const ALIGNED: Alignment = {
  read: "aligned",
  goal: "Every logged error must have URL-embedded credentials masked before it reaches the transport.",
  response:
    "The diff adds that serializer in the shared logging package and moves the call sites onto it.",
};

const LINK_NAME = /^BRIEF-88 ?\(opens in a new tab\)$/;

describe("TicketAlignment", () => {
  it("renders the full card for a read ticket with an alignment read", () => {
    render(
      <TicketAlignment
        alignment={ALIGNED}
        primaryTicket={READ_TICKET}
        specificity="precise"
      />,
    );

    expect(
      screen.getByRole("heading", { level: 3, name: "Ticket alignment" }),
    ).toBeTruthy();
    expect(screen.getByText("Notion")).toBeTruthy();
    const link = screen.getByRole("link", { name: LINK_NAME });
    expect(link.getAttribute("href")).toBe(READ_TICKET.url);
    expect(link.getAttribute("rel")).toBe("noreferrer");
    expect(screen.getByText(READ_TICKET.title)).toBeTruthy();
    expect(screen.getByText(READ_TICKET.header)).toBeTruthy();
    expect(screen.getByText("Ticket asks")).toBeTruthy();
    expect(screen.getByText(ALIGNED.goal).tagName).toBe("Q");
    expect(screen.getByText("This PR")).toBeTruthy();
    expect(screen.getByTestId("ticket-alignment-read").textContent).toBe(
      "Aligned",
    );
    expect(
      screen.getByTestId("ticket-alignment-read").nextElementSibling
        ?.textContent,
    ).toBe(ALIGNED.response);
    expect(screen.getByText(/The diff adds that serializer/)).toBeTruthy();
    expect(
      screen.getByText(
        "AI-inferred read — verify against the ticket and the diff",
      ),
    ).toBeTruthy();
    expect(screen.getByText("referenced in the PR description")).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("renders the read word as plain text without colour or state hook", () => {
    render(
      <TicketAlignment
        alignment={{ ...ALIGNED, read: "misaligned" }}
        primaryTicket={READ_TICKET}
        specificity="precise"
      />,
    );

    const word = screen.getByTestId("ticket-alignment-read");
    expect(word.textContent).toBe("Misaligned");
    expect(word.getAttribute("data-state")).toBeNull();
    expect(word.getAttribute("data-color")).toBeNull();
    expect(word.getAttribute("data-variant")).toBeNull();
    expect(word.classList.length).toBe(1);
    expect(word.querySelector("*")).toBeNull();
    expect(word.parentElement?.tagName).toBe("DD");
    expect(word.nextElementSibling?.textContent).toMatch(/^The diff/);
  });

  it("says the goal could not be checked when a precise check has no read", () => {
    render(
      <TicketAlignment
        alignment={undefined}
        primaryTicket={READ_TICKET}
        specificity="precise"
      />,
    );
    expect(screen.getByTestId("ticket-alignment-no-read").textContent).toBe(
      "no read — the ticket states no goal to check this PR against",
    );
  });

  it("never blames the scope when the sources carried no stated intent", () => {
    render(
      <TicketAlignment
        alignment={undefined}
        primaryTicket={READ_TICKET}
        specificity="none"
      />,
    );
    expect(screen.getByTestId("ticket-alignment-no-read").textContent).toBe(
      "no read — the ticket states no goal to check this PR against",
    );
  });

  it("keeps the card and says no read when the read is absent", () => {
    render(
      <TicketAlignment
        alignment={undefined}
        primaryTicket={READ_TICKET}
        specificity="broad"
      />,
    );

    expect(screen.getByRole("link", { name: LINK_NAME })).toBeTruthy();
    expect(screen.getByText(READ_TICKET.header)).toBeTruthy();
    expect(screen.getByText("This PR")).toBeTruthy();
    expect(screen.getByTestId("ticket-alignment-no-read").textContent).toBe(
      "no read — the ticket scope is too broad to check against this PR",
    );
    expect(screen.queryByText("Ticket asks")).toBeNull();
    expect(screen.queryByTestId("ticket-alignment-read")).toBeNull();
    expect(screen.queryByText(/AI-inferred read/)).toBeNull();
    expect(screen.getByText("referenced in the PR description")).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("renders an amber notice for an unread ticket without a This PR row", () => {
    const unread: PrimaryTicket = {
      ...READ_TICKET,
      title: "",
      header: "",
      status: "unread",
      reason: "not-found",
      foundIn: "branch",
    };
    render(
      <TicketAlignment
        alignment={undefined}
        primaryTicket={unread}
        specificity="precise"
      />,
    );

    const notice = screen.getByRole("status");
    expect(notice.getAttribute("data-testid")).toBe("ticket-alignment-notice");
    expect(notice.textContent).toBe(
      "BRIEF-88 could not be read. Notion returned not found — the page was moved, or the integration has no access to it. No alignment read for this PR.",
    );
    expect(notice.querySelector("b")?.textContent).toBe(
      "BRIEF-88 could not be read.",
    );
    expect(screen.getByRole("link", { name: LINK_NAME })).toBeTruthy();
    expect(screen.queryByText("This PR")).toBeNull();
    expect(screen.queryByText("Ticket asks")).toBeNull();
    expect(screen.queryByText(/AI-inferred read/)).toBeNull();
    expect(screen.getByText("referenced in the branch name")).toBeTruthy();
  });

  it("names the tracker in the reason sentence from the ticket's tracker", () => {
    const unread: PrimaryTicket = {
      ...READ_TICKET,
      tracker: "github",
      title: "",
      header: "",
      status: "unread",
      reason: "no-credential",
    };
    render(
      <TicketAlignment
        alignment={undefined}
        primaryTicket={unread}
        specificity="precise"
      />,
    );

    expect(screen.getByRole("status").textContent).toContain(
      "GitHub refused the read — no credential is configured for it on this deployment.",
    );
    expect(screen.getByText("GitHub")).toBeTruthy();
  });

  it("a URL-only reference links its title and hides the separate title", () => {
    const urlOnly: PrimaryTicket = { ...READ_TICKET, key: "" };
    render(
      <TicketAlignment
        alignment={ALIGNED}
        primaryTicket={urlOnly}
        specificity="precise"
      />,
    );

    const link = screen.getByRole("link", {
      name: /^Scrub URL-shaped secrets once, in the logging seam ?\(opens in a new tab\)$/,
    });
    expect(link.getAttribute("href")).toBe(READ_TICKET.url);
    expect(screen.getAllByText(READ_TICKET.title)).toHaveLength(1);
  });

  it("uses the URL as link text and subject when key and title are empty", () => {
    const urlOnlyUnread: PrimaryTicket = {
      ...READ_TICKET,
      key: "",
      title: "",
      header: "",
      status: "unread",
      reason: "timeout",
    };
    render(
      <TicketAlignment
        alignment={undefined}
        primaryTicket={urlOnlyUnread}
        specificity="precise"
      />,
    );

    expect(
      screen.getByRole("link", { name: new RegExp(`^${READ_TICKET.url}`) }),
    ).toBeTruthy();
    expect(screen.getByRole("status").textContent).toMatch(
      new RegExp(`^${READ_TICKET.url} could not be read\\.`),
    );
  });

  it("omits the tracker header line when it is empty", () => {
    render(
      <TicketAlignment
        alignment={ALIGNED}
        primaryTicket={{ ...READ_TICKET, header: "" }}
        specificity="precise"
      />,
    );

    expect(screen.queryByText(/Status: In progress/)).toBeNull();
  });

  it("renders the key as plain text for a non-http ticket URL", () => {
    const sneaky: PrimaryTicket = {
      ...READ_TICKET,
      url: "javascript:alert(1)",
    };
    render(
      <TicketAlignment
        alignment={ALIGNED}
        primaryTicket={sneaky}
        specificity="precise"
      />,
    );

    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("BRIEF-88")).toBeTruthy();
  });

  it("maps every found-in location to its own line", () => {
    render(
      <TicketAlignment
        alignment={ALIGNED}
        primaryTicket={{ ...READ_TICKET, foundIn: "title" }}
        specificity="precise"
      />,
    );

    expect(screen.getByText("referenced in the PR title")).toBeTruthy();
  });
});
