// The generation heading copy: a phase that restates the verb must not echo
// it, and "brief" is lowercase for this view.
import { describe, expect, it } from "vitest";
import { appI18n } from "../../../../../i18n/I18nProvider";

import { waitLabel } from "./WaitCard";

const t = appI18n.t;

describe("waitLabel", () => {
  it("collapses the verb-echo phase to the phase-less heading", () => {
    expect(waitLabel(t, "running", "generating")).toBe("Generating the brief…");
  });

  it("uses the phase-less heading when there is no phase", () => {
    expect(waitLabel(t, "running", null)).toBe("Generating the brief…");
  });

  it("shows a distinct phase (kebab normalized) after the em dash", () => {
    expect(waitLabel(t, "running", "writing")).toBe(
      "Generating the brief — writing…",
    );
    expect(waitLabel(t, "running", "reading-diff")).toBe(
      "Generating the brief — reading diff…",
    );
  });

  it("keeps informative phases that merely CONTAIN the verb", () => {
    // Only the exact echo collapses — a substring match would eat
    // "generating-summary", which is real signal.
    expect(waitLabel(t, "running", "generating-summary")).toBe(
      "Generating the brief — generating summary…",
    );
    // Case-insensitive exact echo still collapses.
    expect(waitLabel(t, "running", "Generating")).toBe("Generating the brief…");
  });

  it("lowercases the artifact noun mid-sentence in the queued heading", () => {
    expect(waitLabel(t, "queued", null)).toBe(
      "Queued — the brief will start generating shortly.",
    );
  });

  it("a queued notice replaces the misleading 'shortly' heading", () => {
    expect(waitLabel(t, "queued", null, "Queued — draft mode note.")).toBe(
      "Queued — draft mode note.",
    );
  });

  it("a queued notice never touches the running heading", () => {
    expect(waitLabel(t, "running", null, "Queued — draft mode note.")).toBe(
      "Generating the brief…",
    );
  });
});
