import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import type * as ApiFetchModule from "../../../data/apiFetch";

vi.mock("../../../data/apiFetch", async (importOriginal) => {
  const actual = await importOriginal<typeof ApiFetchModule>();
  return { ...actual, apiFetch: vi.fn() };
});

import { apiFetch } from "../../../data/apiFetch";
import { briefFixture } from "@web/features/brief/test-utils";
import { buildPrDiffQueryOptions } from "../queries";
import { prefetchSpanDiff, readDiffPreloadPath } from "./diff-prefetch";
import {
  parsePrSearch,
  readExplicitSpan,
  readRevisionRequest,
} from "../search";
import { parseRouteSearch } from "@web/utils/search-params";

const SPAN = { base: "a".repeat(40), head: "b".repeat(40) };

afterEach(() => {
  vi.mocked(apiFetch).mockReset();
});

describe("the span diff prefetch in the server render", () => {
  it("never reads the diff, so the HTML never carries it", async () => {
    expect(typeof window).toBe("undefined");
    const queryClient = new QueryClient();

    prefetchSpanDiff(queryClient, {
      repoId: "424242",
      prNumber: 7,
      span: SPAN,
      preload: false,
      brief: Promise.resolve(briefFixture),
    });
    await Promise.resolve();

    const { queryKey } = buildPrDiffQueryOptions(
      "424242",
      7,
      SPAN.base,
      SPAN.head,
    );
    expect(queryClient.getQueryState(queryKey)).toBeUndefined();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("keeps an all-digit SHA from the URL exact in the preload path", () => {
    const head = "3000300030003000300030003000300030003000";
    const raw = parseRouteSearch(`?base=${SPAN.base}&head=${head}`);
    // The router hands the loader the raw search beneath the validated one.
    const span = readExplicitSpan(
      readRevisionRequest({ ...raw, ...parsePrSearch(raw) }),
    );

    expect(span).toEqual({ base: SPAN.base, head });
    expect(readDiffPreloadPath("424242", 7, { base: SPAN.base, head })).toBe(
      `/api/repos/424242/pulls/7/diff?base=${SPAN.base}&head=${head}`,
    );
  });

  it("names the diff read's own path for the preload link", () => {
    expect(readDiffPreloadPath("424242", 7, SPAN)).toBe(
      `/api/repos/424242/pulls/7/diff?base=${SPAN.base}&head=${SPAN.head}`,
    );
  });
});
