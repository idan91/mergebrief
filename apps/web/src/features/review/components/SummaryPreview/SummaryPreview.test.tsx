// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Roles, type Brief } from "@web/features/brief/types";
import { briefFixture } from "@web/features/brief/utils/fixtures";
import { I18nProvider } from "@web/i18n/I18nProvider";
import type { SessionSnapshot } from "../../session";
import { SummaryPreview } from "./SummaryPreview";

afterEach(cleanup);

function remainderBrief(): Brief {
  return {
    ...briefFixture,
    unattributed: [
      {
        file: "src/orphan.ts",
        addedRanges: [{ start: 1, end: 3 }],
        removedRanges: [{ start: 2, end: 2 }],
      },
    ],
  };
}

function snapshot(): SessionSnapshot {
  return {
    briefId: "fixture-brief-1",
    dispositions: {},
    dominants: { g1: "bugfix" },
    reclassifiedGroupIds: [],
    reviewedChunkIds: [],
    reviewComments: [],
    reviewOutcome: "comment",
  };
}

function metricValue(label: string): string {
  const dt = screen.getByText(label);
  const dd = dt.parentElement?.querySelector("dd");
  if (dd === null || dd === undefined) {
    throw new Error(`missing dd for ${label}`);
  }
  return dd.textContent ?? "";
}

describe("SummaryPreview remainder totals", () => {
  it("lets chunks reviewed exceed core plus supporting when a remainder exists", () => {
    render(
      <I18nProvider>
        <SummaryPreview brief={remainderBrief()} snapshot={snapshot()} />
      </I18nProvider>,
    );

    expect(metricValue("Chunks reviewed")).toBe("0/3");
    expect(metricValue("Core chunks")).toBe("0/1");
    expect(metricValue("Supporting chunks")).toBe("0/1");

    const brief = remainderBrief();
    const coreCount = brief.chunks.filter(
      (chunk) => chunk.role === Roles.CORE,
    ).length;
    const supportingCount = brief.chunks.filter(
      (chunk) => chunk.role === Roles.SUPPORTING,
    ).length;
    expect(coreCount + supportingCount).toBe(2);
  });
});
