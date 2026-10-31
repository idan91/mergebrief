// @vitest-environment jsdom
import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import type * as ApiFetchModule from "../../../data/apiFetch";

vi.mock("../../../data/apiFetch", async (importOriginal) => {
  const actual = await importOriginal<typeof ApiFetchModule>();
  return { ...actual, apiFetch: vi.fn() };
});

import { apiFetch } from "../../../data/apiFetch";
import { briefFixture, makeChunk } from "@web/features/brief/test-utils";
import type { Brief } from "@web/features/brief/model";
import { prefetchSpanDiff, readDiffPreloadPath } from "./diff-prefetch";

const SPAN = { base: "a".repeat(40), head: "b".repeat(40) };
const DIFF_PATH = `/api/repos/424242/pulls/7/diff?base=${SPAN.base}&head=${SPAN.head}`;

function stubBriefOfFiles(count: number): Brief {
  const chunks = Array.from({ length: count }, (_, index) => ({
    ...makeChunk(),
    id: `c${String(index)}`,
    file: `src/file-${String(index)}.ts`,
  }));
  return { ...briefFixture, chunks };
}

function startPrefetch(preload: boolean, brief: Brief): void {
  prefetchSpanDiff(new QueryClient(), {
    repoId: "424242",
    prNumber: 7,
    span: SPAN,
    preload,
    brief: Promise.resolve(brief),
  });
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function listDiffReads(): unknown[] {
  return vi.mocked(apiFetch).mock.calls.filter(([path]) => path === DIFF_PATH);
}

afterEach(() => {
  vi.mocked(apiFetch).mockReset();
});

describe("the span diff prefetch in the browser", () => {
  it("starts the read at once on a navigation, before the brief lands", () => {
    vi.mocked(apiFetch).mockResolvedValue(new Response("diff"));
    prefetchSpanDiff(new QueryClient(), {
      repoId: "424242",
      prNumber: 7,
      span: SPAN,
      preload: false,
      brief: new Promise<Brief>(() => undefined),
    });

    expect(listDiffReads()).toHaveLength(1);
  });

  it("starts the read on a hover over a diff of 300 files", async () => {
    vi.mocked(apiFetch).mockResolvedValue(new Response("diff"));
    startPrefetch(true, stubBriefOfFiles(300));
    await settle();

    expect(listDiffReads()).toHaveLength(1);
  });

  it("never starts the read on a hover over a diff past 300 files", async () => {
    startPrefetch(true, stubBriefOfFiles(301));
    await settle();

    expect(listDiffReads()).toHaveLength(0);
  });

  it("leaves the preload link to the server render", () => {
    expect(readDiffPreloadPath("424242", 7, SPAN)).toBeUndefined();
  });
});
