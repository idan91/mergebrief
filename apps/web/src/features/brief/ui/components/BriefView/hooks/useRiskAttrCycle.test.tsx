// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { createBriefViewStore, type BriefViewStore } from "../store";
import { useRiskAttrCycle, type RiskAttrCycle } from "./useRiskAttrCycle";

let cycle: RiskAttrCycle | undefined;

interface HarnessProps {
  viewStore: BriefViewStore;
  toolbarShown: boolean;
}

function Harness({ viewStore, toolbarShown }: HarnessProps) {
  cycle = useRiskAttrCycle(viewStore, toolbarShown);
  return null;
}

function makeViewStore(): BriefViewStore {
  return createBriefViewStore({ openChunkIds: [], focusMode: false });
}

describe("useRiskAttrCycle", () => {
  afterEach(() => {
    cleanup();
    cycle = undefined;
  });

  it("advances each attribute on its own", () => {
    render(<Harness toolbarShown viewStore={makeViewStore()} />);

    act(() => cycle?.advance("no-tests"));
    act(() => cycle?.advance("no-tests"));
    act(() => cycle?.advance("touches-auth"));

    expect(cycle?.positions.get("no-tests")).toBe(2);
    expect(cycle?.positions.get("touches-auth")).toBe(1);
  });

  it("starts over once the toolbar region hides", () => {
    const viewStore = makeViewStore();
    const { rerender } = render(<Harness toolbarShown viewStore={viewStore} />);
    act(() => cycle?.advance("no-tests"));

    rerender(<Harness toolbarShown={false} viewStore={viewStore} />);
    rerender(<Harness toolbarShown viewStore={viewStore} />);

    expect(cycle?.positions.size).toBe(0);
  });
});
