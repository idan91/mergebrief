// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BarGroup } from ".";
import { CollapsibleBar } from "..";
import { BarHeadingLevels } from "../types";

afterEach(cleanup);

describe("BarGroup", () => {
  it("holds its bars as rows of one surface, in order", () => {
    render(
      <BarGroup testId="folds">
        <CollapsibleBar
          headingLevel={BarHeadingLevels.H2}
          open={false}
          title="Original description"
          onToggle={vi.fn()}
        >
          <p>Body</p>
        </CollapsibleBar>
        {null}
        <CollapsibleBar
          headingLevel={BarHeadingLevels.H2}
          open={false}
          title="Conversation"
          onToggle={vi.fn()}
        >
          <p>Body</p>
        </CollapsibleBar>
      </BarGroup>,
    );

    const rows = [...screen.getByTestId("folds").children];
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain("Original description");
    expect(rows[1]?.textContent).toContain("Conversation");
  });
});
