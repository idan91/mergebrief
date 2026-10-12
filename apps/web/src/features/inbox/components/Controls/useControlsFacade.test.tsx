// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { InboxSorts } from "types/inbox";
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
      "show",
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

  it("the Show filter is Inbox by default and writes only the archived view", () => {
    const { facade, write } = renderFacade(makePage());
    const show = facade.filters.find((filter) => filter.id === "show");
    if (show === undefined) {
      throw new Error("no Show filter");
    }

    expect(show).toMatchObject({
      name: "Show",
      multiple: false,
      changed: false,
      chosen: ["hide"],
    });
    expect(show.options.map((option) => option.label)).toEqual([
      "Inbox",
      "Archived",
    ]);
    show.onChoose("only");
    show.onChoose("hide");
    expect(write).toHaveBeenNthCalledWith(1, { archived: "only" });
    expect(write).toHaveBeenNthCalledWith(2, { archived: undefined });

    const archived = renderFacade(makePage(), { archived: "only" });
    expect(
      archived.facade.filters.find((filter) => filter.id === "show"),
    ).toMatchObject({ changed: true, chosen: ["only"] });
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
