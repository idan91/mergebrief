// @vitest-environment jsdom
import { appI18n } from "@web/i18n/I18nProvider";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RiskSurfaceAttributes } from "brief-core/types";
import {
  createReviewFlowStore,
  ReviewFlowProvider,
  ReviewSessionProvider,
  type SessionWrites,
} from "@web/features/review/session";
import { briefFixture } from "@web/features/brief/test-utils";
import { intersectionObservers } from "@web/test/setup";
import { placeStickyTarget, stubStickyRule } from "@web/test/sticky";
import { GroupViewKinds } from "../../../../../../model/utils/remainder";
import {
  buildBriefViewModel,
  type BriefViewModel,
  type GroupView,
} from "../../../../../../model/utils/view-model";
import {
  createReadingPositionStore,
  ReadingPositionProvider,
} from "../../../reading/reading-position";
import { RiskFlagModals } from "../../../RiskFlagModals";
import { ReviewPostureProvider } from "../../../../../hooks/useReviewPosture";
import { makeReviewPosture } from "../../../../../utils/review-posture";
import { GroupCard } from "..";

const SECRET_FILE = "src/key.ts";

const unflaggedChunks = briefFixture.chunks.map((chunk) => ({
  ...chunk,
  riskSurface: [],
}));

const remainderOnlyModel = buildBriefViewModel({
  ...briefFixture,
  chunks: unflaggedChunks,
  unattributed: [
    {
      file: SECRET_FILE,
      addedRanges: [{ start: 4, end: 6 }],
      removedRanges: [],
      riskSurface: [RiskSurfaceAttributes.ADDS_SECRET],
    },
  ],
});

const unflaggedRemainderModel = buildBriefViewModel({
  ...briefFixture,
  unattributed: [
    {
      file: "src/orphan.ts",
      addedRanges: [{ start: 1, end: 2 }],
      removedRanges: [],
    },
  ],
});

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

const attributedModel = buildBriefViewModel(briefFixture);

const ok = () => Promise.resolve({ ok: true as const, value: undefined });

function stubWrites(): SessionWrites {
  return {
    setRead: vi.fn(ok),
    reclassify: vi.fn(ok),
    createDraft: vi.fn(() =>
      Promise.resolve({ ok: true as const, value: "1" }),
    ),
    updateDraft: vi.fn(ok),
    reanchorDraft: vi.fn(ok),
    deleteDraft: vi.fn(ok),
    dismissRisks: vi.fn(ok),
    addressRisks: vi.fn(ok),
    reopenRisks: vi.fn(ok),
    setOutcome: vi.fn(ok),
  };
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

function findFirstFlaggedGroup(model: BriefViewModel): GroupView {
  const group = model.groups.find(
    (candidate) => (model.flagsByGroup.get(candidate.id) ?? []).length > 0,
  );
  if (group === undefined) {
    throw new Error("model has no flagged group");
  }
  return group;
}

function mountCard(model: BriefViewModel, group: GroupView) {
  const writes = stubWrites();
  const flowStore = createReviewFlowStore(
    {
      saveComment: () => Promise.resolve(true),
      updateComment: () => Promise.resolve(true),
      deleteComment: () => undefined,
      toggleComment: () => undefined,
      reanchorComment: () => true,
    },
    appI18n.t,
  );
  render(
    <ReviewSessionProvider briefId="test-brief" model={model} writes={writes}>
      <ReviewFlowProvider store={flowStore}>
        <ReviewPostureProvider posture={makeReviewPosture()}>
          <ReadingPositionProvider store={createReadingPositionStore()}>
            <GroupCard
              group={group}
              brief={briefFixture}
              model={model}
              jumpToChunk={() => undefined}
            />
            <RiskFlagModals flagsById={model.flagsById} />
          </ReadingPositionProvider>
        </ReviewPostureProvider>
      </ReviewFlowProvider>
    </ReviewSessionProvider>,
  );
  return writes;
}

function selectFile(file: string) {
  const name = appI18n.t("brief.group.selectFile", { file });
  fireEvent.click(screen.getByRole("checkbox", { name }));
}

function dismissSelected() {
  fireEvent.click(
    screen.getByRole("button", {
      name: appI18n.t("brief.group.dismissSelected"),
    }),
  );
  const dialog = screen.getByRole("dialog", {
    name: appI18n.t("review.dismiss.heading"),
  });
  fireEvent.change(within(dialog).getByRole("textbox"), {
    target: { value: "test fixture key, not a live credential" },
  });
  fireEvent.click(
    within(dialog).getByRole("button", {
      name: appI18n.t("review.dismiss.dismissWithReason"),
    }),
  );
}

function readFirstFlag(model: BriefViewModel, group: GroupView) {
  const flag = (model.flagsByGroup.get(group.id) ?? [])[0];
  if (flag === undefined) {
    throw new Error("group has no flags");
  }
  return flag;
}

afterEach(cleanup);

describe("RemainderGroupCard flags", () => {
  it("holds the only flag of a brief whose risk sits on an unattributed file", () => {
    const remainder = findRemainder(remainderOnlyModel);
    mountCard(remainderOnlyModel, remainder);

    expect(remainderOnlyModel.flags).toHaveLength(1);
    const surface = screen.getByRole("region", {
      name: appI18n.t("brief.group.ariaLabelGroupRiskSurface", {
        title: appI18n.t("brief.unattributed.remainderTitle"),
      }),
    });
    expect(within(surface).getByText(SECRET_FILE)).toBeTruthy();
  });

  it.each([
    ["an attributed", attributedModel, findFirstFlaggedGroup(attributedModel)],
    ["the remainder", remainderOnlyModel, findRemainder(remainderOnlyModel)],
  ])("dismisses a flag on %s card through dismiss-risk", (_, model, group) => {
    const flag = readFirstFlag(model, group);
    const writes = mountCard(model, group);

    selectFile(flag.file);
    dismissSelected();

    expect(writes.dismissRisks).toHaveBeenCalledTimes(1);
    const [flags, reason] = vi.mocked(writes.dismissRisks).mock.calls[0]!;
    expect(flags[0]).toMatchObject({
      filePath: flag.file,
      attribute: flag.attr,
    });
    expect(reason).toBe("test fixture key, not a live credential");
  });

  it("addresses the remainder flag through address-risk", () => {
    const remainder = findRemainder(remainderOnlyModel);
    const flag = readFirstFlag(remainderOnlyModel, remainder);
    const writes = mountCard(remainderOnlyModel, remainder);

    selectFile(SECRET_FILE);
    fireEvent.click(
      screen.getByRole("button", {
        name: appI18n.t("brief.group.addressSelected"),
      }),
    );
    fireEvent.click(
      within(
        screen.getByRole("dialog", {
          name: appI18n.t("review.evidence.heading"),
        }),
      ).getByRole("button", {
        name: appI18n.t("review.evidence.confirm"),
      }),
    );

    expect(writes.addressRisks).toHaveBeenCalledTimes(1);
    const [flags] = vi.mocked(writes.addressRisks).mock.calls[0]!;
    expect(flags[0]).toMatchObject({
      filePath: SECRET_FILE,
      attribute: RiskSurfaceAttributes.ADDS_SECRET,
      regionStart: 4,
      regionEnd: 6,
      evidence: { kind: "chunk-reviewed", ref: flag.chunkId },
    });
  });

  it("renders no flag surface when the remainder carries no flags", () => {
    mountCard(unflaggedRemainderModel, findRemainder(unflaggedRemainderModel));

    expect(screen.getByRole("article")).toBeTruthy();
    expect(screen.queryByRole("region")).toBeNull();
  });
});

describe("RemainderGroupCard with only flagged files and no lines", () => {
  it("says the files are listed for their flags and shows no line count", () => {
    const remainder = findRemainder(carrierOnlyModel);
    mountCard(carrierOnlyModel, remainder);

    expect(
      screen.getByText(appI18n.t("brief.unattributed.flagsOnlySummary")),
    ).toBeTruthy();
    expect(
      screen.queryByText(appI18n.t("brief.unattributed.remainderSummary")),
    ).toBeNull();
    expect(document.querySelector("[class*='lines']")).toBeNull();
  });
});

describe("RemainderGroupCard stuck card", () => {
  const STICKY_TOP_PX = 140;
  let stickyRule: HTMLStyleElement | undefined;

  beforeEach(() => {
    stickyRule = stubStickyRule("article", STICKY_TOP_PX);
  });

  afterEach(() => {
    stickyRule?.remove();
    intersectionObservers.length = 0;
  });

  it("marks the card stuck while it is pinned under the stack", () => {
    mountCard(remainderOnlyModel, findRemainder(remainderOnlyModel));
    const card = screen.getByRole("article");

    placeStickyTarget(card, STICKY_TOP_PX, STICKY_TOP_PX);

    expect(card.dataset["stuck"]).toBe("");
  });

  it("clears the stuck mark once the card scrolls back to rest", () => {
    mountCard(remainderOnlyModel, findRemainder(remainderOnlyModel));
    const card = screen.getByRole("article");
    placeStickyTarget(card, STICKY_TOP_PX, STICKY_TOP_PX);

    placeStickyTarget(card, STICKY_TOP_PX, STICKY_TOP_PX + 200);

    expect(card.hasAttribute("data-stuck")).toBe(false);
  });

  it("arms the card's motion once its first reading has painted", async () => {
    mountCard(remainderOnlyModel, findRemainder(remainderOnlyModel));
    const card = screen.getByRole("article");

    placeStickyTarget(card, STICKY_TOP_PX, STICKY_TOP_PX);

    await waitFor(() => expect(card.dataset["motion"]).toBe("on"));
  });

  it("never watches a card the stacked layout leaves unpinned", () => {
    stickyRule?.remove();
    mountCard(remainderOnlyModel, findRemainder(remainderOnlyModel));
    const card = screen.getByRole("article");

    expect(() => placeStickyTarget(card, STICKY_TOP_PX, STICKY_TOP_PX)).toThrow(
      "nothing watches the line",
    );
    expect(card.hasAttribute("data-stuck")).toBe(false);
  });
});
