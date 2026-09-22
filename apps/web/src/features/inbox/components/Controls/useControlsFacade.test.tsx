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

  it("a tick writes from the choices the URL holds when it lands", () => {
    const { facade, write } = renderFacade(makePage());
    const review = facade.filters.find((filter) => filter.id === "review");

    review?.onChoose("updated");

    const [next] = write.mock.calls[0] ?? [];
    if (typeof next !== "function") throw new Error("the write is not live");
    expect(next(readInboxChoices(parseInboxSearch({ review: "new" })))).toEqual(
      {
        review: "new,updated",
      },
    );
  });
});
