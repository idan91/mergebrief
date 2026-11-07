// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ChangeGroupCategories } from "types";
import { briefFixture } from "@web/features/brief/test-utils";
import { appI18n } from "@web/i18n/I18nProvider";
import { GroupViewKinds } from "../../../../../../model/utils/remainder";
import {
  buildBriefViewModel,
  type GroupView,
} from "../../../../../../model/utils/view-model";
import { ThisPr } from ".";
import { getChunkCountsLabel } from "./GroupRow/utils";

const model = buildBriefViewModel(briefFixture);
const first = model.groups[0];
if (!first || first.kind !== GroupViewKinds.ATTRIBUTED) {
  throw new Error("fixture has no attributed group");
}
const firstName = first.group.title || first.group.summary;

describe("ThisPr", () => {
  it("lists every group as a numbered row", () => {
    render(
      <ThisPr
        activeGroupId={null}
        groups={model.groups}
        jumpToGroup={() => {}}
      />,
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(model.groups.length);
    const row = screen.getByRole("button", { name: new RegExp(firstName) });
    const chunkCounts = getChunkCountsLabel(appI18n.t, first);
    expect(row.textContent).toContain(chunkCounts);
    expect(row.textContent).toContain(`+${first.coreAdded}`);
    expect(row.textContent).toContain(`−${first.coreDeleted}`);
    expect(row.textContent).toContain("Bug fix");
  });

  it("counts core lines alone where a group has supporting chunks", () => {
    const withSupporting = {
      ...first,
      added: 90,
      deleted: 70,
      coreAdded: 5,
      coreDeleted: 3,
      supportingChunks: [...first.coreChunks],
    };
    render(
      <ThisPr
        activeGroupId={null}
        groups={[withSupporting]}
        jumpToGroup={() => {}}
      />,
    );

    const row = screen.getAllByRole("button").at(-1);
    expect(row?.textContent).toContain("+5");
    expect(row?.textContent).toContain("−3 core");
    expect(row?.textContent).not.toContain("+90");
    expect(row?.textContent).not.toContain("−70");
  });

  it("keeps an unattributed group's own total, as it has no core", () => {
    const remainder = {
      kind: GroupViewKinds.UNATTRIBUTED_REMAINDER,
      id: "remainder",
      index: 1,
      chunks: first.chunks,
      added: 12,
      deleted: 8,
    } as GroupView;
    render(
      <ThisPr
        activeGroupId={null}
        groups={[remainder]}
        jumpToGroup={() => {}}
      />,
    );

    const row = screen.getAllByRole("button").at(-1);
    expect(row?.textContent).toContain("+12");
    expect(row?.textContent).toContain("−8");
    expect(row?.textContent).not.toContain("core");
  });

  it("shows no line count on a remainder with no changed line", () => {
    const remainder = {
      kind: GroupViewKinds.UNATTRIBUTED_REMAINDER,
      id: "remainder",
      index: 1,
      chunks: first.chunks,
      added: 0,
      deleted: 0,
    } as GroupView;
    render(
      <ThisPr
        activeGroupId={null}
        groups={[remainder]}
        jumpToGroup={() => {}}
      />,
    );

    const row = screen.getAllByRole("button").at(-1);
    expect(row?.textContent).not.toContain("+0");
    expect(row?.textContent).not.toContain("−0");
  });

  it.each([
    { count: 1, facts: "1 file" },
    { count: 2, facts: "2 files" },
  ])(
    "shows $facts on an unattributed row beside its lines",
    ({ count, facts }) => {
      const chunks = first.chunks.slice(0, count);
      expect(chunks).toHaveLength(count);
      const remainder = {
        kind: GroupViewKinds.UNATTRIBUTED_REMAINDER,
        id: "remainder",
        index: 1,
        chunks,
        added: 5,
        deleted: 0,
      } as GroupView;
      render(
        <ThisPr
          activeGroupId={null}
          groups={[remainder]}
          jumpToGroup={() => {}}
        />,
      );

      const row = screen.getAllByRole("button").at(-1);
      if (row === undefined) {
        throw new Error("no remainder row");
      }
      expect(within(row).getByText(facts).textContent).toBe(facts);
    },
  );

  it("shows a move-with-edits group as move with edits", () => {
    const movedGroup = {
      ...first.group,
      dominantCategory: ChangeGroupCategories.MOVE_WITH_EDITS,
    };
    const movedBrief = { ...briefFixture, changeGroups: [movedGroup] };
    const movedModel = buildBriefViewModel(movedBrief);

    render(
      <ThisPr
        activeGroupId={null}
        groups={movedModel.groups}
        jumpToGroup={() => {}}
      />,
    );

    const row = screen.getByRole("button", { name: new RegExp(firstName) });
    expect(row.textContent).toContain("Move with edits");
    expect(row.textContent).not.toContain("with-edits");
  });

  it("marks the current row and the ones carrying conversation", () => {
    render(
      <ThisPr
        activeGroupId={first.id}
        conversationGroupIds={new Set([first.id])}
        groups={model.groups}
        jumpToGroup={() => {}}
      />,
    );
    const row = screen.getByRole("button", { name: new RegExp(firstName) });
    expect(row.getAttribute("aria-current")).toBe("true");
    expect(row.textContent).toContain("has conversation");
  });

  it("lists no chunk rows when no chunk jump is wired", () => {
    render(
      <ThisPr
        activeGroupId={null}
        groups={model.groups}
        jumpToGroup={() => {}}
      />,
    );
    expect(screen.getAllByRole("button")).toHaveLength(model.groups.length);
  });
});
