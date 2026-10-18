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

  it("passes a GitHub header through untouched", () => {
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
