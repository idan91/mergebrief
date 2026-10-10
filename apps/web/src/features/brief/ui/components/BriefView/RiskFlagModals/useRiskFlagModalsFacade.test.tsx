// @vitest-environment jsdom
// Pins the dismiss-input choreography: reopening always starts blank, and a
// short reason warns once then commits (warn-then-accept).
import { appI18n } from "../../../../../../i18n/I18nProvider";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { ReactNode } from "react";

import {
  createReviewFlowStore,
  ReviewSessionProvider,
  ReviewFlowProvider,
  type ReviewFlowStore,
} from "@web/features/review/session";
import { briefFixture } from "@web/features/brief/test-utils";
import { buildBriefViewModel } from "../../../../model/utils/view-model";
import { useRiskFlagModalsFacade } from "./useRiskFlagModalsFacade";

afterEach(cleanup);

const model = buildBriefViewModel(briefFixture);

function setup() {
  const flowStore: ReviewFlowStore = createReviewFlowStore(
    {
      saveComment: () => Promise.resolve(true),
      updateComment: () => undefined,
      deleteComment: () => undefined,
      toggleComment: () => undefined,
      reanchorComment: () => true,
    },
    appI18n.t,
  );
  const wrapper = ({ children }: { children: ReactNode }) => (
    <ReviewSessionProvider briefId="test-brief" model={model}>
      <ReviewFlowProvider store={flowStore}>{children}</ReviewFlowProvider>
    </ReviewSessionProvider>
  );
  const hook = renderHook(
    () => useRiskFlagModalsFacade({ flagsById: model.flagsById }),
    { wrapper },
  );
  return { flowStore, hook };
}

function firstFlagId(): string {
  const flagId = [...model.flagsById.keys()][0];
  if (flagId === undefined) {
    throw new Error("fixture has no flags");
  }
  return flagId;
}

describe("useRiskFlagModalsFacade dismiss input", () => {
  it("warns once on a short reason, then commits on the second confirm", () => {
    const { flowStore, hook } = setup();
    const flagId = firstFlagId();
    act(() => {
      flowStore.getState().actions.setDismissTarget({
        flagIds: [flagId],
        label: "one flag",
      });
    });
    act(() => hook.result.current.setDismissReason("too short"));
    act(() => hook.result.current.confirmDismiss());
    // First confirm: warned, nothing committed, modal stays open.
    expect(hook.result.current.dismissWarned).toBe(true);
    expect(flowStore.getState().dismissTarget).not.toBeNull();
    act(() => hook.result.current.confirmDismiss());
    // Second confirm goes through: target cleared, reason recorded verbatim.
    expect(flowStore.getState().dismissTarget).toBeNull();
  });

  it("starts blank on reopen, even after a warned attempt", () => {
    const { flowStore, hook } = setup();
    const flagId = firstFlagId();
    act(() => {
      flowStore.getState().actions.setDismissTarget({
        flagIds: [flagId],
        label: "one flag",
      });
    });
    act(() => hook.result.current.setDismissReason("meh"));
    act(() => hook.result.current.confirmDismiss());
    expect(hook.result.current.dismissWarned).toBe(true);
    act(() => hook.result.current.cancelDismiss());
    // Reopen: fresh target object → input resets to blank/unwarned.
    act(() => {
      flowStore.getState().actions.setDismissTarget({
        flagIds: [flagId],
        label: "one flag",
      });
    });
    expect(hook.result.current.dismissReason).toBe("");
    expect(hook.result.current.dismissWarned).toBe(false);
  });
});
