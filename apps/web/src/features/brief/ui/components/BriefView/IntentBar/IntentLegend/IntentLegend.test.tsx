// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { IconNames } from "@web/components/Icon/types";
import { IntentLegend } from ".";

const ALARM_MARK_SELECTOR = `[data-icon="${IconNames.WARNING_DIAMOND}"]`;

afterEach(cleanup);

function getTrigger(): HTMLElement {
  return screen.getByRole("button", { name: "What these mean" });
}

async function openLegend(): Promise<HTMLElement> {
  const trigger = getTrigger();
  trigger.focus();
  await act(async () => {
    fireEvent.click(trigger);
  });
  return trigger;
}

function getPanel(trigger: HTMLElement): HTMLElement {
  const panelId = trigger.getAttribute("aria-controls") ?? "";
  const panel = document.getElementById(panelId);
  if (panel === null) {
    throw new Error("legend panel not rendered");
  }
  return panel;
}

describe("IntentLegend", () => {
  it("starts closed behind a labelled disclosure button", () => {
    render(<IntentLegend />);

    expect(getTrigger().getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("What each bucket means")).toBeNull();
  });

  it("opens on click into a section named by its heading", async () => {
    render(<IntentLegend />);

    const trigger = await openLegend();

    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(trigger);
    const section = getPanel(trigger).querySelector("section");
    const headingId = section?.getAttribute("aria-labelledby") ?? "";
    const heading = document.getElementById(headingId);
    expect(heading?.tagName).toBe("H2");
    expect(heading?.textContent).toBe("What each bucket means");
  });

  it("lists the five buckets as term and definition pairs in count order", async () => {
    render(<IntentLegend />);

    const panel = getPanel(await openLegend());

    const terms = [...panel.querySelectorAll("dt")].map(
      (term) => term.textContent,
    );
    expect(terms).toEqual([
      "Accomplished",
      "Masked fixes",
      "Deviations",
      "Stated but missing",
      "Done but unstated",
    ]);
    const definitions = panel.querySelectorAll("dd");
    expect(definitions).toHaveLength(terms.length);
    expect(definitions[1]?.textContent).toBe(
      "Claimed fixed, but the diff only silences the signal (a log, a test, an alert), not the cause.",
    );
  });

  it("marks only the alarm terms, after the label", async () => {
    render(<IntentLegend />);

    const panel = getPanel(await openLegend());

    const marked = [...panel.querySelectorAll("dt")].filter(
      (term) => term.querySelector(ALARM_MARK_SELECTOR) !== null,
    );
    expect(marked.map((term) => term.textContent)).toEqual([
      "Masked fixes",
      "Deviations",
    ]);
    for (const term of marked) {
      const mark = term.lastElementChild;
      expect(mark?.matches(ALARM_MARK_SELECTOR)).toBe(true);
      expect(mark?.getAttribute("role")).toBe("img");
      expect(mark?.getAttribute("aria-label")).toBe("Warning diamond");
    }
  });

  it("explains the mark in a footer whose mark has an accessible name", async () => {
    render(<IntentLegend />);

    const panel = getPanel(await openLegend());

    const marks = screen.getAllByRole("img", { name: "Warning diamond" });
    const footerMark = marks.at(-1);
    if (footerMark === undefined) {
      throw new Error("footer mark not rendered");
    }
    expect(panel.contains(footerMark)).toBe(true);
    expect(footerMark.closest("p")?.textContent).toContain(
      "Marks a possible conflict between what the PR says and what the diff does.",
    );
  });

  it("closes on Escape and keeps focus on the trigger", async () => {
    render(<IntentLegend />);
    const trigger = await openLegend();

    await act(async () => {
      fireEvent.keyDown(trigger, { key: "Escape" });
    });

    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger);
  });
});
