// The generation heading copy (BRIEF-43 UX follow-up): a phase that restates
// the verb must not echo it, and "brief" is lowercase for this view.
import { describe, expect, it } from "vitest";

import { emptyCardCopy, waitLabel } from "./PrBriefStates";

describe("waitLabel", () => {
  it("collapses the verb-echo phase to the phase-less heading", () => {
    expect(waitLabel("running", "generating")).toBe("Generating the brief…");
  });

  it("uses the phase-less heading when there is no phase", () => {
    expect(waitLabel("running", null)).toBe("Generating the brief…");
  });

  it("shows a distinct phase (kebab normalized) after the em dash", () => {
    expect(waitLabel("running", "writing")).toBe(
      "Generating the brief — writing…",
    );
    expect(waitLabel("running", "reading-diff")).toBe(
      "Generating the brief — reading diff…",
    );
  });

  it("keeps informative phases that merely CONTAIN the verb (round 3 #3)", () => {
    // Only the exact echo collapses — a substring match would eat
    // "generating-summary", which is real signal.
    expect(waitLabel("running", "generating-summary")).toBe(
      "Generating the brief — generating summary…",
    );
    // Case-insensitive exact echo still collapses.
    expect(waitLabel("running", "Generating")).toBe("Generating the brief…");
  });

  it("lowercases the artifact noun mid-sentence in the queued heading", () => {
    expect(waitLabel("queued", null)).toBe(
      "Queued — the brief will start generating shortly.",
    );
  });
});

describe("draft-policy notice surfaces (BRIEF-64)", () => {
  it("WaitCard: a queued notice replaces the misleading 'shortly' heading", () => {
    expect(waitLabel("queued", null, "Queued — draft mode note.")).toBe(
      "Queued — draft mode note.",
    );
  });

  it("WaitCard: a queued notice never touches the running heading", () => {
    expect(waitLabel("running", null, "Queued — draft mode note.")).toBe(
      "Generating the brief…",
    );
  });

  it("EmptyCard copy override is exported for the drafts-off state", () => {
    expect(emptyCardCopy(undefined)).toContain("next push");
    expect(emptyCardCopy("Drafts are off.")).toBe("Drafts are off.");
  });
});
