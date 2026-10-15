// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Button } from "@web/components/Button";
import { DiffViews, type DiffView } from "@web/components/DiffRows/types";
import { DIFF_VIEW_STORAGE_KEY } from "./diff-view-storage";
import { useDiffViewPreference } from "./useDiffViewPreference";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

interface HarnessProps {
  search?: DiffView | undefined;
  clearDiffParam?: (() => void) | undefined;
}

function Harness({ search, clearDiffParam }: HarnessProps) {
  const preference = useDiffViewPreference({ search, clearDiffParam });
  return (
    <Button
      data-testid="toggle"
      onClick={() =>
        preference.setView(
          preference.view === DiffViews.SPLIT
            ? DiffViews.UNIFIED
            : DiffViews.SPLIT,
        )
      }
    >
      {preference.view}
    </Button>
  );
}

function readView(): string {
  return screen.getByTestId("toggle").textContent ?? "";
}

function seedStored(view: DiffView): void {
  window.localStorage.setItem(DIFF_VIEW_STORAGE_KEY, JSON.stringify(view));
}

describe("useDiffViewPreference", () => {
  it("starts unified with nothing stored and no param", () => {
    render(<Harness />);
    expect(readView()).toBe(DiffViews.UNIFIED);
  });

  it("adopts the stored preference when no param is present", () => {
    seedStored(DiffViews.SPLIT);
    render(<Harness />);
    expect(readView()).toBe(DiffViews.SPLIT);
  });

  it("lets the param win over the stored preference", () => {
    seedStored(DiffViews.SPLIT);
    render(<Harness search={DiffViews.UNIFIED} />);
    expect(readView()).toBe(DiffViews.UNIFIED);
  });

  it("leaves the route alone when no param is set", () => {
    const clearDiffParam = vi.fn();
    render(<Harness clearDiffParam={clearDiffParam} />);

    act(() => screen.getByTestId("toggle").click());

    expect(readView()).toBe(DiffViews.SPLIT);
    expect(clearDiffParam).not.toHaveBeenCalled();
  });

  it("writes the chosen view and clears the param", () => {
    const clearDiffParam = vi.fn();
    render(
      <Harness clearDiffParam={clearDiffParam} search={DiffViews.UNIFIED} />,
    );

    act(() => screen.getByTestId("toggle").click());

    expect(readView()).toBe(DiffViews.SPLIT);
    expect(window.localStorage.getItem(DIFF_VIEW_STORAGE_KEY)).toBe(
      JSON.stringify(DiffViews.SPLIT),
    );
    expect(clearDiffParam).toHaveBeenCalledTimes(1);
  });

  it("beats a param the route cannot drop", () => {
    render(<Harness search={DiffViews.UNIFIED} />);

    act(() => screen.getByTestId("toggle").click());

    expect(readView()).toBe(DiffViews.SPLIT);
  });

  it("honours a later deep link after a dismissal", () => {
    const { rerender } = render(<Harness search={DiffViews.UNIFIED} />);
    act(() => screen.getByTestId("toggle").click());

    rerender(<Harness search={DiffViews.UNIFIED} />);
    expect(readView()).toBe(DiffViews.SPLIT);

    rerender(<Harness search={DiffViews.SPLIT} />);
    rerender(<Harness search={DiffViews.UNIFIED} />);
    expect(readView()).toBe(DiffViews.UNIFIED);
  });
});
