import type { PrimaryTicket } from "brief-core/types";
import { describe, expect, it } from "vitest";

import { deriveTicketFacts } from "./utils";

const TICKET: PrimaryTicket = {
  key: "BRIEF-350",
  url: "https://app.notion.com/p/3fc5e9400eeb8141b1e2cf2245396aee",
  tracker: "notion",
  foundIn: "title",
  title: "Rename the bucket",
  header: "",
  status: "read",
  reason: "",
};

const GITHUB_TICKET: Partial<PrimaryTicket> = {
  key: "",
  url: "https://github.com/acme/widget/issues/7",
  tracker: "github",
};

function stubTicket(header: string, overrides: Partial<PrimaryTicket> = {}) {
  return { ...TICKET, ...overrides, header };
}

describe("deriveTicketFacts", () => {
  it("drops the leading title and trailing key a Notion header repeats", () => {
    const ticket = stubTicket(
      "Rename the bucket · In review · Chore · BRIEF-350",
    );
    expect(deriveTicketFacts(ticket)).toBe("In review · Chore");
  });

  it("drops the leading title a GitHub header opens with", () => {
    const ticket = stubTicket("Stop the retry loop · open · bug · v1", {
      ...GITHUB_TICKET,
      title: "Stop the retry loop",
    });
    expect(deriveTicketFacts(ticket)).toBe("open · bug · v1");
  });

  it("drops a title that carries the separator as one piece", () => {
    const ticket = stubTicket("A · B · open", {
      ...GITHUB_TICKET,
      title: "A · B",
    });
    expect(deriveTicketFacts(ticket)).toBe("open");
  });

  it("passes a titleless GitHub header through untouched", () => {
    const ticket = stubTicket("open · bug, ui · v1.2", { tracker: "github" });
    expect(deriveTicketFacts(ticket)).toBe("open · bug, ui · v1.2");
  });

  it("returns nothing when the header only repeats the title and key", () => {
    expect(deriveTicketFacts(stubTicket("Rename the bucket · BRIEF-350"))).toBe(
      "",
    );
    expect(deriveTicketFacts(stubTicket("Rename the bucket"))).toBe("");
  });

  it("keeps a header piece that only starts with the title text", () => {
    const ticket = stubTicket("Rename the bucketing · In review");
    expect(deriveTicketFacts(ticket)).toBe("Rename the bucketing · In review");
  });

  it("keeps the header whole when the ticket has no title or key", () => {
    const ticket = stubTicket("In review · Chore", { title: "", key: "" });
    expect(deriveTicketFacts(ticket)).toBe("In review · Chore");
  });
});
