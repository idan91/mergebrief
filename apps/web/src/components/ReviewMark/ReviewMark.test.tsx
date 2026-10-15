// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { InboxReviewStates } from "types/inbox";
import { describe, expect, it } from "vitest";

import { ReviewMark } from ".";

const DRAWINGS = [
  [InboxReviewStates.NEW, "circle"],
  [InboxReviewStates.IN_PROGRESS, "circle-half"],
  [InboxReviewStates.UPDATED, "record"],
  [InboxReviewStates.REVIEWED, "check-circle"],
] as const;

describe("ReviewMark", () => {
  it("draws each review state with its own mark, hidden from readers", () => {
    for (const [state, drawing] of DRAWINGS) {
      const { container, unmount } = render(<ReviewMark state={state} />);
      const svg = container.querySelector("svg");

      expect(svg?.getAttribute("data-icon")).toBe(drawing);
      expect(svg?.getAttribute("aria-hidden")).toBe("true");
      unmount();
    }
  });
});
