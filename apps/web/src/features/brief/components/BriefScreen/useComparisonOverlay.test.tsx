// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import type { ComparisonQuery } from "../../comparison/comparisonQuery";
import type { Brief, ComparisonMarks } from "../../types";
import { DeltaSpanStatuses } from "./types";
import {
  type BriefComparisonPlan,
  useComparisonOverlay,
} from "./useComparisonOverlay";

const PR = {
  repo: "acme/widgets",
  number: 7,
  title: "t",
  url: "https://example.com/pr/7",
  sha: "head1234",
  description: "",
};

const BRIEF: Brief = {
  artifactKind: "brief",
  pr: PR,
  summary: "s",
  changeGroups: [],
  chunks: [],
  concernView: [],
};

const DELTA: Brief = {
  artifactKind: "delta",
  pr: PR,
  summary: "Delta since your checkpoint.",
  baselineSha: "chk1234",
  headSha: "head1234",
  changeGroups: [
    {
      id: "dg1",
      title: "Guarded shared path",
      summary: "g",
      dominantCategory: "bugfix",
      secondaryCategories: [],
      uncertain: false,
      uncertainBetween: [],
    },
  ],
  chunks: [
    {
      id: "dchunk-a",
      changeGroupId: "dg1",
      file: "src/a.ts",
      concern: "implementation",
      role: "core",
      loc: { added: 1, deleted: 1 },
      addedRanges: [{ start: 2, end: 2 }],
      removedRanges: [{ start: 2, end: 2 }],
      riskSurface: [],
    },
  ],
  concernView: [],
};

const MARKS: ComparisonMarks = {
  baselineSha: "chk1234",
  headSha: "head1234",
  baselineLabel: "checkpoint",
  baselineIndex: 1,
  files: [],
};

const SPAN_DIFF = [
  "diff --git a/src/a.ts b/src/a.ts",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -1,3 +1,3 @@",
  " const a = 1;",
  "-console.log(a);",
  "+validate(a);",
  " export { a };",
].join("\n");

function stubQuery<T>(
  key: string,
  value: () => Promise<T>,
): ComparisonQuery<T> {
  return { queryKey: [key], queryFn: value, retry: false };
}

function stubPlan(
  spanFn: () => Promise<string>,
  spanEnabled = true,
): BriefComparisonPlan {
  return {
    lastReview: {
      marks: stubQuery("marks", () => Promise.resolve(MARKS)),
      delta: stubQuery("delta", () => Promise.resolve(DELTA)),
      rawDiff: { ...stubQuery("span", spanFn), enabled: spanEnabled },
    },
    previousBrief: {
      marks: stubQuery("prev-marks", () => Promise.resolve(MARKS)),
      rawDiff: stubQuery("prev-span", spanFn),
    },
  };
}

function renderOverlay(
  plan: BriefComparisonPlan,
  compare: "last-review" | "previous-brief",
  view: "changes" | "full" = "changes",
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const rendered = renderHook(
    () =>
      useComparisonOverlay({
        artifacts: [],
        brief: BRIEF,
        briefId: "brief-1",
        comparisonPlan: plan,
        searchParams: { view, compare },
      }),
    { wrapper },
  );

  return { ...rendered, client };
}

describe("useComparisonOverlay delta rows on the database path", () => {
  it("fetches the span diff once the delta lands and attaches its rows", async () => {
    const spanFn = vi.fn(async () => SPAN_DIFF);
    const { result } = renderOverlay(stubPlan(spanFn), "last-review");

    await waitFor(() =>
      expect(result.current.deltaSpanStatus).toBe(DeltaSpanStatuses.READY),
    );
    expect(spanFn).toHaveBeenCalledTimes(1);
    const rows = result.current.delta?.chunks[0]?.diff ?? [];
    expect(rows.map((row) => row.kind)).toEqual([
      "hunk",
      "ctx",
      "del",
      "add",
      "ctx",
    ]);
    expect(rows.every((row) => row.origin === "guest")).toBe(true);
  });

  it("shows the delta before its rows: loading until the span lands", async () => {
    let releaseSpan: (() => void) | undefined;
    const spanFn = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          releaseSpan = () => resolve(SPAN_DIFF);
        }),
    );
    const { result } = renderOverlay(stubPlan(spanFn), "last-review");

    await waitFor(() => expect(result.current.delta).not.toBeNull());
    expect(result.current.deltaSpanStatus).toBe(DeltaSpanStatuses.LOADING);
    expect(result.current.delta?.chunks[0]?.diff).toBeUndefined();

    releaseSpan?.();
    await waitFor(() =>
      expect(result.current.deltaSpanStatus).toBe(DeltaSpanStatuses.READY),
    );
  });

  it("keeps the delta and reports an error when the span diff fails", async () => {
    const spanFn = vi.fn(() => Promise.reject(new Error("proxy down")));
    const { result } = renderOverlay(stubPlan(spanFn), "last-review");

    await waitFor(() =>
      expect(result.current.deltaSpanStatus).toBe(DeltaSpanStatuses.ERROR),
    );
    expect(result.current.delta?.chunks[0]?.diff).toBeUndefined();
  });

  it("keeps rows that landed through a failed refetch", async () => {
    const spanFn = vi
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce(SPAN_DIFF)
      .mockRejectedValueOnce(new Error("proxy down"));
    const { result, client } = renderOverlay(stubPlan(spanFn), "last-review");
    await waitFor(() =>
      expect(result.current.deltaSpanStatus).toBe(DeltaSpanStatuses.READY),
    );

    await client.refetchQueries({ queryKey: ["span"] });

    await waitFor(() => expect(spanFn).toHaveBeenCalledTimes(2));
    expect(result.current.deltaSpanStatus).toBe(DeltaSpanStatuses.READY);
    expect(result.current.delta?.chunks[0]?.diff).toBeDefined();
  });

  it("never fetches the span before the delta it slices has landed", async () => {
    const spanFn = vi.fn(async () => SPAN_DIFF);
    const marksOnly: BriefComparisonPlan = {
      ...stubPlan(spanFn),
      lastReview: {
        marks: stubQuery("marks", () => Promise.resolve(MARKS)),
        rawDiff: stubQuery("span", spanFn),
      },
    };
    const { result } = renderOverlay(marksOnly, "last-review");

    await waitFor(() => expect(result.current.marks).not.toBeNull());
    expect(spanFn).not.toHaveBeenCalled();
    expect(result.current.deltaSpanStatus).toBe(DeltaSpanStatuses.ABSENT);
  });

  it("never fetches the span in Full scope, which shows no delta rows", async () => {
    const spanFn = vi.fn(async () => SPAN_DIFF);
    const { result } = renderOverlay(stubPlan(spanFn), "last-review", "full");

    await waitFor(() => expect(result.current.delta).not.toBeNull());
    expect(spanFn).not.toHaveBeenCalled();
    expect(result.current.deltaSpanStatus).toBe(DeltaSpanStatuses.ABSENT);
  });

  it("leaves a span descriptor that disabled itself unfetched", async () => {
    const spanFn = vi.fn(async () => SPAN_DIFF);
    const { result } = renderOverlay(stubPlan(spanFn, false), "last-review");

    await waitFor(() => expect(result.current.delta).not.toBeNull());
    expect(spanFn).not.toHaveBeenCalled();
    expect(result.current.deltaSpanStatus).toBe(DeltaSpanStatuses.ABSENT);
  });

  it("never fetches the span under the Previous brief lens", async () => {
    const spanFn = vi.fn(async () => SPAN_DIFF);
    const { result } = renderOverlay(stubPlan(spanFn), "previous-brief");

    await waitFor(() => expect(result.current.marks).not.toBeNull());
    expect(spanFn).not.toHaveBeenCalled();
    expect(result.current.deltaSpanStatus).toBe(DeltaSpanStatuses.ABSENT);
  });
});
