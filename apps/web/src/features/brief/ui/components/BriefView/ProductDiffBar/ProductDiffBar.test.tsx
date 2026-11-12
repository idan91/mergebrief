// @vitest-environment jsdom
import {
  BeforeSources,
  ProductDiffAvailabilities,
  type ProductDiff,
} from "brief-core/types";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProductDiffBar } from ".";
import {
  makeProductChange,
  makeProductDiff,
} from "../../../../test-utils/fixtures";

afterEach(cleanup);

function mountBar(
  productDiff: ProductDiff,
  jumpToGroup: (groupId: string) => void = () => {},
) {
  render(
    <ProductDiffBar
      groupTitles={{ g1: "Restore archived items" }}
      jumpToGroup={jumpToGroup}
      productDiff={productDiff}
    />,
  );
}

function openBar(): void {
  fireEvent.click(screen.getByRole("button", { name: /Product diff/ }));
}

describe("ProductDiffBar", () => {
  it("starts collapsed with the count in the bar", () => {
    mountBar(makeProductDiff());

    const toggle = screen.getByRole("button", { name: /Product diff/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.textContent).toContain("1 product change");
  });

  it("shows each change as its condition, a before and an after", () => {
    mountBar(makeProductDiff());

    openBar();

    const item = screen.getByRole("listitem");
    const heading = within(item).getByRole("heading", { level: 3 });
    expect(heading.textContent).toBe(
      "a user creates an item whose name matches an archived one",
    );
    const terms = within(item).getAllByRole("term");
    const definitions = within(item).getAllByRole("definition");
    expect(terms.map((term) => term.textContent)).toEqual(["Before", "After"]);
    expect(definitions[0]?.textContent).toBe("A second, new item was created.");
    expect(definitions[1]?.textContent).toContain(
      "The archived item is restored.",
    );
    expect(within(item).getByText("Business rule")).toBeTruthy();
  });

  it("says a before the diff does not show is not shown", () => {
    const { before: _absent, ...withoutBefore } = makeProductChange({
      beforeSource: BeforeSources.NOT_SHOWN,
    });
    mountBar(makeProductDiff({ changes: [withoutBefore] }));

    openBar();

    const [before] = screen.getAllByRole("definition");
    expect(before?.textContent).toBe("Not shown in this diff");
  });

  it("says a new behaviour with no before did not exist", () => {
    const { before: _absent, ...withoutBefore } = makeProductChange({
      beforeSource: BeforeSources.DID_NOT_EXIST,
    });
    mountBar(makeProductDiff({ changes: [withoutBefore] }));

    openBar();

    const [before] = screen.getAllByRole("definition");
    expect(before?.textContent).toBe("Did not exist before this PR");
  });

  it("marks a before that rests on the PR description", () => {
    const change = makeProductChange({ beforeSource: BeforeSources.PR_TEXT });
    mountBar(makeProductDiff({ changes: [change] }));

    openBar();

    const [before] = screen.getAllByRole("definition");
    expect(before?.textContent).toBe(
      "A second, new item was created. per the PR description",
    );
  });

  it("stars the count and notes that the PR has more", () => {
    mountBar(makeProductDiff({ hasMore: true }));

    openBar();

    const toggle = screen.getByRole("button", { name: /Product diff/ });
    expect(toggle.textContent).toContain("1 product change*");
    expect(
      screen.getByText(
        "* Only the most significant are listed. This PR has more product changes.",
      ),
    ).toBeTruthy();
  });

  it("jumps to the change-group a change names", () => {
    const jumpToGroup = vi.fn();
    mountBar(makeProductDiff(), jumpToGroup);
    openBar();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Go to change-group g1: Restore archived items",
      }),
    );

    expect(jumpToGroup).toHaveBeenCalledWith("g1");
  });

  it("labels each jump with its id when a change names several groups", () => {
    const change = makeProductChange({ groupIds: ["g1", "g4"] });
    mountBar(makeProductDiff({ changes: [change] }));

    openBar();

    const unknownTitle = screen.getByRole("button", {
      name: "Go to change-group g4",
    });
    expect(unknownTitle.textContent).toContain("g4");
  });

  it("says none was found for a PR that changes no outcome", () => {
    mountBar(makeProductDiff({ changes: [] }));

    openBar();

    const toggle = screen.getByRole("button", { name: /Product diff/ });
    expect(toggle.textContent).toContain("No product change found");
    expect(screen.queryByRole("listitem")).toBeNull();
    expect(
      screen.getByText(/changes what a user, a caller or an operator gets/),
    ).toBeTruthy();
  });

  it("keeps the AI-read caution when none was found", () => {
    mountBar(makeProductDiff({ changes: [] }));

    openBar();

    expect(screen.getByText(/AI-inferred/)).toBeTruthy();
  });

  it("drops the caution when the section is not available", () => {
    mountBar(
      makeProductDiff({
        availability: ProductDiffAvailabilities.UNAVAILABLE,
        changes: [],
      }),
    );

    openBar();

    expect(screen.queryByText(/AI-inferred/)).toBeNull();
  });

  it("says the section is not available for a PR read in parts", () => {
    mountBar(
      makeProductDiff({
        availability: ProductDiffAvailabilities.UNAVAILABLE,
        changes: [],
      }),
    );

    openBar();

    const toggle = screen.getByRole("button", { name: /Product diff/ });
    expect(toggle.textContent).toContain(
      "Not available: this PR was read in parts",
    );
    expect(screen.getByText(/did not read this PR's whole diff/)).toBeTruthy();
  });

  it("carries the AI-read caution under the changes", () => {
    mountBar(makeProductDiff());

    openBar();

    expect(
      screen.getByText("AI-inferred. Verify against the code."),
    ).toBeTruthy();
  });
});
