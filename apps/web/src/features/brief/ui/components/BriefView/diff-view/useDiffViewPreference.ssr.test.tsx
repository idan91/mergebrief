// No jsdom: renders the way the server does, reading the request's cookie.
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ChunkLayoutCounts } from "brief-core/chunk-layout";
import { DiffViews } from "@web/components/DiffRows/types";
import { SkeletonRows } from "../DiffTable/SkeletonRows";
import {
  DESKTOP_WRAP_COLUMNS,
  estimateReservedRowsHeight,
} from "../reading/chunk-height-model";
import { DIFF_VIEW_COOKIE } from "./diff-view-storage";
import { useDiffViewPreference } from "./useDiffViewPreference";

const requestCookies = vi.hoisted(() => new Map<string, string>());

vi.mock("@tanstack/react-start/server", () => ({
  getCookie: (name: string) => requestCookies.get(name),
}));

afterEach(() => {
  requestCookies.clear();
});

const COUNTS: ChunkLayoutCounts = {
  rows: 12,
  hunkRows: 1,
  expandRows: 0,
  splitRows: 7,
  lineWidths: { counts: [12, 0, 0, 0, 0, 0, 0, 0, 0], overflowColumns: 0 },
};

function SkeletonFromPreference() {
  const preference = useDiffViewPreference({ search: undefined });
  return (
    <SkeletonRows
      counts={COUNTS}
      view={preference.view}
      wrapColumns={DESKTOP_WRAP_COLUMNS}
    />
  );
}

function readBlockSize(html: string): string | undefined {
  return /--skeleton-block-size:(\d+px)/.exec(html)?.[1];
}

describe("the server render of a stored split view", () => {
  it("draws a split skeleton at the split height from the cookie", () => {
    requestCookies.set(DIFF_VIEW_COOKIE, DiffViews.SPLIT);

    const html = renderToString(<SkeletonFromPreference />);

    expect(html).toContain(`data-view="${DiffViews.SPLIT}"`);
    expect(readBlockSize(html)).toBe(
      `${String(estimateReservedRowsHeight(COUNTS, DiffViews.SPLIT, DESKTOP_WRAP_COLUMNS))}px`,
    );
  });

  it("draws unified when the request carries no cookie", () => {
    const html = renderToString(<SkeletonFromPreference />);

    expect(html).toContain(`data-view="${DiffViews.UNIFIED}"`);
    expect(readBlockSize(html)).toBe(
      `${String(estimateReservedRowsHeight(COUNTS, DiffViews.UNIFIED, DESKTOP_WRAP_COLUMNS))}px`,
    );
  });

  it("draws unified on a cookie value this build does not ship", () => {
    requestCookies.set(DIFF_VIEW_COOKIE, "sideways");

    expect(renderToString(<SkeletonFromPreference />)).toContain(
      `data-view="${DiffViews.UNIFIED}"`,
    );
  });
});
