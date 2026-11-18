// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { RiskSurfaceAttributes } from "brief-core/types";
import { briefFixture } from "@web/features/brief/test-utils";
import { GroupViewKinds } from "../../../../../../model/utils/remainder";
import {
  buildBriefViewModel,
  type BriefViewModel,
  type GroupView,
} from "../../../../../../model/utils/view-model";
import { GroupCardHead } from ".";

const GROUP_TOTAL = 3;
const HEADING_ID = "group-head";

const attributedModel = buildBriefViewModel(briefFixture);

const carrierOnlyModel = buildBriefViewModel({
  ...briefFixture,
  unattributed: [
    {
      file: ".npmrc",
      addedRanges: [],
      removedRanges: [],
      riskSurface: [RiskSurfaceAttributes.CHANGES_PACKAGE_SOURCE],
    },
  ],
});

function findFirstGroup(model: BriefViewModel): GroupView {
  const [group] = model.groups;
  if (group === undefined) {
    throw new Error("model has no group");
  }
  return group;
}

function findRemainder(model: BriefViewModel): GroupView {
  const group = model.groups.find(
    (candidate) => candidate.kind === GroupViewKinds.UNATTRIBUTED_REMAINDER,
  );
  if (group === undefined) {
    throw new Error("model has no remainder group");
  }
  return group;
}

function readTitleLine(): HTMLElement {
  const titleLine = screen.getByRole("heading", { level: 2 }).parentElement;
  if (titleLine === null) {
    throw new Error("no title line");
  }
  return titleLine;
}

function readLineUnderTitle(): Element | null {
  return readTitleLine().nextElementSibling;
}

describe("GroupCardHead", () => {
  afterEach(cleanup);

  it("shows the position beside the title and names the group in full", () => {
    render(
      <GroupCardHead
        group={findFirstGroup(attributedModel)}
        headingId={HEADING_ID}
        total={GROUP_TOTAL}
      />,
    );

    const position = readTitleLine().lastElementChild;
    const visible = position?.querySelector('[aria-hidden="true"]');
    expect(visible?.textContent).toBe("1/3");
    expect(position?.textContent).toContain("Group 1 of 3");
  });

  it("puts the line total on a meta line under the title", () => {
    render(
      <GroupCardHead
        group={findFirstGroup(attributedModel)}
        headingId={HEADING_ID}
        total={GROUP_TOTAL}
      />,
    );

    const meta = readLineUnderTitle();
    expect(meta?.tagName).toBe("DIV");
    expect(meta?.textContent).toContain("core");
  });

  it("drops the meta line with no lines and no since marker", () => {
    render(
      <GroupCardHead
        group={findRemainder(carrierOnlyModel)}
        headingId={HEADING_ID}
        total={GROUP_TOTAL}
      />,
    );

    expect(readLineUnderTitle()?.tagName).toBe("P");
  });

  it("keeps the meta line for a since marker alone", () => {
    render(
      <GroupCardHead
        group={findRemainder(carrierOnlyModel)}
        headingId={HEADING_ID}
        sinceMarker={<span data-testid="since-marker" />}
        total={GROUP_TOTAL}
      />,
    );

    const meta = readLineUnderTitle();
    expect(meta?.contains(screen.getByTestId("since-marker"))).toBe(true);
    expect(meta?.children).toHaveLength(1);
  });
});
