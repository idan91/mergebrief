// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

import { ApiError, ApiErrorCodes } from "@web/data/apiFetch";
import type { DiffQueryState } from "./types";
import { isFocusLost, readDiffFetchRetry } from "./utils";

const releaseFocus = vi.fn();
const TIMEOUT = new ApiError(ApiErrorCodes.DIFF_FETCH_TIMEOUT, 504, "/diff");

function stubQuery(overrides: Partial<DiffQueryState>): DiffQueryState {
  return {
    data: undefined,
    error: TIMEOUT,
    isFetching: false,
    errorUpdateCount: 1,
    refetch: () => Promise.resolve(undefined),
    ...overrides,
  };
}

describe("readDiffFetchRetry", () => {
  it("offers a retry for a timed-out read with nothing landed", () => {
    const refetch = vi.fn(() => Promise.resolve(undefined));
    const retry = readDiffFetchRetry(
      stubQuery({ isFetching: true, errorUpdateCount: 3, refetch }),
      releaseFocus,
    );

    expect(retry?.pending).toBe(true);
    expect(retry?.failureCount).toBe(3);
    retry?.retry();
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("offers none for another failure", () => {
    const error = new ApiError(ApiErrorCodes.DIFF_TOO_LARGE, 413, "/diff");

    expect(
      readDiffFetchRetry(stubQuery({ error }), releaseFocus),
    ).toBeUndefined();
  });

  it("offers none when a body landed before the timed-out refetch", () => {
    expect(
      readDiffFetchRetry(stubQuery({ data: "diff" }), releaseFocus),
    ).toBeUndefined();
  });
});

describe("isFocusLost", () => {
  it("reads focus on the body as lost and on a control as held", () => {
    const button = document.createElement("button");
    document.body.append(button);

    expect(isFocusLost()).toBe(true);
    button.focus();
    expect(isFocusLost()).toBe(false);

    button.remove();
  });
});
