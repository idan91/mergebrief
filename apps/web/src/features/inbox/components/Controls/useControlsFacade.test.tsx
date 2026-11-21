// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { InboxSortDirections, InboxSorts } from "types/inbox";
import { describe, expect, it, vi } from "vitest";

import { parseInboxSearch, readInboxChoices } from "../../search";
import type { InboxPage } from "../../types";
import { useControlsFacade } from "./useControlsFacade";

function makePage(overrides: Partial<InboxPage> = {}): InboxPage {
  return {
    items: [],
    page: 1,
    pageSize: 25,
    total: 0,
    archivedTotal: 0,
    searchMatchTotal: 0,
    archivedSearchMatchTotal: 0,
    heldTotal: 0,
    counts: { new: 0, inProgress: 0, reviewed: 0, updated: 0 },
    viewer: { login: "octocat", avatarUrl: "https://a/1" },
    reachableInstallations: [{ installationId: "10", accountLogin: "acme" }],
    repositories: [{ repoId: "424242", repoSlug: "acme/payments" }],
    ...overrides,
  };
}

function renderFacade(page: InboxPage, raw: Record<string, unknown> = {}) {
  const search = parseInboxSearch(raw);
  const write = vi.fn();
  const { result } = renderHook(() =>
    useControlsFacade(page, search, readInboxChoices(search), write),
  );
  return { facade: result.current, write };
}

describe("useControlsFacade", () => {
  it("offers the Installation filter only past one reachable installation", () => {
    const one = renderFacade(makePage());
    const two = renderFacade(
      makePage({
        reachableInstallations: [
          { installationId: "10", accountLogin: "acme" },
          { installationId: "20", accountLogin: "halden" },
        ],
      }),
    );

    expect(one.facade.filters.map((filter) => filter.id)).toEqual([
      "state",
      "repo",
      "review",
      "author",
      "list",
    ]);
    expect(two.facade.filters.at(-1)?.id).toBe("installation");
  });

  it("the sort is always named and changed only off its default", () => {
    const atDefault = renderFacade(makePage());
    const generated = renderFacade(makePage(), { sort: "generated" });

    expect(atDefault.facade.sort).toMatchObject({
      alwaysNamed: true,
      changed: false,
    });
    expect(generated.facade.sort).toMatchObject({
      changed: true,
      chosen: [InboxSorts.GENERATED],
    });
  });

  it("the sort offers Created after the two it had", () => {
    const { facade } = renderFacade(makePage());

    expect(facade.sort.options.map((option) => option.value)).toEqual([
      InboxSorts.UPDATED,
      InboxSorts.GENERATED,
      InboxSorts.CREATED,
    ]);
  });

  it("the direction is changed only while it runs oldest first", () => {
    const atDefault = renderFacade(makePage());
    const oldest = renderFacade(makePage(), { direction: "asc" });

    expect(atDefault.facade.direction).toMatchObject({
      changed: false,
      chosen: [InboxSortDirections.DESCENDING],
    });
    expect(oldest.facade.direction).toMatchObject({
      changed: true,
      chosen: [InboxSortDirections.ASCENDING],
    });
  });

  it("choosing a direction writes it, and newest first unsets it", () => {
    const { facade, write } = renderFacade(makePage(), { direction: "asc" });

    facade.direction.onChoose(InboxSortDirections.ASCENDING);
    facade.direction.onChoose(InboxSortDirections.DESCENDING);

    expect(write.mock.calls).toEqual([
      [{ direction: InboxSortDirections.ASCENDING }],
      [{ direction: undefined }],
    ]);
  });

  it("every list filter leads with an All row that clears it", () => {
    const { facade, write } = renderFacade(makePage(), { repo: "424242" });
    const repo = facade.filters.find((filter) => filter.id === "repo");
    const review = facade.filters.find((filter) => filter.id === "review");

    expect(repo?.all).toMatchObject({
      label: "All repositories",
      triggerLabel: "All",
      checked: false,
    });
    expect(review?.all).toMatchObject({
      label: "All review states",
      checked: true,
    });

    repo?.all?.onChoose();
    review?.all?.onChoose();
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith({ repo: undefined });
  });

  it("the Status All row ticks every status and reads as ticked then", () => {
    const opening = renderFacade(makePage());
    const every = renderFacade(makePage(), {
      state: "open,draft,merged,closed",
    });
    const status = opening.facade.filters[0];

    expect(status?.all?.checked).toBe(false);
    expect(every.facade.filters[0]?.all?.checked).toBe(true);

    status?.all?.onChoose();
    expect(opening.write).toHaveBeenCalledWith({
      state: "open,draft,merged,closed",
    });
  });

  it("the layout is folded by default, named off it, and writes mixed only", () => {
    const { facade, write } = renderFacade(makePage());

    expect(facade.layout).toMatchObject({
      changed: false,
      chosen: ["folded"],
    });
    expect(facade.layout.alwaysNamed).toBeUndefined();
    facade.layout.onChoose("mixed");
    facade.layout.onChoose("folded");
    expect(write).toHaveBeenNthCalledWith(1, { layout: "mixed" });
    expect(write).toHaveBeenNthCalledWith(2, { layout: undefined });
  });

  it("the List filter is Inbox by default and writes only the archived view", () => {
    const { facade, write } = renderFacade(makePage());
    const list = facade.filters.find((filter) => filter.id === "list");
    if (list === undefined) {
      throw new Error("no List filter");
    }

    expect(list).toMatchObject({
      name: "List",
      underMore: true,
      multiple: false,
      changed: false,
      chosen: ["hide"],
    });
    expect(list.options.map((option) => option.label)).toEqual([
      "Inbox",
      "Archived",
    ]);
    list.onChoose("only");
    list.onChoose("hide");
    expect(write).toHaveBeenNthCalledWith(1, { archived: "only" });
    expect(write).toHaveBeenNthCalledWith(2, { archived: undefined });

    const archived = renderFacade(makePage(), { archived: "only" });
    expect(
      archived.facade.filters.find((filter) => filter.id === "list"),
    ).toMatchObject({ changed: true, chosen: ["only"] });
  });

  it("the Held view counts held rows and writes only the held view", () => {
    const all = renderFacade(makePage({ heldTotal: 3 }));
    const held = renderFacade(makePage({ heldTotal: 3 }), {
      generation: "held",
    });

    expect(all.facade.heldView).toMatchObject({ value: "all", count: 3 });
    expect(held.facade.heldView.value).toBe("held");
    all.facade.heldView.onChoose("held");
    held.facade.heldView.onChoose("all");
    expect(all.write).toHaveBeenCalledWith({ generation: "held" });
    expect(held.write).toHaveBeenCalledWith({ generation: undefined });
  });

  it("a tick writes from the choices the URL holds when it lands", () => {
    const { facade, write } = renderFacade(makePage());
    const review = facade.filters.find((filter) => filter.id === "review");

    review?.onChoose("updated");

    const [next] = write.mock.calls[0] ?? [];
    if (typeof next !== "function") {
      throw new Error("the write is not live");
    }
    expect(next(readInboxChoices(parseInboxSearch({ review: "new" })))).toEqual(
      {
        review: "new,updated",
      },
    );
  });
});
