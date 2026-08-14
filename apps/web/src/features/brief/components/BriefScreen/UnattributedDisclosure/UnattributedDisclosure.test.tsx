// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { UnattributedView } from "../../../utils/viewModel";
import { UnattributedDisclosure } from "./UnattributedDisclosure";

afterEach(cleanup);

const view: UnattributedView = {
  files: [
    {
      file: "src/orphan.ts",
      addedRanges: [{ start: 3, end: 6 }],
      removedRanges: [],
      added: 4,
      deleted: 0,
    },
    {
      file: "src/other.ts",
      addedRanges: [],
      removedRanges: [{ start: 9, end: 10 }],
      added: 0,
      deleted: 2,
    },
  ],
  added: 4,
  deleted: 2,
};

function renderDisclosure() {
  return render(<UnattributedDisclosure totalChanged={120} view={view} />);
}

describe("UnattributedDisclosure", () => {
  it("renders a closed trigger named by the lowercase label and counts", () => {
    renderDisclosure();
    const trigger = screen.getByTestId("unattributed-disclosure");
    expect(trigger.dataset["state"]).toBe("closed");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(trigger.textContent).toContain("unattributed");
    expect(trigger.textContent).toContain("+4");
    expect(trigger.textContent).toContain("−2");
  });

  it("opens on click with the per-file rows and the attributed-of-total caveat", () => {
    renderDisclosure();
    const trigger = screen.getByTestId("unattributed-disclosure");
    fireEvent.click(trigger);
    expect(trigger.dataset["state"]).toBe("open");
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("src/orphan.ts")).toBeTruthy();
    expect(screen.getByText("src/other.ts")).toBeTruthy();
    // attributed = 120 total − 6 unattributed
    expect(screen.getByText(/attributed 114 of 120/)).toBeTruthy();
    const panelId = trigger.getAttribute("aria-describedby");
    expect(panelId).toBeTruthy();
  });

  it("closes on Escape at capture", () => {
    renderDisclosure();
    const trigger = screen.getByTestId("unattributed-disclosure");
    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(trigger.dataset["state"]).toBe("closed");
  });
});
