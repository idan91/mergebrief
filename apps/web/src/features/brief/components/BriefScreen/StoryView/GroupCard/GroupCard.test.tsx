// @vitest-environment jsdom
// The narrow undo: a dismissed risk carries a Reopen affordance, and it
// drives `reopen-risk` all the way to the wire. With "Clear local drafts"
// gone this is the ONLY path from `dismissed` back to `open`.
import { appI18n } from "@web/i18n/I18nProvider";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createReviewFlowStore,
  ReviewSessionProvider,
  ReviewFlowProvider,
  useReviewSession,
  useReviewSessionActions,
  type ReviewSessionActions,
  type SessionWrites,
} from "@web/features/review/session";
import { briefFixture } from "../../../../utils/fixtures";
import { buildBriefViewModel } from "../../../../utils/viewModel";
import { GroupCard } from "./GroupCard";

afterEach(cleanup);

const model = buildBriefViewModel(briefFixture);

const ok = () => Promise.resolve({ ok: true as const, value: undefined });

function writesSpy(): SessionWrites {
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

interface Tap {
  actions: ReviewSessionActions | null;
  dispositionKind: (flagId: string) => string | undefined;
}

function renderCard(writes: SessionWrites) {
  const group = model.groups[0];
  if (group === undefined) throw new Error("fixture has no groups");
  const firstFlag = (model.flagsByGroup.get(group.id) ?? [])[0];
  if (firstFlag === undefined) throw new Error("fixture group has no flags");
  const flagId: string = firstFlag.id;
  const tap: Tap = { actions: null, dispositionKind: () => undefined };
  function StoreTap() {
    tap.actions = useReviewSessionActions();
    const kind = useReviewSession((state) => state.dispositions[flagId]?.kind);
    tap.dispositionKind = () => kind;
    return null;
  }
  const flowStore = createReviewFlowStore(
    {
      saveComment: () => Promise.resolve(true),
      updateComment: () => undefined,
      deleteComment: () => undefined,
      toggleComment: () => undefined,
      reanchorComment: () => true,
    },
    {
      composerDisabledReason: undefined,
      flagsReadOnly: false,
      postingCommentIds: new Set(),
      postBlockedExternally: undefined,
      postComment: undefined,
    },
    appI18n.t,
  );
  render(
    <ReviewSessionProvider briefId="test-brief" model={model} writes={writes}>
      <ReviewFlowProvider store={flowStore}>
        <StoreTap />
        <GroupCard
          group={group}
          brief={briefFixture}
          model={model}
          jumpToChunk={() => undefined}
        />
      </ReviewFlowProvider>
    </ReviewSessionProvider>,
  );
  return { flagId, flowStore, tap };
}

function dismiss(tap: Tap, flagId: string) {
  act(() => {
    tap.actions?.disposeFlag([flagId], {
      kind: "dismissed",
      reason: "not applicable here",
    });
  });
}

describe("GroupCard — reopen a dismissed risk", () => {
  it("offers no Reopen while the risk is open", () => {
    renderCard(writesSpy());
    expect(screen.queryByRole("button", { name: /^Reopen the/ })).toBeNull();
  });

  it("reopens through the wire: reopen-risk carries the flag's anchor", async () => {
    const writes = writesSpy();
    const { flagId, flowStore, tap } = renderCard(writes);
    dismiss(tap, flagId);
    expect(tap.dispositionKind(flagId)).toBe("dismissed");

    fireEvent.click(screen.getByRole("button", { name: /^Reopen the/ }));

    // Back to open locally AND on the wire — the store branch's first caller.
    expect(tap.dispositionKind(flagId)).toBe("open");
    expect(writes.reopenRisks).toHaveBeenCalledTimes(1);
    const [flags] = vi.mocked(writes.reopenRisks).mock.calls[0]!;
    const flag = model.flagsById.get(flagId);
    expect(flags).toHaveLength(1);
    expect(flags[0]?.filePath).toBe(flag?.file);
    expect(flags[0]?.attribute).toBe(flag?.attr);
    // …and the reviewer is told, through the page's live region (which
    // clears before it sets, so the copy lands a tick later).
    await waitFor(() =>
      expect(flowStore.getState().toast).toBe(
        appI18n.t("brief.group.reopenAnnounce"),
      ),
    );
  });
});
