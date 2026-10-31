// @vitest-environment jsdom
import { useState } from "react";
import { appI18n } from "@web/i18n/I18nProvider";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Disposition } from "@web/features/review/session";
import { briefFixture } from "@web/features/brief/test-utils";
import type { Brief, BriefChunk } from "../../../../../../model/types";
import {
  getRiskAttributeInlineLabel,
  getRiskAttributeLabel,
  buildBriefViewModel,
  isAttributedGroupView,
  type AttributedGroupView,
  type RiskFlag,
} from "../../../../../../model/utils/view-model";
import {
  createReadingPositionStore,
  ReadingPositionProvider,
} from "../../../reading/reading-position";
import { RiskSurface } from ".";

const DISMISSED: Disposition = {
  kind: "dismissed",
  reason: "not applicable here",
};
const ADDRESSED: Disposition = { kind: "addressed" };

function requireAttributed(brief: Brief): {
  group: AttributedGroupView;
  flags: RiskFlag[];
} {
  const model = buildBriefViewModel(brief);
  const group = model.groups[0];
  if (group === undefined || !isAttributedGroupView(group)) {
    throw new Error("expected an attributed group");
  }
  return {
    group,
    flags: model.flagsByGroup.get(group.id) ?? [],
  };
}

function renderSurface(
  brief: Brief,
  options: {
    dispositions?: Record<string, Disposition | undefined>;
    flagsReadOnly?: boolean;
    selectedFlagSet?: Set<string>;
    toggleRiskGroup?: (flagIds: readonly string[]) => void;
    jumpToChunk?: (chunkId: string) => void;
    reopenFlag?: (flag: RiskFlag) => void;
  } = {},
) {
  const { group, flags } = requireAttributed(brief);
  const toggleRiskGroup = options.toggleRiskGroup ?? vi.fn();
  const jumpToChunk = options.jumpToChunk ?? vi.fn();
  const reopenFlag = options.reopenFlag ?? vi.fn();
  render(
    <RiskSurface
      dispositions={options.dispositions ?? {}}
      flagsReadOnly={options.flagsReadOnly ?? false}
      group={group}
      groupFlags={flags}
      jumpToChunk={jumpToChunk}
      reopenFlag={reopenFlag}
      selectedFlagSet={options.selectedFlagSet ?? new Set()}
      setDismissTarget={vi.fn()}
      setEvidenceTarget={vi.fn()}
      toggleRiskGroup={toggleRiskGroup}
    />,
  );
  return { flags, toggleRiskGroup, jumpToChunk, reopenFlag };
}

function twoChunkSamePathBrief(): Brief {
  const core = briefFixture.chunks[0];
  if (core === undefined) {
    throw new Error("fixture missing core chunk");
  }
  const second: BriefChunk = {
    ...core,
    id: "chunk-c",
    file: core.file,
    riskSurface: ["dense-logic"],
    summary: "Second chunk on the same path.",
  };
  return {
    ...briefFixture,
    chunks: [core, second, ...briefFixture.chunks.slice(1)],
  };
}

describe("RiskSurface chooser", () => {
  it("shows Risk surface with file and flag counts", () => {
    renderSurface(briefFixture);
    expect(
      screen.getByRole("heading", {
        name: appI18n.t("brief.group.riskSurface"),
      }),
    ).toBeTruthy();
    expect(screen.getByText("1 file")).toBeTruthy();
    expect(screen.getByText("2 flags")).toBeTruthy();
    expect(screen.queryByText(/attributes, not verdicts/)).toBeNull();
  });

  it("keeps one row when two chunks share a path", () => {
    renderSurface(twoChunkSamePathBrief());
    expect(screen.getAllByRole("button", { name: "src/leak.ts" })).toHaveLength(
      1,
    );
    expect(screen.getByText("1 file")).toBeTruthy();
    expect(screen.getByText("3 flags")).toBeTruthy();
  });

  it("hides Address and Dismiss until a file is selected", () => {
    renderSurface(briefFixture);
    expect(
      screen.queryByRole("button", { name: "Address selected" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Dismiss selected…" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Addressed" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Dismiss…" })).toBeNull();
  });

  it("selects every open flag on the file", () => {
    const { flags, toggleRiskGroup } = renderSurface(briefFixture);
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Select flags on src/leak.ts" }),
    );
    expect(toggleRiskGroup).toHaveBeenCalledWith(flags.map((flag) => flag.id));
  });

  it("notes twist starts closed and reveals labeled notes", () => {
    renderSurface(briefFixture);
    expect(screen.queryByText(/Comment says the param is optional/)).toBeNull();
    const twist = screen.getByRole("button", { name: "Risk notes" });
    expect(twist.getAttribute("aria-expanded")).toBe("false");
    const caret = twist.querySelector('[data-icon="caret-down"]');
    expect(caret?.getAttribute("data-rotation")).toBe("270");
    fireEvent.click(twist);
    expect(twist.getAttribute("aria-expanded")).toBe("true");
    expect(caret?.hasAttribute("data-rotation")).toBe(false);
    expect(screen.getByText(/Comment says the param is optional/)).toBeTruthy();
  });

  it("mixed file stays open with dimmed resolved chips", () => {
    const { flags } = requireAttributed(briefFixture);
    const dismissed = flags[0];
    if (dismissed === undefined) {
      throw new Error("expected a flag");
    }
    renderSurface(briefFixture, {
      dispositions: { [dismissed.id]: DISMISSED },
    });
    expect(screen.getByRole("button", { name: "src/leak.ts" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "1 resolved" })).toBeNull();
    expect(document.querySelector("[data-resolved]")).not.toBeNull();
  });

  it("offers Reopen on a dismissed chip in a mixed file", () => {
    const { flags } = requireAttributed(briefFixture);
    const dismissed = flags[0];
    const open = flags[1];
    if (dismissed === undefined || open === undefined) {
      throw new Error("expected two flags");
    }
    const reopen = vi.fn();
    renderSurface(briefFixture, {
      dispositions: { [dismissed.id]: DISMISSED },
      reopenFlag: reopen,
    });
    const reopenDismissedName = `Reopen the ${getRiskAttributeInlineLabel(appI18n.t, dismissed.attr)} risk on ${dismissed.file}`;
    fireEvent.click(
      screen.getByRole("button", {
        name: reopenDismissedName,
      }),
    );
    expect(reopen).toHaveBeenCalledWith(dismissed);
    const reopenOpenName = `Reopen the ${getRiskAttributeInlineLabel(appI18n.t, open.attr)} risk on ${open.file}`;
    expect(
      screen.queryByRole("button", {
        name: reopenOpenName,
      }),
    ).toBeNull();
  });

  it("keeps Reopen on remaining dismissed after one reopens", () => {
    const { group, flags } = requireAttributed(briefFixture);
    const first = flags[0];
    const second = flags[1];
    if (first === undefined || second === undefined) {
      throw new Error("expected two flags");
    }
    const firstFlag: RiskFlag = first;
    const secondFlag: RiskFlag = second;
    function Harness() {
      const [dispositions, setDispositions] = useState<
        Record<string, Disposition | undefined>
      >({
        [firstFlag.id]: DISMISSED,
        [secondFlag.id]: DISMISSED,
      });
      return (
        <RiskSurface
          dispositions={dispositions}
          flagsReadOnly={false}
          group={group}
          groupFlags={flags}
          jumpToChunk={vi.fn()}
          reopenFlag={(flag) => {
            setDispositions((current) => {
              const next = { ...current };
              delete next[flag.id];
              return next;
            });
          }}
          selectedFlagSet={new Set()}
          setDismissTarget={vi.fn()}
          setEvidenceTarget={vi.fn()}
          toggleRiskGroup={vi.fn()}
        />
      );
    }
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "1 resolved" }));
    const reopenFirstFlagName = `Reopen the ${getRiskAttributeInlineLabel(appI18n.t, firstFlag.attr)} risk on ${firstFlag.file}`;
    fireEvent.click(
      screen.getByRole("button", {
        name: reopenFirstFlagName,
      }),
    );
    expect(screen.queryByRole("button", { name: "1 resolved" })).toBeNull();
    expect(screen.getByRole("button", { name: "src/leak.ts" })).toBeTruthy();
    const reopenSecondFlagName = `Reopen the ${getRiskAttributeInlineLabel(appI18n.t, secondFlag.attr)} risk on ${secondFlag.file}`;
    fireEvent.click(
      screen.getByRole("button", {
        name: reopenSecondFlagName,
      }),
    );
    expect(screen.queryByRole("button", { name: /^Reopen the/ })).toBeNull();
  });

  it("resolved files leave the open list into a fold", () => {
    const { flags } = requireAttributed(briefFixture);
    const dispositions: Record<string, Disposition | undefined> = {};
    for (const flag of flags) {
      dispositions[flag.id] = DISMISSED;
    }
    renderSurface(briefFixture, { dispositions });
    expect(screen.queryByRole("button", { name: "src/leak.ts" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "1 resolved" }));
    expect(screen.getByRole("button", { name: "src/leak.ts" })).toBeTruthy();
  });

  it("resolved fold chips keep the catalog callout", () => {
    const { flags } = requireAttributed(briefFixture);
    const dispositions: Record<string, Disposition | undefined> = {};
    for (const flag of flags) {
      dispositions[flag.id] = DISMISSED;
    }
    renderSurface(briefFixture, { dispositions });
    fireEvent.click(screen.getByRole("button", { name: "1 resolved" }));
    const sample = flags[0];
    if (sample === undefined) {
      throw new Error("expected a flag");
    }
    const attributeLabel = getRiskAttributeLabel(appI18n.t, sample.attr);
    fireEvent.click(screen.getByRole("button", { name: attributeLabel }));
    expect(screen.getByText(appI18n.t("brief.risk.noTests"))).toBeTruthy();
  });

  it("reopen is only on dismissed flags", () => {
    const { flags } = requireAttributed(briefFixture);
    const dismissed = flags[0];
    const addressed = flags[1];
    if (dismissed === undefined || addressed === undefined) {
      throw new Error("expected two flags");
    }
    const reopenFlag = vi.fn();
    renderSurface(briefFixture, {
      dispositions: {
        [dismissed.id]: DISMISSED,
        [addressed.id]: ADDRESSED,
      },
      reopenFlag,
    });
    fireEvent.click(screen.getByRole("button", { name: "1 resolved" }));
    expect(screen.getByText("Addressed")).toBeTruthy();
    const reopenDismissedName = `Reopen the ${getRiskAttributeInlineLabel(appI18n.t, dismissed.attr)} risk on ${dismissed.file}`;
    fireEvent.click(
      screen.getByRole("button", {
        name: reopenDismissedName,
      }),
    );
    expect(reopenFlag).toHaveBeenCalledWith(dismissed);
    const reopenAddressedName = `Reopen the ${getRiskAttributeInlineLabel(appI18n.t, addressed.attr)} risk on ${addressed.file}`;
    expect(
      screen.queryByRole("button", {
        name: reopenAddressedName,
      }),
    ).toBeNull();
  });

  it("own-draft strips controls and keeps the list readable", () => {
    renderSurface(briefFixture, { flagsReadOnly: true });
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Address selected" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: /^Reopen the/ })).toBeNull();
    expect(screen.getByRole("heading", { name: "Risk surface" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "src/leak.ts" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "No tests" })).toBeTruthy();
  });
});

describe("RiskSurface reader's file", () => {
  function renderFollowing(
    activeChunkId: string,
    activeGroupId: string,
    followsReader = true,
  ) {
    const { group, flags } = requireAttributed(briefFixture);
    const position = createReadingPositionStore();
    position.getState().actions.setActive(activeChunkId, activeGroupId);
    render(
      <ReadingPositionProvider store={position}>
        <RiskSurface
          dispositions={{}}
          flagsReadOnly={false}
          followsReader={followsReader}
          group={group}
          groupFlags={flags}
          jumpToChunk={vi.fn()}
          reopenFlag={vi.fn()}
          selectedFlagSet={new Set()}
          setDismissTarget={vi.fn()}
          setEvidenceTarget={vi.fn()}
          toggleRiskGroup={vi.fn()}
        />
      </ReadingPositionProvider>,
    );
    return { group };
  }

  function getCurrentRows(): HTMLElement[] {
    return screen
      .getAllByRole("listitem")
      .filter((row) => row.getAttribute("aria-current") === "true");
  }

  it("marks the row of the file the reader is in", () => {
    const { group } = renderFollowing("chunk-a", "g1");
    expect(group.id).toBe("g1");
    const current = getCurrentRows();
    expect(current).toHaveLength(1);
    expect(current[0]?.dataset["state"]).toBe("current");
    expect(current[0]?.textContent).toContain("src/leak.ts");
  });

  it("marks nothing while the reader is in another group", () => {
    renderFollowing("chunk-a", "g2");
    expect(getCurrentRows()).toHaveLength(0);
  });

  it("marks nothing on a surface that does not follow the reader", () => {
    renderFollowing("chunk-a", "g1", false);
    expect(getCurrentRows()).toHaveLength(0);
  });
});

describe("RiskSurface path order", () => {
  function makeDotFileBrief(): Brief {
    const core = briefFixture.chunks[0];
    if (core === undefined) {
      throw new Error("fixture missing core chunk");
    }
    const dotFile: BriefChunk = {
      ...core,
      file: ".npmrc",
      riskSurface: ["changes-package-source"],
    };
    return { ...briefFixture, chunks: [dotFile] };
  }

  it("isolates an open file's path as left-to-right text", () => {
    renderSurface(makeDotFileBrief());

    const path = screen.getByRole("button", { name: ".npmrc" });
    expect(path.querySelector("bdi")?.getAttribute("dir")).toBe("ltr");
  });

  it("isolates a resolved file's path as left-to-right text", () => {
    const brief = makeDotFileBrief();
    const { flags } = requireAttributed(brief);
    const dispositions: Record<string, Disposition | undefined> = {};
    for (const flag of flags) {
      dispositions[flag.id] = DISMISSED;
    }
    renderSurface(brief, { dispositions });

    fireEvent.click(screen.getByRole("button", { name: "1 resolved" }));

    const path = screen.getByRole("button", { name: ".npmrc" });
    expect(path.querySelector("bdi")?.getAttribute("dir")).toBe("ltr");
  });
});
