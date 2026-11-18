import { describe, expect, it, vi } from "vitest";

import type { FilterView } from "./types";
import { FILTER_ALL_VALUE } from "./consts";
import {
  buildAllRow,
  deriveCollapsedSelection,
  deriveFilterSelection,
  describeFilterValue,
  findToggledValue,
} from "./utils";

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

describe("findToggledValue", () => {
  it("names the value added or removed, none when the lists match", () => {
    expect(findToggledValue(["a"], ["a", "b"])).toBe("b");
    expect(findToggledValue(["a", "b"], ["b"])).toBe("a");
    expect(findToggledValue(["a"], ["a"])).toBeUndefined();
  });
});

describe("deriveFilterSelection", () => {
  it("a single filter hands the one choice straight through", () => {
    const onChoose = vi.fn();
    const selection = deriveFilterSelection(
      makeFilter({ multiple: false, chosen: ["new"], onChoose }),
    );

    if (selection.multiple) {
      throw new Error("expected a single selection");
    }
    expect(selection.value).toBe("new");
    selection.onValueChange("updated");
    expect(onChoose).toHaveBeenCalledWith("updated");
  });

  it("a single filter with a ticked All row shows All and routes it home", () => {
    const onChoose = vi.fn();
    const onChooseAll = vi.fn();
    const all = {
      label: "All",
      triggerLabel: "All",
      checked: true,
      onChoose: onChooseAll,
    };
    const selection = deriveFilterSelection(
      makeFilter({ multiple: false, chosen: ["new"], all, onChoose }),
    );

    if (selection.multiple) {
      throw new Error("expected a single selection");
    }
    expect(selection.value).toBe(FILTER_ALL_VALUE);
    selection.onValueChange(FILTER_ALL_VALUE);
    expect(onChooseAll).toHaveBeenCalledOnce();
    expect(onChoose).not.toHaveBeenCalled();
  });

  it("a multiple filter ticks its choices plus a ticked All row", () => {
    const onChoose = vi.fn();
    const onChooseAll = vi.fn();
    const all = {
      label: "All",
      triggerLabel: "All",
      checked: true,
      onChoose: onChooseAll,
    };
    const selection = deriveFilterSelection(
      makeFilter({ chosen: ["new"], all, onChoose }),
    );

    if (!selection.multiple) {
      throw new Error("expected a multiple selection");
    }
    expect(selection.value).toEqual(["new", FILTER_ALL_VALUE]);
    selection.onValueChange(["new", FILTER_ALL_VALUE, "reviewed"]);
    expect(onChoose).toHaveBeenCalledWith("reviewed");
    selection.onValueChange(["new"]);
    expect(onChooseAll).toHaveBeenCalledOnce();
  });
});

describe("deriveCollapsedSelection", () => {
  it("scopes every value by its filter and routes a toggle back to it", () => {
    const onChooseReview = vi.fn();
    const onChooseAuthor = vi.fn();
    const filters = [
      makeFilter({ chosen: ["new"], onChoose: onChooseReview }),
      makeFilter({
        id: "author",
        multiple: false,
        chosen: ["mine"],
        onChoose: onChooseAuthor,
      }),
    ];
    const selection = deriveCollapsedSelection(filters);

    if (!selection.multiple) {
      throw new Error("expected a multiple selection");
    }
    expect(selection.value).toEqual(["review:new", "author:mine"]);
    selection.onValueChange(["review:new", "author:mine", "author:others"]);
    expect(onChooseAuthor).toHaveBeenCalledWith("others");
    expect(onChooseReview).not.toHaveBeenCalled();
  });
});
