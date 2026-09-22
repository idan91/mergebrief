import { describe, expect, it, vi } from "vitest";

import type { FilterView } from "./types";
import { buildAllRow, describeFilterValue } from "./utils";

function makeFilter(overrides: Partial<FilterView> = {}): FilterView {
  return {
    id: "review",
    name: "Review",
    options: [
      { value: "new", label: "New" },
      { value: "updated", label: "Updated" },
      { value: "reviewed", label: "Reviewed" },
    ],
    chosen: [],
    multiple: true,
    changed: false,
    onChoose: () => undefined,
    ...overrides,
  };
}

describe("describeFilterValue", () => {
  it("prints nothing at the default unless the filter is always named", () => {
    expect(
      describeFilterValue(makeFilter({ chosen: ["new"] })),
    ).toBeUndefined();
    expect(
      describeFilterValue(
        makeFilter({ chosen: ["new"], multiple: false, alwaysNamed: true }),
      ),
    ).toBe("New");
  });

  it("names the choices up to the filter's limit, then counts them", () => {
    const changed = makeFilter({ changed: true, chosen: ["new", "updated"] });

    expect(describeFilterValue(changed)).toBe("2");
    expect(describeFilterValue({ ...changed, namedUpTo: 2 })).toBe(
      "New, Updated",
    );
  });

  it("prints the All row's trigger word while it is ticked", () => {
    const all = {
      label: "All review states",
      triggerLabel: "All",
      checked: true,
      onChoose: () => undefined,
    };

    expect(describeFilterValue(makeFilter({ changed: true, all }))).toBe("All");
    expect(describeFilterValue(makeFilter({ all }))).toBeUndefined();
  });

  it("falls back to the raw value for a choice the options do not name", () => {
    expect(
      describeFilterValue(makeFilter({ changed: true, chosen: ["424242"] })),
    ).toBe("424242");
  });
});

describe("buildAllRow", () => {
  it("chooses only while unticked, so a ticked row moves nothing", () => {
    const choose = vi.fn();
    const labels = { label: "All repositories", triggerLabel: "All" };

    buildAllRow(labels, true, choose).onChoose();
    expect(choose).not.toHaveBeenCalled();

    buildAllRow(labels, false, choose).onChoose();
    expect(choose).toHaveBeenCalledOnce();
  });
});
