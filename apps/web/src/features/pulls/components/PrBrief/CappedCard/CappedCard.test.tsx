// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CappedCard } from "./CappedCard";
import { capResetsAt, cappedLabel } from "./utils";

afterEach(cleanup);

describe("capResetsAt", () => {
  it("is the first UTC midnight after the skip", () => {
    expect(capResetsAt("2026-08-03T18:30:00.000Z")?.toISOString()).toBe(
      "2026-08-04T00:00:00.000Z",
    );
  });

  it("rolls a last-millisecond skip into the next day, not two days on", () => {
    expect(capResetsAt("2026-08-03T23:59:59.999Z")?.toISOString()).toBe(
      "2026-08-04T00:00:00.000Z",
    );
  });

  it("returns undefined for an unparsable timestamp", () => {
    expect(capResetsAt("not-a-date")).toBeUndefined();
  });
});

describe("cappedLabel", () => {
  it("names a reset time still in the future", () => {
    const label = cappedLabel(
      "2026-08-03T18:30:00.000Z",
      new Date("2026-08-03T19:00:00.000Z"),
    );
    expect(label).toContain("Daily generation cap reached — resumes ");
  });

  it("says generation has resumed once the window rolled over", () => {
    // A stale capped row must not promise a reset time that already passed.
    const label = cappedLabel(
      "2026-08-01T18:30:00.000Z",
      new Date("2026-08-03T09:00:00.000Z"),
    );
    expect(label).toBe(
      "Daily generation cap reached — generation has since resumed.",
    );
  });

  it("degrades without a time rather than printing Invalid Date", () => {
    expect(cappedLabel("nonsense")).toBe("Daily generation cap reached.");
  });
});

describe("CappedCard", () => {
  it("renders the cap heading and says the push is not retried on its own", () => {
    render(<CappedCard cappedAt="2026-08-03T18:30:00.000Z" />);
    expect(
      screen.getByRole("heading", { name: /daily generation cap reached/i }),
    ).toBeDefined();
    expect(screen.getByTestId("brief-capped-card").textContent).toContain(
      "will not be picked up again on its own",
    );
  });
});
